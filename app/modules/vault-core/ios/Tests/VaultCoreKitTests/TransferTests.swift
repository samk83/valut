import Foundation
import XCTest

@testable import VaultCoreKit

/// Mirrors core/src/test/.../TransferTest.kt over a real loopback TCP connection.
final class TransferTests: XCTestCase {
  private var dir: URL!
  private let small = try! Argon2Params(memoryKiB: 64, iterations: 1, parallelism: 1)
  private let oldPin = Array("482915".utf8)
  private let newPin = Array("731904".utf8)

  override func setUpWithError() throws {
    dir = FileManager.default.temporaryDirectory.appendingPathComponent("transfer-test-\(UUID().uuidString)")
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: dir)
  }

  private func makeVault(_ name: String, chunk: Int) throws -> Vault {
    try Vault(root: dir.appendingPathComponent(name), hardwareKey: FakeHardwareKey(), params: small, chunkSize: chunk)
  }

  private func readAll(_ v: Vault, _ id: String) throws -> [UInt8] {
    let sink = MemorySink()
    try v.read(id: id, output: sink)
    return sink.bytes
  }

  @discardableResult
  private func fill(_ v: Vault) throws -> [Int64: [UInt8]] {
    var contents: [Int64: [UInt8]] = [:]
    for (i, size) in [0, 1, 4096, 20_000, 300_000].enumerated() {
      let data = Primitives.randomBytes(size)
      let meta = ItemMeta(kind: i % 2 == 0 ? .PHOTO : .VIDEO, mimeType: i % 2 == 0 ? "image/jpeg" : "video/mp4", createdAtEpochMs: 1_700_000_000_000 + Int64(i))
      _ = try v.importItem(content: MemorySource(data), meta: meta, thumbnail: i == 3 ? nil : [UInt8(i), 9, 9])
      contents[meta.createdAtEpochMs] = data
    }
    return contents
  }

  /// Stream wrapper that lets a test damage or watch what the sender writes.
  private final class TapStream: TransferStream {
    let inner: TransferStream
    let onWrite: ([UInt8]) -> [UInt8]
    init(_ inner: TransferStream, _ onWrite: @escaping ([UInt8]) -> [UInt8]) {
      self.inner = inner
      self.onWrite = onWrite
    }

    func readFully(_ count: Int) throws -> [UInt8] { try inner.readFully(count) }
    func writeAll(_ bytes: [UInt8]) throws { try inner.writeAll(onWrite(bytes)) }
    func close() { inner.close() }
  }

  private struct Outcome {
    var sent: Result<TransferProgress, Error>
    var received: Result<TransferProgress, Error>
  }

  private func transfer(_ from: Vault, _ to: Vault, wrongSecret: Bool = false, tap: (([UInt8]) -> [UInt8])? = nil,
                        configure: (TransferSender, TransferReceiver) -> Void = { _, _ in }) throws -> Outcome {
    let secret = Primitives.randomBytes(32)
    let listener = try TransferListener(host: "127.0.0.1")
    let code = TransferCode(host: "127.0.0.1", port: listener.port, secret: secret)
    let sender = TransferSender(vault: from)
    let receiver = TransferReceiver(vault: to)
    configure(sender, receiver)
    final class Box: @unchecked Sendable { var value: Result<TransferProgress, Error> = .failure(TransferFailure(.other, "not run")) }
    let received = Box()
    let done = DispatchSemaphore(value: 0)
    Thread {
      received.value = Result {
        let stream = try listener.accept(timeoutSeconds: 10)
        let channel = try SecureChannel.server(stream, secret: secret)
        defer { channel.close() }
        return try receiver.run(channel)
      }
      done.signal()
    }.start()
    let parsed = try TransferCode.parse(code.encode())
    let sent = Result { () throws -> TransferProgress in
      var stream: TransferStream = try SocketStream.connect(host: parsed.host, port: parsed.port)
      if let tap = tap { stream = TapStream(stream, tap) }
      let channel = try SecureChannel.client(stream, secret: wrongSecret ? Primitives.randomBytes(32) : parsed.secret)
      defer { channel.close() }
      return try sender.run(channel)
    }
    XCTAssertEqual(done.wait(timeout: .now() + 30), .success)
    return Outcome(sent: sent, received: received.value)
  }

  private func failure(_ r: Result<TransferProgress, Error>) -> TransferError? {
    if case .failure(let e) = r { return (e as? TransferFailure)?.error }
    return nil
  }

  func testAllItemsArriveIntact() throws {
    let old = try makeVault("old", chunk: 4096)
    try old.create(pin: oldPin)
    let contents = try fill(old)
    let new = try makeVault("new", chunk: 8192)
    try new.create(pin: newPin)

    let out = try transfer(old, new)
    XCTAssertEqual(try out.sent.get().itemsDone, 5)
    XCTAssertEqual(try out.received.get().itemsDone, 5)
    let got = try new.list()
    XCTAssertEqual(got.count, 5)
    for item in got {
      let original = try old.list().first { $0.meta.createdAtEpochMs == item.meta.createdAtEpochMs }!
      XCTAssertEqual(original.meta, item.meta)
      XCTAssertEqual(try readAll(new, item.id), contents[item.meta.createdAtEpochMs])
      XCTAssertEqual(try old.thumbnail(id: original.id), try new.thumbnail(id: item.id))
    }
    XCTAssertEqual(try old.list().count, 5)
    new.lock()
    XCTAssertThrowsError(try new.unlock(pin: oldPin))
  }

  func testRerunSendsOnlyMissing() throws {
    let old = try makeVault("old", chunk: 4096)
    try old.create(pin: oldPin)
    try fill(old)
    let new = try makeVault("new", chunk: 4096)
    try new.create(pin: newPin)
    _ = try transfer(old, new).received.get()
    _ = try old.importItem(content: MemorySource(Primitives.randomBytes(5000)), meta: ItemMeta(kind: .PHOTO, mimeType: "image/png", createdAtEpochMs: 5))
    let second = try transfer(old, new)
    XCTAssertEqual(try second.received.get().itemsDone, 1)
    XCTAssertEqual(try second.received.get().alreadyThere, 5)
    XCTAssertEqual(try new.list().count, 6)
  }

  func testWrongSecretStoresNothing() throws {
    let old = try makeVault("old", chunk: 4096)
    try old.create(pin: oldPin)
    try fill(old)
    let new = try makeVault("new", chunk: 4096)
    try new.create(pin: newPin)
    let out = try transfer(old, new, wrongSecret: true)
    XCTAssertEqual(failure(out.received), .wrongPeer)
    XCTAssertNotNil(failure(out.sent))
    XCTAssertEqual(try new.list().count, 0)
  }

  func testChangedByteIsDetected() throws {
    let old = try makeVault("old", chunk: 4096)
    try old.create(pin: oldPin)
    try fill(old)
    let new = try makeVault("new", chunk: 4096)
    try new.create(pin: newPin)
    var total = 0
    let out = try transfer(old, new, tap: { bytes in
      var b = bytes
      if total <= 90_000 && total + b.count > 90_000 { b[90_000 - total] ^= 1 }
      total += bytes.count
      return b
    })
    XCTAssertEqual(failure(out.received), .wrongPeer)
    for item in try new.list() { _ = try readAll(new, item.id) }
    XCTAssertLessThan(try new.list().count, 5)
  }

  func testLockStopsAndRerunResumes() throws {
    let old = try makeVault("old", chunk: 4096)
    try old.create(pin: oldPin)
    try fill(old)
    let new = try makeVault("new", chunk: 4096)
    try new.create(pin: newPin)
    var total = 0
    var locked = false
    let out = try transfer(old, new, tap: { bytes in
      total += bytes.count
      if total > 40_000 && !locked {
        locked = true
        new.lock()
      }
      return bytes
    })
    XCTAssertEqual(failure(out.received), .locked)
    XCTAssertNotNil(failure(out.sent))
    try new.unlock(pin: newPin)
    let before = try new.list().count
    XCTAssertLessThan(before, 5)
    let rerun = try transfer(old, new)
    XCTAssertEqual(try rerun.received.get().itemsDone, 5 - before)
    XCTAssertEqual(try new.list().count, 5)
  }

  func testCancelStopsBoth() throws {
    let old = try makeVault("old", chunk: 4096)
    try old.create(pin: oldPin)
    try fill(old)
    let new = try makeVault("new", chunk: 4096)
    try new.create(pin: newPin)
    let out = try transfer(old, new, configure: { tx, _ in tx.cancelled = true })
    XCTAssertEqual(failure(out.sent), .cancelled)
    XCTAssertEqual(failure(out.received), .cancelled)
    XCTAssertEqual(try new.list().count, 0)
  }

  func testDamagedItemIsSkipped() throws {
    let old = try makeVault("old", chunk: 4096)
    try old.create(pin: oldPin)
    try fill(old)
    let victim = try old.list().first { $0.meta.sizeBytes == 300_000 }!
    let data = dir.appendingPathComponent("old/items/\(victim.id)/data")
    var bytes = try SecureFiles.readBytes(data)
    bytes[bytes.count - 100] ^= 1
    try Data(bytes).write(to: data)
    let new = try makeVault("new", chunk: 4096)
    try new.create(pin: newPin)
    let out = try transfer(old, new)
    XCTAssertEqual(try out.sent.get().skipped, 1)
    XCTAssertEqual(try out.received.get().skipped, 1)
    XCTAssertEqual(try new.list().count, 4)
  }

  func testReceivedListSurvivesCutRecord() throws {
    let v = try makeVault("new", chunk: 4096)
    try v.create(pin: newPin)
    let a = "0123456789abcdef0123456789abcdef"
    let b = "fedcba9876543210fedcba9876543210"
    try v.addReceivedSource(a)
    let file = dir.appendingPathComponent("new/items/received-sources")
    let handle = try FileHandle(forWritingTo: file)
    handle.seekToEndOfFile()
    handle.write(Data(count: 10))
    handle.closeFile()
    try v.addReceivedSource(b)
    XCTAssertEqual(try v.receivedSources(), [a, b])
    try v.destroy()
    let fresh = try makeVault("new", chunk: 4096)
    try fresh.create(pin: newPin)
    XCTAssertEqual(try fresh.receivedSources(), [])
  }

  func testCodesOnlyPointAtLocalNetwork() throws {
    let secret = Primitives.randomBytes(32)
    let code = TransferCode(host: "192.168.0.23", port: 50123, secret: secret)
    XCTAssertEqual(try TransferCode.parse(code.encode()), code)
    for host in ["10.1.2.3", "172.16.0.1", "172.31.255.254", "169.254.3.4", "192.168.43.1"] {
      XCTAssertNoThrow(try TransferCode.parse(TransferCode(host: host, port: 1, secret: secret).encode()))
    }
    for host in ["8.8.8.8", "172.32.0.1", "192.169.0.1", "example.com", "1.2.3", "300.1.1.1", "::1", ""] {
      XCTAssertThrowsError(try TransferCode.parse(TransferCode(host: host, port: 1, secret: secret).encode()))
    }
    XCTAssertThrowsError(try TransferCode.parse("PVT1:192.168.0.2:80:short"))
    XCTAssertThrowsError(try TransferCode.parse("hello"))
  }

  /// The same QR text decodes identically on both platforms (value produced by the Kotlin core).
  func testCodeMatchesKotlinEncoding() throws {
    let secret = (0..<32).map { UInt8($0 * 7 & 0xFF) }
    XCTAssertEqual(TransferCode(host: "192.168.1.5", port: 41234, secret: secret).encode(),
                   "PVT1:192.168.1.5:41234:AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qhqK-2vcTL0tk")
  }

  /// The app-facing bridge on both phones: QR text out, events in, cancel stops it.
  func testBridgeEndToEnd() throws {
    let old = try makeVault("old", chunk: 4096)
    try old.create(pin: oldPin)
    try fill(old)
    let new = try makeVault("new", chunk: 4096)
    try new.create(pin: newPin)
    let events = NSLock()
    var rxEvents: [[String: Any]] = []
    var txEvents: [[String: Any]] = []
    let rxDone = DispatchSemaphore(value: 0)
    let txDone = DispatchSemaphore(value: 0)
    let rx = TransferBridge(vault: { new }, localHost: { "127.0.0.1" }) { e in
      events.lock(); rxEvents.append(e); events.unlock()
      if ["done", "error"].contains(e["phase"] as? String) { rxDone.signal() }
    }
    let tx = TransferBridge(vault: { old }) { e in
      events.lock(); txEvents.append(e); events.unlock()
      if ["done", "error"].contains(e["phase"] as? String) { txDone.signal() }
    }
    let code = try rx.startReceiving()
    XCTAssertThrowsError(try tx.startSending("PVT1:8.8.8.8:1:" + TransferCode.base64url(Primitives.randomBytes(32))))
    try tx.startSending(code)
    XCTAssertEqual(rxDone.wait(timeout: .now() + 30), .success)
    XCTAssertEqual(txDone.wait(timeout: .now() + 30), .success)
    XCTAssertEqual(rxEvents.first?["phase"] as? String, "waiting")
    XCTAssertEqual(rxEvents.last?["phase"] as? String, "done")
    XCTAssertEqual(rxEvents.last?["itemsDone"] as? Int, 5)
    XCTAssertEqual(txEvents.last?["phase"] as? String, "done")
    XCTAssertEqual(try new.list().count, 5)

    // Cancel while waiting: no events afterwards, and a new start works.
    _ = try rx.startReceiving()
    rx.cancel()
    let count = rxEvents.count
    Thread.sleep(forTimeInterval: 1.5)
    XCTAssertEqual(rxEvents.count, count)
    new.lock()
    XCTAssertThrowsError(try rx.startReceiving())
  }
}
