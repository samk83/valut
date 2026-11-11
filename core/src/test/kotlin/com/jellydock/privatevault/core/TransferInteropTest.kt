package com.jellydock.privatevault.core

import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Android <-> iPhone check: transfers between this Kotlin core and the Swift core over a real
 * socket. Runs only when PV_SWIFT_PEER points at the built Swift peer
 * (app/modules/vault-core/ios: `swift build -c release -Xswiftc -enable-testing --product TransferPeer`).
 */
class TransferInteropTest {
    @TempDir
    lateinit var dir: File

    private val peer: String? = System.getenv("PV_SWIFT_PEER")

    private fun items(v: Vault): List<String> =
        v.list().sortedBy { it.meta.createdAtEpochMs }.map { item ->
            val digest = MessageDigest.getInstance("SHA-256")
            v.read(
                item.id,
                object : OutputStream() {
                    override fun write(b: Int) = digest.update(b.toByte())

                    override fun write(
                        b: ByteArray,
                        off: Int,
                        len: Int,
                    ) = digest.update(b, off, len)
                },
            )
            val hex = { b: ByteArray -> b.joinToString("") { "%02x".format(it) } }
            "ITEM ${item.meta.createdAtEpochMs} ${item.meta.kind.name} ${item.meta.mimeType} ${hex(
                digest.digest(),
            )} ${v.thumbnail(item.id)?.let(hex) ?: "-"}"
        }

    private fun fill(v: Vault) {
        listOf(0, 1, 4096, 20_000, 300_000).forEachIndexed { i, size ->
            val meta =
                ItemMeta(
                    if (i % 2 == 0) ItemKind.PHOTO else ItemKind.VIDEO,
                    if (i % 2 == 0) "image/jpeg" else "video/mp4",
                    1_700_000_000_000 + i,
                )
            v.importItem(Aead.randomBytes(size).inputStream(), meta, thumbnail = if (i == 3) null else byteArrayOf(i.toByte(), 9, 9))
        }
    }

    @Test
    fun `android sends to iphone`() {
        assumeTrue(peer != null, "PV_SWIFT_PEER not set")
        val old = Vault(File(dir, "old"), FakeHardwareKey(), TEST_PARAMS, 4096).apply { create(pin("482915")) }
        fill(old)
        val process = ProcessBuilder(peer, "receive", File(dir, "swift").path).redirectErrorStream(true).start()
        val out = process.inputStream.bufferedReader()
        val codeLine = out.readLine()
        check(codeLine.startsWith("CODE ")) { codeLine }
        val code = TransferCode.parse(codeLine.removePrefix("CODE "))
        Socket(code.host, code.port).use { s ->
            SecureChannel.client(s.getInputStream(), s.getOutputStream(), code.secret).use { TransferSender(old).run(it) }
        }
        val lines = out.readLines()
        process.waitFor(30, TimeUnit.SECONDS)
        assertEquals(0, process.exitValue(), lines.joinToString("\n"))
        assertEquals("DONE 5", lines.last())
        assertEquals(items(old), lines.filter { it.startsWith("ITEM ") })
    }

    @Test
    fun `iphone sends to android`() {
        assumeTrue(peer != null, "PV_SWIFT_PEER not set")
        val new = Vault(File(dir, "new"), FakeHardwareKey(), TEST_PARAMS, 8192).apply { create(pin("731904")) }
        val secret = Aead.randomBytes(32)
        val server = ServerSocket(0, 1, InetAddress.getLoopbackAddress())
        val pool = Executors.newSingleThreadExecutor()
        val rx =
            pool.submit<TransferProgress> {
                server.use {
                        ss ->
                    ss.accept().use {
                            s ->
                        SecureChannel.server(s.getInputStream(), s.getOutputStream(), secret).use { TransferReceiver(new).run(it) }
                    }
                }
            }
        val code = TransferCode("127.0.0.1", server.localPort, secret).encode()
        val process = ProcessBuilder(peer, "send", File(dir, "swift").path, code).redirectErrorStream(true).start()
        val lines = process.inputStream.bufferedReader().readLines()
        process.waitFor(30, TimeUnit.SECONDS)
        assertEquals(0, process.exitValue(), lines.joinToString("\n"))
        assertEquals(5, rx.get(30, TimeUnit.SECONDS).itemsDone)
        pool.shutdown()
        assertEquals(lines.filter { it.startsWith("ITEM ") }, items(new))
    }
}
