import Foundation

/// Runs one vault transfer at a time on its own thread (it can take minutes, so it must not
/// hold the module's serial queue) and reports through [emit] — same events as
/// android/.../TransferBridge.kt:
///   ["phase": "waiting" | "connected" | "progress" | "done" | "error", ...progress, "error"?]
final class TransferBridge {
  private let vault: () throws -> Vault
  private let emit: ([String: Any]) -> Void
  private let localHost: () -> String?
  private let lock = NSLock()
  private var generation = 0
  private var listener: TransferListener?
  private var stream: SocketStream?
  private var sender: TransferSender?
  private var receiver: TransferReceiver?

  /// [localHost] is the address to listen on; tests pass loopback.
  init(vault: @escaping () throws -> Vault, localHost: @escaping () -> String? = TransferCode.localAddress,
       emit: @escaping ([String: Any]) -> Void) {
    self.vault = vault
    self.localHost = localHost
    self.emit = emit
  }

  /// New phone: listen on the Wi-Fi address and return the QR text.
  func startReceiving() throws -> String {
    lock.lock()
    defer { lock.unlock() }
    cancelLocked()
    let v = try vault()
    guard v.isUnlocked else { throw TransferFailure(.locked, "Vault is locked") }
    guard let host = localHost() else { throw TransferFailure(.connection, "No Wi-Fi or hotspot connection") }
    let secret = Primitives.randomBytes(TransferCode.secretBytes)
    let l = try TransferListener(host: host)
    listener = l
    let rx = TransferReceiver(vault: v)
    receiver = rx
    let code = TransferCode(host: host, port: l.port, secret: secret).encode()
    let mine = generation
    emit(["phase": "waiting"])
    Thread { [weak self] in
      self?.runTransfer(mine) {
        let s = try l.accept(timeoutSeconds: 10 * 60)
        self?.adopt(s, mine)
        self?.emitIfCurrent(mine, ["phase": "connected"])
        let channel = try SecureChannel.server(s, secret: secret)
        defer { channel.close() }
        return try rx.run(channel) { p in self?.emitIfCurrent(mine, TransferBridge.map("progress", p)) }
      }
    }.start()
    return code
  }

  /// Old phone: connect to the scanned code and send.
  func startSending(_ text: String) throws {
    lock.lock()
    defer { lock.unlock() }
    cancelLocked()
    let v = try vault()
    guard v.isUnlocked else { throw TransferFailure(.locked, "Vault is locked") }
    let code = try TransferCode.parse(text)
    let tx = TransferSender(vault: v)
    sender = tx
    let mine = generation
    Thread { [weak self] in
      self?.runTransfer(mine) {
        let s = try SocketStream.connect(host: code.host, port: code.port)
        self?.adopt(s, mine)
        self?.emitIfCurrent(mine, ["phase": "connected"])
        let channel = try SecureChannel.client(s, secret: code.secret)
        defer { channel.close() }
        return try tx.run(channel) { p in self?.emitIfCurrent(mine, TransferBridge.map("progress", p)) }
      }
    }.start()
  }

  func cancel() {
    lock.lock()
    defer { lock.unlock() }
    cancelLocked()
  }

  private func cancelLocked() {
    generation += 1
    sender?.cancelled = true
    receiver?.cancelled = true
    listener?.close()
    stream?.close()
    listener = nil
    stream = nil
    sender = nil
    receiver = nil
  }

  private func adopt(_ s: SocketStream, _ gen: Int) {
    lock.lock()
    defer { lock.unlock() }
    if gen == generation { stream = s } else { s.close() }
  }

  private func emitIfCurrent(_ gen: Int, _ event: [String: Any]) {
    lock.lock()
    let current = gen == generation
    lock.unlock()
    if current { emit(event) }
  }

  private func runTransfer(_ gen: Int, _ block: () throws -> TransferProgress) {
    do {
      emitIfCurrent(gen, TransferBridge.map("done", try block()))
    } catch let f as TransferFailure {
      emitIfCurrent(gen, ["phase": "error", "error": f.error.name])
    } catch {
      emitIfCurrent(gen, ["phase": "error", "error": TransferError.other.name])
    }
    lock.lock()
    if gen == generation {
      stream?.close()
      listener?.close()
      stream = nil
      listener = nil
      sender = nil
      receiver = nil
    }
    lock.unlock()
  }

  static func map(_ phase: String, _ p: TransferProgress) -> [String: Any] {
    ["phase": phase, "itemsDone": p.itemsDone, "itemsTotal": p.itemsTotal, "bytesDone": Double(p.bytesDone),
     "bytesTotal": Double(p.bytesTotal), "skipped": p.skipped, "alreadyThere": p.alreadyThere]
  }
}
