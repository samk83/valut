package com.jellydock.privatevault.core

import org.junit.jupiter.api.io.TempDir
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class ChunkedCipherTest {
    @TempDir
    lateinit var dir: File

    private val key = Aead.randomBytes(32)
    private val id = Aead.randomBytes(16)
    private val chunk = 1024

    private fun seal(plain: ByteArray): ByteArray =
        ByteArrayOutputStream().also { ChunkedCipher.encrypt(plain.inputStream(), it, key, id, chunk) }.toByteArray()

    private fun open(
        sealed: ByteArray,
        k: ByteArray = key,
        i: ByteArray = id,
    ): ByteArray = ByteArrayOutputStream().also { ChunkedCipher.decrypt(sealed.inputStream(), it, k, i) }.toByteArray()

    @Test
    fun `round trips at chunk boundaries`() {
        for (size in listOf(0, 1, chunk - 1, chunk, chunk + 1, chunk * 3, chunk * 3 + 7)) {
            val plain = Aead.randomBytes(size)
            assertContentEquals(plain, open(seal(plain)), "size $size")
        }
    }

    @Test
    fun `ciphertext does not contain the plaintext`() {
        val plain = ByteArray(chunk * 2) { 'A'.code.toByte() }
        val sealed = seal(plain)
        val text = String(sealed, Charsets.ISO_8859_1)
        assertEquals(-1, text.indexOf("AAAAAAAAAAAAAAAA"))
    }

    @Test
    fun `truncating the last chunk is detected`() {
        val sealed = seal(Aead.randomBytes(chunk * 3))
        val cut = sealed.copyOf(ChunkedCipher.HEADER_BYTES + 2 * (chunk + Aead.TAG_BYTES))
        assertFailsWith<IntegrityException> { open(cut) }
    }

    @Test
    fun `swapping chunks is detected`() {
        val sealed = seal(Aead.randomBytes(chunk * 3))
        val stride = chunk + Aead.TAG_BYTES
        val h = ChunkedCipher.HEADER_BYTES
        val swapped = sealed.copyOf()
        sealed.copyInto(swapped, h, h + stride, h + 2 * stride)
        sealed.copyInto(swapped, h + stride, h, h + stride)
        assertFailsWith<IntegrityException> { open(swapped) }
    }

    @Test
    fun `flipping one bit is detected`() {
        val sealed = seal(Aead.randomBytes(chunk * 2))
        sealed[sealed.size / 2] = (sealed[sealed.size / 2].toInt() xor 1).toByte()
        assertFailsWith<IntegrityException> { open(sealed) }
    }

    @Test
    fun `file is bound to its id and key`() {
        val sealed = seal(Aead.randomBytes(100))
        assertFailsWith<IntegrityException> { open(sealed, i = Aead.randomBytes(16)) }
        assertFailsWith<IntegrityException> { open(sealed, k = Aead.randomBytes(32)) }
    }

    @Test
    fun `random access detects a tampered chunk`() {
        val sealed = seal(Aead.randomBytes(chunk * 3))
        val offset = ChunkedCipher.HEADER_BYTES + (chunk + Aead.TAG_BYTES) + 5
        sealed[offset] = (sealed[offset].toInt() xor 1).toByte()
        val file = File(dir, "t").apply { writeBytes(sealed) }
        ChunkedCipher.Reader(file, key, id).use { reader ->
            reader.readChunk(0)
            assertFailsWith<IntegrityException> { reader.readChunk(1) }
        }
    }

    @Test
    fun `random access detects a cut-off last chunk`() {
        val sealed = seal(Aead.randomBytes(chunk * 2 + 500))
        val file = File(dir, "c").apply { writeBytes(sealed.copyOf(sealed.size - 300)) }
        ChunkedCipher.Reader(file, key, id).use { reader ->
            assertFailsWith<IntegrityException> { reader.readChunk(reader.chunkCount - 1) }
        }
    }

    @Test
    fun `random access returns each chunk`() {
        val plain = Aead.randomBytes(chunk * 4 + 10)
        val file = File(dir, "v").apply { writeBytes(seal(plain)) }
        ChunkedCipher.Reader(file, key, id).use { reader ->
            assertEquals(5, reader.chunkCount)
            assertContentEquals(plain.copyOfRange(chunk * 2, chunk * 3), reader.readChunk(2))
            assertContentEquals(plain.copyOfRange(chunk * 4, plain.size), reader.readChunk(4))
        }
    }
}
