package com.jellydock.privatevault.core

import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.security.MessageDigest
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/*
 * Moving a vault to a new phone (1.1). The two phones talk directly over the local network;
 * nothing goes through a server or a cloud. Full wire format: docs/TRANSFER_PROTOCOL.md.
 *
 * 1. The new phone (receiver) opens a listening socket and shows a QR code holding its
 *    address and a fresh 256-bit secret. The QR is the only way the secret leaves the phone.
 * 2. The old phone (sender) scans it, connects, and both derive per-direction AES-256-GCM
 *    keys from the secret and two fresh random nonces. A phone that did not see the QR
 *    cannot decrypt or forge a single frame, so a wrong or stolen connection fails at once.
 * 3. Items are decrypted on the sender into memory, sent in encrypted frames, and the
 *    receiver encrypts them again under its own keys (Vault.importItem), verifies the copy
 *    on disk and confirms. Plaintext is never written to disk on either phone.
 *
 * The sender never deletes anything: the old vault stays as it was until the owner erases it.
 */

/** What the QR code carries. */
data class TransferCode(val host: String, val port: Int, val secret: ByteArray) {
    fun encode(): String = "$PREFIX$host:$port:${B64.encodeToString(secret)}"

    companion object {
        private const val PREFIX = "PVT1:"
        private val B64 = Base64.getUrlEncoder().withoutPadding()

        /** Parses a scanned code. Only private, local-network IPv4 addresses are accepted. */
        fun parse(text: String): TransferCode {
            if (!text.startsWith(PREFIX)) throw TransferException(TransferError.BAD_CODE, "Not a PrivateVault transfer code")
            val parts = text.removePrefix(PREFIX).split(':')
            if (parts.size != 3) throw TransferException(TransferError.BAD_CODE, "Malformed transfer code")
            val host = parts[0]
            val port = parts[1].toIntOrNull()
            val secret = runCatching { Base64.getUrlDecoder().decode(parts[2]) }.getOrNull()
            if (!isLocalIPv4(host) || port == null || port !in 1..65535 || secret == null || secret.size != SECRET_BYTES) {
                throw TransferException(TransferError.BAD_CODE, "Malformed transfer code")
            }
            return TransferCode(host, port, secret)
        }

        /**
         * True for addresses that can only be on the same local network: 10/8, 172.16/12,
         * 192.168/16, link-local 169.254/16 (and loopback, for tests). Everything else is
         * refused so a crafted QR code can never send vault content to the internet.
         */
        fun isLocalIPv4(host: String): Boolean {
            val octets = host.split('.')
            if (octets.size != 4) return false
            val b = octets.map { o -> if (o.isEmpty() || o.length > 3 || !o.all(Char::isDigit)) return false else o.toInt() }
            if (b.any { it > 255 }) return false
            return b[0] == 10 ||
                (b[0] == 172 && b[1] in 16..31) ||
                (b[0] == 192 && b[1] == 168) ||
                (b[0] == 169 && b[1] == 254) ||
                b[0] == 127
        }

        /** The phone's own Wi-Fi / hotspot IPv4 address, or null when it has none. */
        fun localAddress(): InetAddress? =
            NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
                .filter { runCatching { it.isUp && !it.isLoopback }.getOrDefault(false) }
                // Wi-Fi and hotspot first; mobile data interfaces (rmnet, ccmni) are skipped by the
                // private-address filter anyway because carriers rarely hand out 192.168/16.
                .sortedBy { if (it.name.startsWith("wlan") || it.name.startsWith("ap") || it.name.startsWith("swlan")) 0 else 1 }
                .flatMap { it.inetAddresses.toList() }
                .firstOrNull { it is Inet4Address && !it.isLoopbackAddress && isLocalIPv4(it.hostAddress ?: "") }

        const val SECRET_BYTES = 32
    }

    override fun equals(other: Any?) =
        other is TransferCode && other.host == host && other.port == port && other.secret.contentEquals(secret)

    override fun hashCode() = host.hashCode() * 31 + port
}

enum class TransferError(val code: Int) {
    BAD_CODE(0),
    STORAGE_FULL(1),
    LOCKED(2),
    INTEGRITY(3),
    CANCELLED(4),
    OTHER(5),
    WRONG_PEER(6),
    CONNECTION(7),
    ;

    companion object {
        fun of(code: Int) = entries.firstOrNull { it.code == code } ?: OTHER
    }
}

class TransferException(val error: TransferError, message: String) : IOException(message)

/** Progress reported to the UI. Byte counts are plaintext bytes. */
data class TransferProgress(
    val itemsDone: Int,
    val itemsTotal: Int,
    val bytesDone: Long,
    val bytesTotal: Long,
    val skipped: Int,
    val alreadyThere: Int,
) {
    internal fun skippedOne(bytes: Long) = copy(itemsDone = itemsDone + 1, skipped = skipped + 1, bytesDone = bytesDone + bytes)
}

/**
 * Encrypted, ordered, authenticated frames over a byte stream (TCP socket in the app,
 * pipes in tests). Each direction has its own key and a frame counter used as the nonce,
 * so frames cannot be replayed, reordered, dropped or reflected back.
 */
class SecureChannel private constructor(
    private val input: DataInputStream,
    private val output: DataOutputStream,
    private val sendKey: ByteArray,
    private val receiveKey: ByteArray,
) : AutoCloseable {
    private var sendCounter = 0L
    private var receiveCounter = 0L

    fun send(message: ByteArray) {
        require(message.size <= MAX_FRAME) { "Frame too large" }
        val sealed = Aead.sealWithNonce(sendKey, nonce(sendCounter++), message, FRAME_AAD)
        output.writeInt(sealed.size)
        output.write(sealed)
        output.flush()
    }

    fun receive(): ByteArray {
        val length =
            try {
                input.readInt()
            } catch (e: EOFException) {
                throw TransferException(TransferError.CONNECTION, "Connection closed")
            }
        if (length < Aead.TAG_BYTES || length > MAX_FRAME + Aead.TAG_BYTES) {
            throw TransferException(
                TransferError.INTEGRITY,
                "Bad frame length",
            )
        }
        val sealed = ByteArray(length)
        try {
            input.readFully(sealed)
        } catch (e: EOFException) {
            throw TransferException(TransferError.CONNECTION, "Connection closed")
        }
        return try {
            Aead.openWithNonce(receiveKey, nonce(receiveCounter++), sealed, FRAME_AAD)
        } catch (e: IntegrityException) {
            throw TransferException(TransferError.WRONG_PEER, "Frame failed authentication")
        }
    }

    override fun close() {
        sendKey.wipe()
        receiveKey.wipe()
        runCatching { output.close() }
        runCatching { input.close() }
    }

    private fun nonce(counter: Long) = ByteArray(4) + ByteArray(8) { i -> (counter ushr (56 - 8 * i)).toByte() }

    companion object {
        const val MAX_FRAME = 1024 * 1024 + 4096
        private val MAGIC = "PVT1".toByteArray(Charsets.US_ASCII)
        private const val VERSION = 1
        private val FRAME_AAD = "PVT1 frame".toByteArray(Charsets.US_ASCII)
        private val C2S = "PrivateVault transfer c2s".toByteArray(Charsets.US_ASCII)
        private val S2C = "PrivateVault transfer s2c".toByteArray(Charsets.US_ASCII)

        /** The old phone's side. [secret] comes from the scanned QR code. */
        fun client(
            input: InputStream,
            output: OutputStream,
            secret: ByteArray,
        ) = open(input, output, secret, isClient = true)

        /** The new phone's side. [secret] is the one shown in its QR code. */
        fun server(
            input: InputStream,
            output: OutputStream,
            secret: ByteArray,
        ) = open(input, output, secret, isClient = false)

        private fun open(
            rawIn: InputStream,
            rawOut: OutputStream,
            secret: ByteArray,
            isClient: Boolean,
        ): SecureChannel {
            require(secret.size == TransferCode.SECRET_BYTES) { "Secret must be 32 bytes" }
            val input = DataInputStream(rawIn.buffered(64 * 1024))
            val output = DataOutputStream(rawOut.buffered(64 * 1024))
            val mine = Aead.randomBytes(32)
            output.write(MAGIC)
            output.writeByte(VERSION)
            output.write(mine)
            output.flush()
            val header = ByteArray(MAGIC.size + 1)
            val theirs = ByteArray(32)
            try {
                input.readFully(header)
                input.readFully(theirs)
            } catch (e: EOFException) {
                throw TransferException(TransferError.CONNECTION, "Connection closed during handshake")
            }
            if (!header.copyOfRange(0, MAGIC.size).contentEquals(MAGIC) || header[MAGIC.size].toInt() != VERSION) {
                throw TransferException(TransferError.WRONG_PEER, "Not a PrivateVault transfer")
            }
            val salt = if (isClient) mine + theirs else theirs + mine
            val prk = hmac(salt, secret)
            val c2s = hmac(prk, C2S + byteArrayOf(1))
            val s2c = hmac(prk, S2C + byteArrayOf(1))
            prk.wipe()
            val channel = if (isClient) SecureChannel(input, output, c2s, s2c) else SecureChannel(input, output, s2c, c2s)
            // Both sides prove they know the secret before anything else is said.
            try {
                channel.send(byteArrayOf(Msg.HELLO, VERSION.toByte()))
                val hello = channel.receive()
                if (hello.size != 2 || hello[0] != Msg.HELLO || hello[1].toInt() != VERSION) {
                    throw TransferException(TransferError.WRONG_PEER, "Unexpected hello")
                }
            } catch (e: Exception) {
                channel.close()
                throw e
            }
            return channel
        }

        internal fun hmac(
            key: ByteArray,
            data: ByteArray,
        ): ByteArray =
            Mac.getInstance("HmacSHA256").run {
                init(SecretKeySpec(key, "HmacSHA256"))
                doFinal(data)
            }
    }
}

internal object Msg {
    const val HELLO: Byte = 1
    const val OFFER: Byte = 2
    const val WANT: Byte = 3
    const val BEGIN: Byte = 4
    const val DATA: Byte = 5
    const val END: Byte = 6
    const val ITEM_OK: Byte = 7
    const val FAIL: Byte = 8
    const val DONE: Byte = 9
    const val DONE_OK: Byte = 10
    const val ITEM_ABORT: Byte = 11

    const val DATA_BYTES = 256 * 1024
    const val MAX_MIME = 128
    const val MAX_THUMB = 1024 * 1024

    /** Most items announced in one OFFER frame (25 bytes each). */
    const val OFFER_BATCH = 20_000
}

/** The old phone: sends every item of [vault] that the new phone does not have yet. */
class TransferSender(private val vault: Vault) {
    @Volatile
    var cancelled = false

    /** Returns the final progress. Throws [TransferException] on failure or cancel. */
    fun run(
        channel: SecureChannel,
        onProgress: (TransferProgress) -> Unit = {},
    ): TransferProgress = whileVaultOpen(channel) { send(channel, onProgress) }

    private fun send(
        channel: SecureChannel,
        onProgress: (TransferProgress) -> Unit,
    ): TransferProgress {
        val items = vault.list()
        // Offer: id, kind, size of every item, in batches.
        var start = 0
        do {
            val end = minOf(items.size, start + Msg.OFFER_BATCH)
            val buf = ByteArrayOutputStream()
            DataOutputStream(buf).use { out ->
                out.writeByte(Msg.OFFER.toInt())
                out.writeBoolean(end == items.size)
                out.writeInt(end - start)
                for (item in items.subList(start, end)) {
                    out.write(hexToBytes(item.id))
                    out.writeByte(if (item.meta.kind == ItemKind.VIDEO) 1 else 0)
                    out.writeLong(item.meta.sizeBytes)
                }
            }
            channel.send(buf.toByteArray())
            start = end
        } while (start < items.size)

        val want = expect(channel, Msg.WANT)
        val wantCount = DataInputStream(want.inputStream(1, want.size - 1)).readInt()
        if (wantCount != items.size || want.size != 5 + (items.size + 7) / 8) {
            throw TransferException(
                TransferError.INTEGRITY,
                "Bad want list",
            )
        }
        val wanted = items.filterIndexed { i, _ -> (want[5 + i / 8].toInt() shr (i % 8)) and 1 == 1 }
        var progress = TransferProgress(0, wanted.size, 0, wanted.sumOf { it.meta.sizeBytes }, 0, items.size - wanted.size)
        onProgress(progress)

        for (item in wanted) {
            checkCancelled(channel)
            val thumb = runCatching { vault.thumbnail(item.id) }.getOrNull()?.takeIf { it.size <= Msg.MAX_THUMB }
            val begin = ByteArrayOutputStream()
            DataOutputStream(begin).use { out ->
                out.writeByte(Msg.BEGIN.toInt())
                out.write(hexToBytes(item.id))
                out.writeByte(if (item.meta.kind == ItemKind.VIDEO) 1 else 0)
                out.writeUTF(item.meta.mimeType.take(Msg.MAX_MIME))
                out.writeLong(item.meta.createdAtEpochMs)
                out.writeLong(item.meta.sizeBytes)
                out.writeInt(thumb?.size ?: 0)
                thumb?.let { out.write(it) }
            }
            channel.send(begin.toByteArray())
            val frames = FrameOutput(channel) { checkCancelled(channel) }
            val ok =
                try {
                    vault.read(item.id, frames)
                    frames.flush()
                    true
                } catch (e: TransferException) {
                    throw e
                } catch (e: IntegrityException) {
                    false // Damaged on this phone; tell the receiver to drop it and go on.
                } catch (e: IOException) {
                    if (frames.channelFailed) throw e
                    false
                }
            if (!ok) {
                channel.send(byteArrayOf(Msg.ITEM_ABORT))
                progress = progress.skippedOne(item.meta.sizeBytes)
                onProgress(progress)
                continue
            }
            channel.send(byteArrayOf(Msg.END) + frames.sha256())
            expect(channel, Msg.ITEM_OK)
            progress = progress.copy(itemsDone = progress.itemsDone + 1, bytesDone = progress.bytesDone + item.meta.sizeBytes)
            onProgress(progress)
        }
        channel.send(byteArrayOf(Msg.DONE))
        expect(channel, Msg.DONE_OK)
        return progress
    }

    private fun checkCancelled(channel: SecureChannel) {
        if (cancelled) {
            runCatching { channel.send(byteArrayOf(Msg.FAIL, TransferError.CANCELLED.code.toByte())) }
            throw TransferException(TransferError.CANCELLED, "Cancelled")
        }
    }

    /** Buffers decrypted bytes into DATA frames and hashes exactly what was sent. */
    private class FrameOutput(private val channel: SecureChannel, private val beforeSend: () -> Unit) : OutputStream() {
        private val digest = MessageDigest.getInstance("SHA-256")
        private val buffer = ByteArray(Msg.DATA_BYTES)
        private var used = 0
        var channelFailed = false
            private set

        override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)

        override fun write(
            b: ByteArray,
            off: Int,
            len: Int,
        ) {
            var o = off
            var remaining = len
            while (remaining > 0) {
                val n = minOf(remaining, buffer.size - used)
                System.arraycopy(b, o, buffer, used, n)
                used += n
                o += n
                remaining -= n
                if (used == buffer.size) sendBuffer()
            }
        }

        override fun flush() {
            if (used > 0) sendBuffer()
        }

        private fun sendBuffer() {
            beforeSend()
            digest.update(buffer, 0, used)
            val frame = ByteArray(used + 1)
            frame[0] = Msg.DATA
            System.arraycopy(buffer, 0, frame, 1, used)
            try {
                channel.send(frame)
            } catch (e: IOException) {
                channelFailed = true
                throw e
            } finally {
                frame.wipe()
                buffer.fill(0, 0, used)
                used = 0
            }
        }

        fun sha256(): ByteArray = digest.digest()
    }
}

/** The new phone: stores what the old phone sends, under this vault's own keys. */
class TransferReceiver(private val vault: Vault) {
    @Volatile
    var cancelled = false

    /** Returns the final progress (items saved here). Throws [TransferException] on failure. */
    fun run(
        channel: SecureChannel,
        onProgress: (TransferProgress) -> Unit = {},
    ): TransferProgress = whileVaultOpen(channel) { receive(channel, onProgress) }

    private fun receive(
        channel: SecureChannel,
        onProgress: (TransferProgress) -> Unit,
    ): TransferProgress {
        // 1. Offer → want list (skip what an earlier, interrupted transfer already stored).
        data class Offered(val id: String, val size: Long)
        val offered = ArrayList<Offered>()
        while (true) {
            val frame = expect(channel, Msg.OFFER)
            val input = DataInputStream(frame.inputStream(1, frame.size - 1))
            val last = input.readBoolean()
            val count = input.readInt()
            if (count < 0 || count > Msg.OFFER_BATCH) throw TransferException(TransferError.INTEGRITY, "Bad offer")
            repeat(count) {
                val id = ByteArray(16).also { input.readFully(it) }
                input.readUnsignedByte()
                offered += Offered(bytesToHex(id), input.readLong())
            }
            if (last) break
            if (offered.size > 10_000_000) throw TransferException(TransferError.INTEGRITY, "Offer too large")
        }
        val have = vault.receivedSources()
        val bitmap = ByteArray((offered.size + 7) / 8)
        var wantedBytes = 0L
        var wantedCount = 0
        offered.forEachIndexed { i, o ->
            if (o.id !in have) {
                bitmap[i / 8] = (bitmap[i / 8].toInt() or (1 shl (i % 8))).toByte()
                wantedBytes += o.size.coerceAtLeast(0)
                wantedCount++
            }
        }
        val want = ByteArrayOutputStream()
        DataOutputStream(want).use { out ->
            out.writeByte(Msg.WANT.toInt())
            out.writeInt(offered.size)
            out.write(bitmap)
        }
        channel.send(want.toByteArray())
        val wantedIds = offered.filterIndexed { i, _ -> (bitmap[i / 8].toInt() shr (i % 8)) and 1 == 1 }.map { it.id }.toMutableSet()
        var progress = TransferProgress(0, wantedCount, 0, wantedBytes, 0, offered.size - wantedCount)
        onProgress(progress)

        // 2. Items.
        while (true) {
            if (cancelled) {
                runCatching { channel.send(byteArrayOf(Msg.FAIL, TransferError.CANCELLED.code.toByte())) }
                throw TransferException(TransferError.CANCELLED, "Cancelled")
            }
            val frame = channel.receive()
            when (frame.firstOrNull()) {
                Msg.DONE -> {
                    channel.send(byteArrayOf(Msg.DONE_OK))
                    return progress
                }
                Msg.FAIL -> throw TransferException(TransferError.of(frame.getOrElse(1) { 5 }.toInt()), "Other phone stopped the transfer")
                Msg.BEGIN -> {
                    val input = DataInputStream(frame.inputStream(1, frame.size - 1))
                    val sourceId = bytesToHex(ByteArray(16).also { input.readFully(it) })
                    val kind = if (input.readUnsignedByte() == 1) ItemKind.VIDEO else ItemKind.PHOTO
                    val mime = input.readUTF()
                    val createdAt = input.readLong()
                    val size = input.readLong()
                    val thumbLen = input.readInt()
                    if (mime.length > Msg.MAX_MIME || thumbLen !in 0..Msg.MAX_THUMB || sourceId !in wantedIds) {
                        fail(channel, TransferError.INTEGRITY, "Bad item header")
                    }
                    wantedIds.remove(sourceId)
                    val thumb = if (thumbLen > 0) ByteArray(thumbLen).also { input.readFully(it) } else null
                    val content = FrameInput(channel)
                    try {
                        vault.importItem(content, ItemMeta(kind, mime, createdAt), thumb, receivedFrom = sourceId)
                    } catch (e: ItemAborted) {
                        progress = progress.skippedOne(size)
                        onProgress(progress)
                        continue
                    } catch (e: TransferException) {
                        throw e
                    } catch (e: VaultStateException) {
                        fail(channel, TransferError.LOCKED, "Vault locked")
                    } catch (e: VaultDestroyedException) {
                        fail(channel, TransferError.LOCKED, "Vault gone")
                    } catch (e: ImportVerificationException) {
                        fail(channel, TransferError.INTEGRITY, "Item did not verify")
                    } catch (e: IOException) {
                        fail(channel, if (isNoSpace(e)) TransferError.STORAGE_FULL else TransferError.OTHER, e.message ?: "Write failed")
                    }
                    channel.send(byteArrayOf(Msg.ITEM_OK))
                    progress = progress.copy(itemsDone = progress.itemsDone + 1, bytesDone = progress.bytesDone + size)
                    onProgress(progress)
                }
                else -> fail(channel, TransferError.INTEGRITY, "Unexpected message")
            }
        }
    }

    private fun fail(
        channel: SecureChannel,
        error: TransferError,
        message: String,
    ): Nothing {
        runCatching { channel.send(byteArrayOf(Msg.FAIL, error.code.toByte())) }
        throw TransferException(error, message)
    }

    private fun isNoSpace(e: IOException): Boolean =
        generateSequence<Throwable>(e) {
            it.cause
        }.any { it.message?.contains("ENOSPC") == true || it.message?.contains("No space") == true }

    private class ItemAborted : IOException("Sender dropped this item")

    /** Plaintext of one item, read from DATA frames until END; the hash must match. */
    private class FrameInput(private val channel: SecureChannel) : InputStream() {
        private val digest = MessageDigest.getInstance("SHA-256")
        private var current = ByteArray(0)
        private var pos = 0
        private var finished = false

        override fun read(): Int {
            val one = ByteArray(1)
            return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xFF
        }

        override fun read(
            b: ByteArray,
            off: Int,
            len: Int,
        ): Int {
            if (len == 0) return 0
            while (pos >= current.size) {
                if (finished) return -1
                current.wipe()
                val frame = channel.receive()
                when (frame.firstOrNull()) {
                    Msg.DATA -> {
                        current = frame.copyOfRange(1, frame.size)
                        frame.wipe()
                        pos = 0
                        digest.update(current)
                    }
                    Msg.END -> {
                        if (frame.size != 33 || !MessageDigest.isEqual(frame.copyOfRange(1, 33), digest.digest())) {
                            // Thrown as an integrity failure so importItem discards the copy.
                            throw IntegrityException("Item hash does not match")
                        }
                        current = ByteArray(0)
                        pos = 0
                        finished = true
                    }
                    Msg.ITEM_ABORT -> throw ItemAborted()
                    Msg.FAIL -> throw TransferException(
                        TransferError.of(frame.getOrElse(1) { 5 }.toInt()),
                        "Other phone stopped the transfer",
                    )
                    else -> throw TransferException(TransferError.INTEGRITY, "Unexpected message")
                }
            }
            val n = minOf(len, current.size - pos)
            System.arraycopy(current, pos, b, off, n)
            pos += n
            return n
        }

        override fun close() {
            current.wipe()
        }
    }
}

/** A vault locked (app sent to the background) or erased mid-transfer stops it on both phones. */
private fun <T> whileVaultOpen(
    channel: SecureChannel,
    block: () -> T,
): T =
    try {
        block()
    } catch (e: VaultStateException) {
        runCatching { channel.send(byteArrayOf(Msg.FAIL, TransferError.LOCKED.code.toByte())) }
        throw TransferException(TransferError.LOCKED, "Vault locked")
    } catch (e: VaultDestroyedException) {
        runCatching { channel.send(byteArrayOf(Msg.FAIL, TransferError.LOCKED.code.toByte())) }
        throw TransferException(TransferError.LOCKED, "Vault erased")
    }

private fun expect(
    channel: SecureChannel,
    type: Byte,
): ByteArray {
    val frame = channel.receive()
    if (frame.firstOrNull() == Msg.FAIL) {
        throw TransferException(TransferError.of(frame.getOrElse(1) { 5 }.toInt()), "Other phone stopped the transfer")
    }
    if (frame.firstOrNull() != type) throw TransferException(TransferError.INTEGRITY, "Unexpected message")
    return frame
}

private fun hexToBytes(id: String) = ByteArray(16) { id.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

private fun bytesToHex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }
