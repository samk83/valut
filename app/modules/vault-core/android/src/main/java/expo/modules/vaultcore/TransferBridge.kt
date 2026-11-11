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
            // Keep listening until a phone proves it saw the QR code (a stray connection from
            // another device on the Wi-Fi must not use up the code), for up to 10 minutes.
            val deadline = System.currentTimeMillis() + WAIT_MS
            var channel: SecureChannel? = null
            try {
              while (channel == null) {
                val left = deadline - System.currentTimeMillis()
                if (left <= 0) throw TransferException(TransferError.CONNECTION, "No phone connected in time")
                ss.soTimeout = left.toInt()
                val s =
                  try {
                    ss.accept()
                  } catch (e: SocketTimeoutException) {
                    throw TransferException(TransferError.CONNECTION, "No phone connected in time")
                  }
                if (!prepare(s)) return@runTransfer null
                s.soTimeout = HANDSHAKE_MS
                channel =
                  try {
                    SecureChannel.server(s.getInputStream(), s.getOutputStream(), secret)
                  } catch (e: IOException) {
                    runCatching { s.close() }
                    null
                  }
                if (channel != null) s.soTimeout = READ_MS
              }
            } finally {
              runCatching { ss.close() }
            }
            if (isCurrent(Thread.currentThread())) emit(mapOf("phase" to "connected"))
            channel!!.use { ch -> rx.run(ch) { progress(it) } }
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
      // A 10.x address reached through a VPN or mobile data is not "the same Wi-Fi".
      if (!TransferCode.isOnLocalWifi(code.host)) throw CodedException("E_OTHER_NETWORK", "The other phone is not on this Wi-Fi", null)
      val tx = TransferSender(vault()).also { sender = it }
      thread =
        Thread({
          runTransfer {
            val s = Socket()
            if (!prepare(s)) return@runTransfer null
            try {
              s.connect(InetSocketAddress(code.host, code.port), CONNECT_MS)
            } catch (e: IOException) {
              throw TransferException(TransferError.CONNECTION, "Could not reach the other phone")
            }
            s.soTimeout = READ_MS
            s.tcpNoDelay = true
            SecureChannel.client(s.getInputStream(), s.getOutputStream(), code.secret).use { ch ->
              if (isCurrent(Thread.currentThread())) emit(mapOf("phase" to "connected"))
              tx.run(ch) { progress(it) }
            }
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

  /** Adopts [s] as the socket cancel() closes, unless this transfer was already replaced. */
  private fun prepare(s: Socket): Boolean {
    synchronized(lock) {
      if (thread !== Thread.currentThread()) {
        runCatching { s.close() }
        return false
      }
      socket = s
    }
    s.tcpNoDelay = true
    return true
  }

  private fun runTransfer(block: () -> TransferProgress?) {
    val me = Thread.currentThread()
    try {
      val result = block() ?: return
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
    // Long enough for the new phone to verify a large video before it answers.
    const val READ_MS = 180_000
    const val HANDSHAKE_MS = 10_000
  }
}
