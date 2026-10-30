package com.jellydock.privatevault.core

import java.io.DataInputStream
import java.io.EOFException
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.io.RandomAccessFile
import java.security.MessageDigest

/**
 * Streaming AES-256-GCM for photos and videos (SPEC AC-35, AC-44..46).
 *
 * File layout: header || chunk0 || chunk1 || ... || chunkN (the last chunk may be empty).
 *   header = "PVF1" | version(1) | chunkSize(4) | noncePrefix(7)
 *   chunk i = GCM(fileKey, nonce = noncePrefix || i (4, big endian) || isLast (1),
 *                 aad = fileId || header) of up to chunkSize plaintext bytes
 *
 * The chunk index and last-chunk flag are part of the nonce, so reordering, dropping or
 * truncating chunks fails authentication. Each chunk decrypts on its own, which lets the
 * video player seek without decrypting the whole file or writing plaintext to disk.
 */
internal object ChunkedCipher {
    const val DEFAULT_CHUNK_SIZE = 256 * 1024
    private val MAGIC = "PVF1".toByteArray(Charsets.US_ASCII)
    private const val VERSION = 1
    private const val PREFIX_BYTES = 7
    const val HEADER_BYTES = 4 + 1 + 4 + PREFIX_BYTES

    data class EncryptResult(val plaintextBytes: Long, val sha256: ByteArray)

    fun encrypt(
        input: InputStream,
        output: OutputStream,
        fileKey: ByteArray,
        fileId: ByteArray,
        chunkSize: Int = DEFAULT_CHUNK_SIZE,
    ): EncryptResult {
        require(chunkSize in 1024..(16 * 1024 * 1024)) { "Chunk size out of range" }
        val header = header(chunkSize, Aead.randomBytes(PREFIX_BYTES))
        val aad = fileId + header
        val digest = MessageDigest.getInstance("SHA-256")
        output.write(header)

        var index = 0
        var total = 0L
        var current = readChunk(input, chunkSize)
        while (true) {
            // Read ahead one chunk so we know whether the current one is the last.
            val next = if (current.size == chunkSize) readChunk(input, chunkSize) else ByteArray(0)
            val isLast = next.isEmpty()
            digest.update(current)
            total += current.size
            output.write(Aead.sealWithNonce(fileKey, nonce(header, index, isLast), current, aad))
            current.wipe()
            if (isLast) break
            current = next
            index++
            if (index == Int.MAX_VALUE) throw IllegalStateException("File too large")
        }
        output.flush()
        return EncryptResult(total, digest.digest())
    }

    /** Decrypts a whole stream, failing on any tampering. Returns the plaintext SHA-256. */
    fun decrypt(
        input: InputStream,
        output: OutputStream,
        fileKey: ByteArray,
        fileId: ByteArray,
    ): ByteArray {
        val data = DataInputStream(input)
        val header = ByteArray(HEADER_BYTES)
        try {
            data.readFully(header)
        } catch (e: EOFException) {
            throw IntegrityException("Missing file header")
        }
        val chunkSize = parseChunkSize(header)
        val aad = fileId + header
        val digest = MessageDigest.getInstance("SHA-256")
        var index = 0
        var current = readChunk(data, chunkSize + Aead.TAG_BYTES)
        while (true) {
            val next = if (current.size == chunkSize + Aead.TAG_BYTES) readChunk(data, chunkSize + Aead.TAG_BYTES) else ByteArray(0)
            val isLast = next.isEmpty()
            val plain = Aead.openWithNonce(fileKey, nonce(header, index, isLast), current, aad)
            digest.update(plain)
            output.write(plain)
            plain.wipe()
            if (isLast) break
            current = next
            index++
        }
        output.flush()
        return digest.digest()
    }

    /** Random-access reader for seeking inside an encrypted video. */
    class Reader(
        file: File,
        private val fileKey: ByteArray,
        private val fileId: ByteArray,
    ) : AutoCloseable {
        private val raf = RandomAccessFile(file, "r")
        private val header = ByteArray(HEADER_BYTES)
        val chunkSize: Int
        val chunkCount: Int

        init {
            try {
                if (raf.length() < HEADER_BYTES + Aead.TAG_BYTES) throw IntegrityException("File too short")
                raf.readFully(header)
                chunkSize = parseChunkSize(header)
                val body = raf.length() - HEADER_BYTES
                val stride = chunkSize.toLong() + Aead.TAG_BYTES
                chunkCount = ((body + stride - 1) / stride).toInt()
            } catch (e: Throwable) {
                // The caller never gets the object, so it cannot close the file itself.
                raf.close()
                throw e
            }
        }

        fun readChunk(index: Int): ByteArray {
            require(index in 0 until chunkCount) { "Chunk index out of range" }
            val stride = chunkSize.toLong() + Aead.TAG_BYTES
            val offset = HEADER_BYTES + index * stride
            val length = minOf(stride, raf.length() - offset).toInt()
            val sealed = ByteArray(length)
            raf.seek(offset)
            raf.readFully(sealed)
            return Aead.openWithNonce(fileKey, nonce(header, index, index == chunkCount - 1), sealed, fileId + header)
        }

        override fun close() = raf.close()
    }

    private fun header(
        chunkSize: Int,
        prefix: ByteArray,
    ): ByteArray =
        MAGIC + byteArrayOf(VERSION.toByte()) +
            byteArrayOf((chunkSize ushr 24).toByte(), (chunkSize ushr 16).toByte(), (chunkSize ushr 8).toByte(), chunkSize.toByte()) +
            prefix

    private fun parseChunkSize(header: ByteArray): Int {
        if (!header.copyOfRange(0, 4).contentEquals(MAGIC) || header[4].toInt() != VERSION) {
            throw IntegrityException("Not a vault file")
        }
        val size =
            ((header[5].toInt() and 0xFF) shl 24) or ((header[6].toInt() and 0xFF) shl 16) or
                ((header[7].toInt() and 0xFF) shl 8) or (header[8].toInt() and 0xFF)
        if (size !in 1024..(16 * 1024 * 1024)) throw IntegrityException("Invalid chunk size")
        return size
    }

    private fun nonce(
        header: ByteArray,
        index: Int,
        isLast: Boolean,
    ): ByteArray =
        header.copyOfRange(HEADER_BYTES - PREFIX_BYTES, HEADER_BYTES) +
            byteArrayOf((index ushr 24).toByte(), (index ushr 16).toByte(), (index ushr 8).toByte(), index.toByte()) +
            byteArrayOf(if (isLast) 1 else 0)

    private fun readChunk(
        input: InputStream,
        size: Int,
    ): ByteArray {
        val buffer = ByteArray(size)
        var filled = 0
        while (filled < size) {
            val n = input.read(buffer, filled, size - filled)
            if (n < 0) break
            filled += n
        }
        return if (filled == size) buffer else buffer.copyOf(filled).also { buffer.wipe() }
    }
}
