package expo.modules.vaultcore

import com.jellydock.privatevault.core.Aead
import com.jellydock.privatevault.core.SecureChannel
import com.jellydock.privatevault.core.TransferCode
import com.jellydock.privatevault.core.TransferError
import com.jellydock.privatevault.core.TransferException
import com.jellydock.privatevault.core.TransferProgress
import com.jellydock.privatevault.core.TransferReceiver
import com.jellydock.privatevault.core.TransferSender
import com.jellydock.privatevault.core.Vault
import expo.modules.kotlin.exception.CodedException
import java.io.IOException
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException

/**
 * Runs one vault transfer at a time on its own thread (it can take minutes, so it must not
 * hold the module's call queue) and reports to JS through [emit]:
 *   { phase: "waiting" | "connected" | "progress" | "done" | "error", ...progress, error? }
 */
internal class TransferBridge(
  private val vault: () -> Vault,
  private val emit: (Map<String, Any?>) -> Unit,
) {
  private val lock = Any()
  private var thread: Thread? = null
  private var server: ServerSocket? = null
  private var socket: Socket? = null
  private var sender: TransferSender? = null
  private var receiver: TransferReceiver? = null

  /** New phone: listen on the Wi-Fi address and return the QR text. */
  fun startReceiving(): String {
    synchronized(lock) {
      cancelLocked()
      if (!vault().isUnlocked) throw CodedException("E_LOCKED", "Vault is locked", null)
      val address = TransferCode.localAddress() ?: throw CodedException("E_NO_WIFI", "No Wi-Fi or hotspot connection", null)
      val secret = Aead.randomBytes(TransferCode.SECRET_BYTES)
      val ss = ServerSocket()
      ss.bind(InetSocketAddress(address, 0), 1)
      ss.soTimeout = WAIT_MS
      server = ss
      val rx = TransferReceiver(vault()).also { receiver = it }
      val code = TransferCode(address.hostAddress ?: "", ss.localPort, secret.copyOf()).encode()
      thread =
        Thread({
          runTransfer {
            val s =
              try {
                ss.accept()
              } catch (e: SocketTimeoutException) {
                throw TransferException(TransferError.CONNECTION, "No phone connected in time")
              } finally {
                runCatching { ss.close() }
              }
            prepare(s)
            emit(mapOf("phase" to "connected"))
            SecureChannel.server(s.getInputStream(), s.getOutputStream(), secret).use { ch -> rx.run(ch) { progress(it) } }
          }
          secret.fill(0)
        }, "vault-transfer-rx").apply { start() }
      emit(mapOf("phase" to "waiting"))
      return code
    }
  }

  /** Old phone: connect to the scanned code and send. */
  fun startSending(text: String) {
    synchronized(lock) {
      cancelLocked()
      if (!vault().isUnlocked) throw CodedException("E_LOCKED", "Vault is locked", null)
      val code =
        try {
          TransferCode.parse(text)
        } catch (e: TransferException) {
          throw CodedException("E_BAD_CODE", "This is not a PrivateVault transfer code", null)
        }
      val tx = TransferSender(vault()).also { sender = it }
      thread =
        Thread({
          runTransfer {
            val s = Socket()
            synchronized(lock) { socket = s }
            try {
              s.connect(InetSocketAddress(code.host, code.port), CONNECT_MS)
            } catch (e: IOException) {
              throw TransferException(TransferError.CONNECTION, "Could not reach the other phone")
            }
            prepare(s)
            emit(mapOf("phase" to "connected"))
            SecureChannel.client(s.getInputStream(), s.getOutputStream(), code.secret).use { ch -> tx.run(ch) { progress(it) } }
          }
          code.secret.fill(0)
        }, "vault-transfer-tx").apply { start() }
    }
  }

  fun cancel() = synchronized(lock) { cancelLocked() }

  private fun cancelLocked() {
    sender?.cancelled = true
    receiver?.cancelled = true
    runCatching { server?.close() }
    runCatching { socket?.close() }
    thread = null
    server = null
    socket = null
    sender = null
    receiver = null
  }

  private fun prepare(s: Socket) {
    synchronized(lock) { socket = s }
    s.soTimeout = READ_MS
    s.tcpNoDelay = true
  }

  private fun runTransfer(block: () -> TransferProgress) {
    val me = Thread.currentThread()
    try {
      val result = block()
      if (isCurrent(me)) emit(progressMap("done", result))
    } catch (e: TransferException) {
      if (isCurrent(me)) emit(mapOf("phase" to "error", "error" to e.error.name))
    } catch (e: SocketTimeoutException) {
      if (isCurrent(me)) emit(mapOf("phase" to "error", "error" to TransferError.CONNECTION.name))
    } catch (e: IOException) {
      // A closed socket after cancel() lands here too; then nobody is listening any more.
      if (isCurrent(me)) emit(mapOf("phase" to "error", "error" to TransferError.CONNECTION.name))
    } catch (e: Exception) {
      if (isCurrent(me)) emit(mapOf("phase" to "error", "error" to TransferError.OTHER.name))
    } finally {
      synchronized(lock) {
        if (thread === me) {
          runCatching { socket?.close() }
          thread = null
          socket = null
          server = null
          sender = null
          receiver = null
        }
      }
    }
  }

  private fun isCurrent(t: Thread) = synchronized(lock) { thread === t }

  private fun progress(p: TransferProgress) = emit(progressMap("progress", p))

  private fun progressMap(
    phase: String,
    p: TransferProgress,
  ) = mapOf(
    "phase" to phase,
    "itemsDone" to p.itemsDone,
    "itemsTotal" to p.itemsTotal,
    "bytesDone" to p.bytesDone.toDouble(),
    "bytesTotal" to p.bytesTotal.toDouble(),
    "skipped" to p.skipped,
    "alreadyThere" to p.alreadyThere,
  )

  private companion object {
    const val WAIT_MS = 10 * 60 * 1000
    const val CONNECT_MS = 10_000
    const val READ_MS = 60_000
  }
}
