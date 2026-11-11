package com.jellydock.privatevault.core

import org.junit.jupiter.api.io.TempDir
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FilterOutputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TransferTest {
    @TempDir
    lateinit var dir: File

    private val pool = Executors.newCachedThreadPool()

    @AfterTest
    fun shutdown() {
        pool.shutdownNow()
    }

    private val oldHw = FakeHardwareKey()
    private val newHw = FakeHardwareKey()

    private fun oldVault() = Vault(File(dir, "old"), oldHw, TEST_PARAMS, chunkSize = 4096)

    private fun newVault() = Vault(File(dir, "new"), newHw, TEST_PARAMS, chunkSize = 8192)

    private fun readAll(
        v: Vault,
        id: String,
    ) = ByteArrayOutputStream().also { v.read(id, it) }.toByteArray()

    private fun fill(v: Vault): Map<Long, ByteArray> {
        val contents = mutableMapOf<Long, ByteArray>()
        listOf(0, 1, 4096, 20_000, 300_000).forEachIndexed { i, size ->
            val bytes = Aead.randomBytes(size)
            val meta =
                ItemMeta(
                    if (i % 2 == 0) ItemKind.PHOTO else ItemKind.VIDEO,
                    if (i % 2 == 0) "image/jpeg" else "video/mp4",
                    1_700_000_000_000 + i,
                )
            v.importItem(bytes.inputStream(), meta, thumbnail = if (i == 3) null else byteArrayOf(i.toByte(), 9, 9))
            contents[meta.createdAtEpochMs] = bytes
        }
        return contents
    }

    private class Outcome(val sent: Result<TransferProgress>, val received: Result<TransferProgress>)

    /** Runs a full transfer over a real loopback TCP connection. */
    private fun transfer(
        from: Vault,
        to: Vault,
        senderSecret: ByteArray? = null,
        wrapSenderOutput: (OutputStream) -> OutputStream = { it },
        configure: (TransferSender, TransferReceiver) -> Unit = { _, _ -> },
    ): Outcome {
        val secret = Aead.randomBytes(32)
        val server = ServerSocket(0, 1, InetAddress.getLoopbackAddress())
        val code = TransferCode("127.0.0.1", server.localPort, secret)
        val sender = TransferSender(from)
        val receiver = TransferReceiver(to)
        configure(sender, receiver)
        val rx =
            pool.submit(
                Callable {
                    server.use { s ->
                        s.accept().use { sock ->
                            SecureChannel.server(sock.getInputStream(), sock.getOutputStream(), secret).use { receiver.run(it) }
                        }
                    }
                },
            )
        val parsed = TransferCode.parse(code.encode())
        val tx =
            runCatching {
                Socket(parsed.host, parsed.port).use { sock ->
                    SecureChannel.client(
                        sock.getInputStream(),
                        wrapSenderOutput(sock.getOutputStream()),
                        senderSecret ?: parsed.secret,
                    ).use { sender.run(it) }
                }
            }
        val rxResult = runCatching { rx.get(30, TimeUnit.SECONDS) }.recoverCatching { throw (it.cause ?: it) }
        return Outcome(tx, rxResult)
    }

    @Test
    fun `all items arrive intact and re-encrypted under the new vault`() {
        val old = oldVault().apply { create(pin("482915")) }
        val contents = fill(old)
        val new = newVault().apply { create(pin("731904")) }

        val out = transfer(old, new)
        assertEquals(5, out.sent.getOrThrow().itemsDone)
        assertEquals(5, out.received.getOrThrow().itemsDone)

        val got = new.list()
        assertEquals(5, got.size)
        for (item in got) {
            val original = old.list().single { it.meta.createdAtEpochMs == item.meta.createdAtEpochMs }
            assertEquals(original.meta, item.meta)
            assertContentEquals(contents[item.meta.createdAtEpochMs], readAll(new, item.id))
            val thumb = old.thumbnail(original.id)
            if (thumb == null) assertEquals(null, new.thumbnail(item.id)) else assertContentEquals(thumb, new.thumbnail(item.id))
        }
        // The old phone keeps everything.
        assertEquals(5, old.list().size)
        // The new copy only opens with the new PIN.
        new.lock()
        assertFailsWith<WrongPinException> { new.unlock(pin("482915")) }
    }

    @Test
    fun `running again sends only what is missing`() {
        val old = oldVault().apply { create(pin("482915")) }
        fill(old)
        val new = newVault().apply { create(pin("731904")) }
        transfer(old, new).received.getOrThrow()

        old.importItem(Aead.randomBytes(5000).inputStream(), ItemMeta(ItemKind.PHOTO, "image/png", 5))
        val second = transfer(old, new)
        assertEquals(1, second.received.getOrThrow().itemsDone)
        assertEquals(5, second.received.getOrThrow().alreadyThere)
        assertEquals(6, new.list().size)
    }

    @Test
    fun `wrong secret fails on both phones and stores nothing`() {
        val old = oldVault().apply { create(pin("482915")) }
        fill(old)
        val new = newVault().apply { create(pin("731904")) }
        val out = transfer(old, new, senderSecret = Aead.randomBytes(32))
        assertEquals(
            TransferError.WRONG_PEER,
            (out.sent.exceptionOrNull() as? TransferException)?.error ?: (out.received.exceptionOrNull() as TransferException).error,
        )
        assertTrue(out.received.isFailure)
        assertEquals(0, new.list().size)
    }

    @Test
    fun `a changed byte on the wire is detected`() {
        val old = oldVault().apply { create(pin("482915")) }
        fill(old)
        val new = newVault().apply { create(pin("731904")) }
        val out =
            transfer(old, new, wrapSenderOutput = { raw ->
                object : FilterOutputStream(raw) {
                    var n = 0L

                    override fun write(b: Int) {
                        super.write(if (n++ == 90_000L) b xor 1 else b)
                    }

                    override fun write(
                        b: ByteArray,
                        off: Int,
                        len: Int,
                    ) {
                        for (i in off until off + len) write(b[i].toInt())
                    }
                }
            })
        assertEquals(TransferError.WRONG_PEER, (out.received.exceptionOrNull() as TransferException).error)
        // Items completed before the damage are kept; the damaged one is not.
        for (item in new.list()) readAll(new, item.id)
        assertTrue(new.list().size < 5)
    }

    @Test
    fun `locking the new phone stops the transfer and a rerun resumes`() {
        val old = oldVault().apply { create(pin("482915")) }
        fill(old)
        val new = newVault().apply { create(pin("731904")) }
        var locked = false
        val partial =
            transfer(old, new, wrapSenderOutput = { raw ->
                object : FilterOutputStream(raw) {
                    var bytes = 0L

                    override fun write(
                        b: ByteArray,
                        off: Int,
                        len: Int,
                    ) {
                        bytes += len
                        // The new phone goes to the background part-way through.
                        if (bytes > 40_000 && !locked) {
                            locked = true
                            new.lock()
                        }
                        raw.write(b, off, len)
                    }
                }
            })
        assertEquals(TransferError.LOCKED, (partial.received.exceptionOrNull() as TransferException).error)
        assertTrue(partial.sent.isFailure)
        new.unlock(pin("731904"))
        val before = new.list().size
        assertTrue(before < 5)
        val rerun = transfer(old, new)
        assertEquals(5 - before, rerun.received.getOrThrow().itemsDone)
        assertEquals(5, new.list().size)
    }

    @Test
    fun `cancel on the old phone stops both`() {
        val old = oldVault().apply { create(pin("482915")) }
        fill(old)
        val new = newVault().apply { create(pin("731904")) }
        val out = transfer(old, new, configure = { tx, _ -> tx.cancelled = true })
        assertEquals(TransferError.CANCELLED, (out.sent.exceptionOrNull() as TransferException).error)
        assertEquals(TransferError.CANCELLED, (out.received.exceptionOrNull() as TransferException).error)
        assertEquals(0, new.list().size)
    }

    @Test
    fun `a damaged item on the old phone is skipped, the rest arrive`() {
        val oldRoot = File(dir, "old")
        val old = oldVault().apply { create(pin("482915")) }
        fill(old)
        val victim = old.list().first { it.meta.sizeBytes == 300_000L }
        val data = File(oldRoot, "items/${victim.id}/data")
        val bytes = data.readBytes()
        bytes[bytes.size - 100] = (bytes[bytes.size - 100].toInt() xor 1).toByte()
        data.writeBytes(bytes)

        val new = newVault().apply { create(pin("731904")) }
        val out = transfer(old, new)
        assertEquals(1, out.sent.getOrThrow().skipped)
        assertEquals(1, out.received.getOrThrow().skipped)
        assertEquals(4, new.list().size)
    }

    @Test
    fun `received ids live with the items themselves`() {
        val old = oldVault().apply { create(pin("482915")) }
        fill(old)
        val new = newVault().apply { create(pin("731904")) }
        transfer(old, new).received.getOrThrow()
        assertEquals(old.list().map { it.id }.toSet(), new.receivedSources())
        // Survives a relock.
        new.lock()
        new.unlock(pin("731904"))
        assertEquals(5, new.receivedSources().size)
        // An item deleted on the new phone is sent again next time; nothing else is.
        new.delete(new.list().first().id)
        assertEquals(1, transfer(old, new).received.getOrThrow().itemsDone)
        assertEquals(5, new.list().size)
        // Items imported normally have no source.
        new.importItem(Aead.randomBytes(10).inputStream(), ItemMeta(ItemKind.PHOTO, "image/jpeg", 1))
        assertEquals(5, new.receivedSources().size)
        // A reset clears everything.
        new.destroy()
        val fresh = newVault().apply { create(pin("731904")) }
        assertEquals(emptySet(), fresh.receivedSources())
    }

    @Test
    fun `only the phone's own wifi subnet counts as local`() {
        for (host in listOf("8.8.8.8", "10.0.0.1", "192.168.255.254", "not-an-ip")) {
            // This test machine has no Wi-Fi interface, so nothing is on "the same Wi-Fi".
            if (TransferCode.localAddress() == null) assertFalse(TransferCode.isOnLocalWifi(host))
        }
        assertFalse(TransferCode.isOnLocalWifi("8.8.8.8"))
    }

    @Test
    fun `transfer codes only point at the local network`() {
        val secret = Aead.randomBytes(32)
        val code = TransferCode("192.168.0.23", 50123, secret)
        assertEquals(code, TransferCode.parse(code.encode()))
        for (host in listOf("10.1.2.3", "172.16.0.1", "172.31.255.254", "169.254.3.4", "192.168.43.1")) {
            TransferCode.parse(TransferCode(host, 1, secret).encode())
        }
        for (host in listOf("8.8.8.8", "172.32.0.1", "192.169.0.1", "example.com", "1.2.3", "300.1.1.1", "::1", "")) {
            assertFailsWith<TransferException> { TransferCode.parse(TransferCode(host, 1, secret).encode()) }
        }
        assertFailsWith<TransferException> { TransferCode.parse("PVT1:192.168.0.2:80:short") }
        assertFailsWith<TransferException> { TransferCode.parse("PVT1:192.168.0.2:0:" + code.encode().substringAfterLast(':')) }
        assertFailsWith<TransferException> { TransferCode.parse("hello") }
    }
}
