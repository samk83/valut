import Foundation
import XCTest

@testable import VaultCoreKit

private func hex(_ b: [UInt8]) -> String { b.map { String(format: "%02x", $0) }.joined() }

private func bytes(_ hexString: String) -> [UInt8] {
  let c = Array(hexString.utf8)
  return stride(from: 0, to: c.count, by: 2).map { UInt8(String(decoding: c[$0..<$0 + 2], as: UTF8.self), radix: 16)! }
}

/// In-memory stand-in for the Secure Enclave key (same contract as the Kotlin FakeHardwareKey).
final class FakeHardwareKey: HardwareKey {
  var key: [UInt8]?
  var failNextMix = false
  func exists() -> Bool { key != nil }
  func create() throws { key = Primitives.randomBytes(32) }
  func mix(_ data: [UInt8]) throws -> [UInt8] {
    if failNextMix {
      failNextMix = false
      throw VaultError.io("chip error")
    }
    guard let k = key else { throw VaultError.keysUnavailable }
    return Primitives.hmacSha256(key: k, data: data)
  }
  func destroy() throws { key = nil }
}

final class MemorySource: ByteSource {
  private let data: [UInt8]
  private var pos = 0
  init(_ d: [UInt8]) { data = d }
  func read(into buffer: inout [UInt8], offset: Int, max: Int) throws -> Int {
    let n = min(max, data.count - pos)
    for i in 0..<n { buffer[offset + i] = data[pos + i] }
    pos += n
    return n
  }
}

final class Argon2Tests: XCTestCase {
  func testBlake2bKnownAnswer() {
    XCTAssertEqual(hex(Blake2b.hash(Array("abc".utf8), outLength: 64)),
                   "ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923")
  }

  /// RFC 9106 section 5.3 test vector.
  func testRfc9106Argon2id() {
    let tag = Argon2.hash(password: [UInt8](repeating: 1, count: 32), salt: [UInt8](repeating: 2, count: 16), memoryKiB: 32,
                          iterations: 3, parallelism: 4, length: 32, secret: [UInt8](repeating: 3, count: 8),
                          associatedData: [UInt8](repeating: 4, count: 12))
    XCTAssertEqual(hex(tag), "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659")
  }

  /// Same output as BouncyCastle (what the Android app uses), so both apps derive identically.
  func testMatchesBouncyCastle() throws {
    let salt = (0..<16).map { UInt8($0) }
    XCTAssertEqual(hex(Kdf.argon2id(pin: Array("135792468".utf8), salt: salt, params: try Argon2Params(memoryKiB: 256, iterations: 3, parallelism: 1))),
                   "aaaaceaafe2ac267bce0520d997c28a22e2d34b59d11bbaa1b498279a745b0f7")
    XCTAssertEqual(hex(Kdf.argon2id(pin: Array("8024".utf8), salt: salt, params: try Argon2Params(memoryKiB: 1024, iterations: 2, parallelism: 2))),
                   "92188148edac183f7a1f8577e57a1f85bd06eef2ebdf4facca1d9f15747d2dec")
  }

  /// The phone setting (64 MiB, t=3), also timed to show the cost per guess.
  func testPhoneParams() throws {
    let start = Date()
    let out = Kdf.argon2id(pin: Array("135792468".utf8), salt: (0..<16).map { UInt8($0) }, params: .phone)
    print("Argon2id 64 MiB t=3: \(Date().timeIntervalSince(start))s")
    XCTAssertEqual(hex(out), "61d8264bd8312ef839d535f92144b0055269687f3a9ec3ce39245e903ac4bd00")
  }

  /// RFC 5869 test case 1.
  func testHkdf() {
    let okm = Kdf.hkdfSha256(ikm: [UInt8](repeating: 0x0b, count: 22), salt: bytes("000102030405060708090a0b0c"),
                             info: bytes("f0f1f2f3f4f5f6f7f8f9"), length: 42)
    XCTAssertEqual(hex(okm), "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865")
  }

  func testInvalidParamsRejected() {
    XCTAssertThrowsError(try Argon2Params(memoryKiB: 4, iterations: 1, parallelism: 1))
    XCTAssertThrowsError(try Argon2Params(memoryKiB: 2 * 1024 * 1024, iterations: 1, parallelism: 1))
    XCTAssertThrowsError(try Argon2Params(memoryKiB: 64, iterations: 17, parallelism: 1))
  }
}

final class PinPolicyTests: XCTestCase {
  func testRules() {
    XCTAssertEqual(PinPolicy.check(Array("123".utf8)), .TOO_SHORT)
    XCTAssertEqual(PinPolicy.check(Array("1111".utf8)), .REPEATED)
    XCTAssertEqual(PinPolicy.check(Array("3456".utf8)), .SEQUENTIAL)
    XCTAssertEqual(PinPolicy.check(Array("9876".utf8)), .SEQUENTIAL)
    XCTAssertEqual(PinPolicy.check(Array("2580".utf8)), .COMMON)
    XCTAssertEqual(PinPolicy.check(Array("12a4".utf8)), .NOT_DIGITS)
    XCTAssertNil(PinPolicy.check(Array("8024".utf8)))
    XCTAssertFalse(PinPolicy.isCompleteEntry(Array("80".utf8)))
    XCTAssertEqual(PinPolicy.strength(length: 10), .FORTRESS)
  }
}

final class VaultTests: XCTestCase {
  private var root: URL!
  private var chip: FakeHardwareKey!
  private let pin = Array("8024".utf8)
  private let small = try! Argon2Params(memoryKiB: 64, iterations: 1, parallelism: 1)
  private var clock: FakeClock!

  override func setUpWithError() throws {
    root = FileManager.default.temporaryDirectory.appendingPathComponent("vault-test-\(UUID().uuidString)")
    chip = FakeHardwareKey()
    clock = FakeClock()
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: root)
  }

  private func vault(chunk: Int = 1024) throws -> Vault {
    try Vault(root: root, hardwareKey: chip, params: small, chunkSize: chunk, clock: clock)
  }

  private func importBytes(_ v: Vault, _ data: [UInt8], kind: ItemKind = .PHOTO) throws -> ImportResult {
    try v.importItem(content: MemorySource(data), meta: ItemMeta(kind: kind, mimeType: "image/jpeg", createdAtEpochMs: 1),
                     thumbnail: [9, 9], expectedSha256: Primitives.sha256(data))
  }

  func testCreateImportReadAcrossRestart() throws {
    let data = Primitives.randomBytes(5000)
    var v = try vault()
    try v.create(pin: pin)
    let r = try importBytes(v, data)
    XCTAssertTrue(r.safeToDeleteOriginal)
    v.lock()
    XCTAssertThrowsError(try v.list())
    v = try vault()
    try v.unlock(pin: pin)
    let items = try v.list()
    XCTAssertEqual(items.count, 1)
    XCTAssertEqual(items[0].meta.sizeBytes, 5000)
    let out = MemorySink()
    try v.read(id: r.item.id, output: out)
    XCTAssertEqual(out.bytes, data)
    XCTAssertEqual(try v.thumbnail(id: r.item.id), [9, 9])
    XCTAssertEqual(try v.readChunk(id: r.item.id, index: 4), Array(data[4096..<5000]))
    try v.delete(id: r.item.id)
    XCTAssertEqual(try v.list().count, 0)
  }

  func testEmptyAndExactChunkFiles() throws {
    let v = try vault()
    try v.create(pin: pin)
    for size in [0, 1024, 2048] {
      let data = Primitives.randomBytes(size)
      let r = try importBytes(v, data)
      let out = MemorySink()
      try v.read(id: r.item.id, output: out)
      XCTAssertEqual(out.bytes, data)
    }
  }

  func testWrongPinsNeverEraseAndWaitsGrow() throws {
    let v = try vault()
    try v.create(pin: pin)
    let data: [UInt8] = [1, 2, 3]
    let id = try importBytes(v, data).item.id
    v.lock()
    let wrong = Array("1357".utf8)
    XCTAssertThrowsError(try v.unlock(pin: wrong)) { XCTAssertEqual($0 as? VaultError, .wrongPin(remaining: 2, waitMs: 0)) }
    XCTAssertThrowsError(try v.unlock(pin: wrong)) { XCTAssertEqual($0 as? VaultError, .wrongPin(remaining: 1, waitMs: 0)) }
    XCTAssertThrowsError(try v.unlock(pin: wrong)) { XCTAssertEqual($0 as? VaultError, .wrongPin(remaining: 0, waitMs: 60_000)) }
    XCTAssertThrowsError(try v.unlock(pin: pin)) { XCTAssertEqual($0 as? VaultError, .lockedOut(waitMs: 60_000)) }
    clock.advance(60_000)
    XCTAssertThrowsError(try v.unlock(pin: wrong)) { XCTAssertEqual($0 as? VaultError, .wrongPin(remaining: 0, waitMs: 300_000)) }
    clock.advance(300_000)
    XCTAssertThrowsError(try v.unlock(pin: wrong)) { XCTAssertEqual($0 as? VaultError, .wrongPin(remaining: 0, waitMs: 900_000)) }
    clock.advance(900_000)
    XCTAssertThrowsError(try v.unlock(pin: wrong)) { XCTAssertEqual($0 as? VaultError, .wrongPin(remaining: 0, waitMs: 3_600_000)) }
    clock.advance(3_600_000)
    XCTAssertThrowsError(try v.unlock(pin: wrong)) { XCTAssertEqual($0 as? VaultError, .wrongPin(remaining: 0, waitMs: 3_600_000)) }
    XCTAssertTrue(chip.exists())
    XCTAssertTrue(v.exists())
    // A reboot or a clock change restarts the wait instead of ending it.
    clock.advance(3_000_000)
    clock.reboot()
    XCTAssertEqual(v.lockedForMs(), 3_600_000)
    clock.advance(3_600_000)
    try v.unlock(pin: pin)
    let out = MemorySink()
    try v.read(id: id, output: out)
    XCTAssertEqual(out.bytes, data)
    XCTAssertEqual(v.remainingAttempts(), 3)
  }

  func testCorrectPinOpensWhenCountCannotBeReset() throws {
    let file = FileAttemptCounter(file: root.appendingPathComponent("attempts"))
    let v = try vault()
    try v.create(pin: pin)
    v.lock()
    let keys = VaultKeyManager(envelopeFile: root.appendingPathComponent("vault.key"), counter: NoResetCounter(file), hardwareKey: chip,
                               params: small, clock: clock)
    for _ in 0..<6 { var mk = try keys.unlock(pin: pin); mk.wipe() }
    XCTAssertGreaterThanOrEqual(keys.remainingAttempts(), 2)
    XCTAssertEqual(keys.lockedForMs(), 0)
  }

  func testCorrectPinResetsCount() throws {
    let v = try vault()
    try v.create(pin: pin)
    v.lock()
    XCTAssertThrowsError(try v.unlock(pin: Array("1357".utf8)))
    XCTAssertThrowsError(try v.unlock(pin: Array("1357".utf8)))
    try v.unlock(pin: pin)
    XCTAssertEqual(v.remainingAttempts(), 3)
  }

  func testIncompleteEntryNotCounted() throws {
    let v = try vault()
    try v.create(pin: pin)
    v.lock()
    XCTAssertThrowsError(try v.unlock(pin: Array("12".utf8))) { XCTAssertEqual($0 as? VaultError, .incompleteEntry) }
    XCTAssertEqual(v.remainingAttempts(), 3)
  }

  /// An attempt recorded whose check never finished (app killed) still waits, never erases.
  func testKilledDuringThirdAttemptWaitsAndKeepsVault() throws {
    let v = try vault()
    try v.create(pin: pin)
    v.lock()
    try FileAttemptCounter(file: root.appendingPathComponent("attempts")).write(3)
    XCTAssertThrowsError(try v.unlock(pin: pin)) { XCTAssertEqual($0 as? VaultError, .lockedOut(waitMs: 60_000)) }
    XCTAssertTrue(chip.exists())
    clock.advance(60_000)
    try v.unlock(pin: pin)
  }

  func testChipErrorGivesAttemptBack() throws {
    let v = try vault()
    try v.create(pin: pin)
    v.lock()
    chip.failNextMix = true
    XCTAssertThrowsError(try v.unlock(pin: pin))
    XCTAssertEqual(v.remainingAttempts(), 3)
    try v.unlock(pin: pin)
  }

  func testMissingChipKeyIsNotCounted() throws {
    let v = try vault()
    try v.create(pin: pin)
    v.lock()
    chip.key = nil
    XCTAssertThrowsError(try v.unlock(pin: pin)) { XCTAssertEqual($0 as? VaultError, .keysUnavailable) }
    XCTAssertEqual(v.remainingAttempts(), 3)
  }

  func testWeakPinRefused() throws {
    let v = try vault()
    XCTAssertThrowsError(try v.create(pin: Array("1234".utf8))) { XCTAssertEqual($0 as? VaultError, .weakPin(.SEQUENTIAL)) }
    XCTAssertFalse(v.exists())
  }

  func testEnvelopeBackupRepairsDamagedPrimary() throws {
    let v = try vault()
    try v.create(pin: pin)
    v.lock()
    let primary = root.appendingPathComponent("vault.key")
    try Data([1, 2, 3]).write(to: primary)
    try v.unlock(pin: pin)
    XCTAssertEqual(try SecureFiles.readBytes(primary), try SecureFiles.readBytes(root.appendingPathComponent("vault.key.bak")))
  }

  func testTamperedEnvelopeHeaderCountsAsWrong() throws {
    let v = try vault()
    try v.create(pin: pin)
    v.lock()
    for name in ["vault.key", "vault.key.bak"] {
      let url = root.appendingPathComponent(name)
      var b = try SecureFiles.readBytes(url)
      b[20] ^= 1 // inside the salt: the header is authenticated
      try Data(b).write(to: url)
    }
    XCTAssertThrowsError(try v.unlock(pin: pin)) { XCTAssertEqual($0 as? VaultError, .wrongPin(remaining: 2, waitMs: 0)) }
  }

  func testTamperedOrTruncatedDataIsRejected() throws {
    let v = try vault()
    try v.create(pin: pin)
    let r = try importBytes(v, Primitives.randomBytes(3000))
    let data = root.appendingPathComponent("items/\(r.item.id)/data")
    let original = try SecureFiles.readBytes(data)
    var flipped = original
    flipped[100] ^= 1
    try Data(flipped).write(to: data)
    XCTAssertThrowsError(try v.read(id: r.item.id, output: MemorySink()))
    // Dropping the last chunk must fail too (the last-chunk flag is in the nonce).
    try Data(original[0..<(ChunkedCipher.headerBytes + 2 * (1024 + 16))]).write(to: data)
    XCTAssertThrowsError(try v.read(id: r.item.id, output: MemorySink()))
  }

  func testMetaBackupUsedWhenPrimaryDamaged() throws {
    let v = try vault()
    try v.create(pin: pin)
    let r = try importBytes(v, [5, 6, 7])
    try Data([0]).write(to: root.appendingPathComponent("items/\(r.item.id)/meta"))
    try Data([0]).write(to: root.appendingPathComponent("items/\(r.item.id)/key"))
    XCTAssertEqual(try v.list().map(\.id), [r.item.id])
  }

  func testMismatchedOriginalIsNotRegistered() throws {
    let v = try vault()
    try v.create(pin: pin)
    XCTAssertThrowsError(try v.importItem(content: MemorySource([1, 2, 3]), meta: ItemMeta(kind: .PHOTO, mimeType: "image/jpeg", createdAtEpochMs: 1),
                                          expectedSha256: Primitives.sha256([9]))) {
      if case .importVerification = $0 as? VaultError {} else { XCTFail("\($0)") }
    }
    XCTAssertEqual(try v.list().count, 0)
  }

  func testFreshInstallWipesLeftoverChipKeysOnlyWhenFolderIsEmpty() throws {
    let v = try vault()
    try chip.create() // left in the Keychain by an earlier install
    XCTAssertTrue(try v.wipeLeftoversForFreshInstall())
    XCTAssertFalse(chip.exists())
  }

  func testLostInstallMarkerNeverWipesAVaultThatIsStillHere() throws {
    let v = try vault()
    try v.create(pin: pin)
    let id = try importBytes(v, [1]).item.id
    v.lock()
    XCTAssertFalse(try v.wipeLeftoversForFreshInstall())
    XCTAssertTrue(chip.exists())
    try v.unlock(pin: pin)
    XCTAssertEqual(try v.list().map(\.id), [id])
    for name in ["vault.key", "vault.key.bak", "vault.key.check"] { try FileManager.default.removeItem(at: root.appendingPathComponent(name)) }
    XCTAssertFalse(try v.wipeLeftoversForFreshInstall())
    XCTAssertTrue(SecureFiles.exists(root.appendingPathComponent("items/\(id)")))
  }

  func testCounterSplitUsesTheHigherCopy() throws {
    let c = FileAttemptCounter(file: root.appendingPathComponent("attempts"))
    let bak = root.appendingPathComponent("attempts.bak")
    try SecureFiles.mkdirs(root)
    try c.write(10)
    // Editing one copy never shortens a wait.
    try Data([0, 0, 0, 0]).write(to: bak)
    XCTAssertEqual(c.read(), 10)
    // A backup that cannot be written is removed, so the stale higher copy cannot win.
    try FileManager.default.removeItem(at: bak)
    try FileManager.default.createDirectory(at: bak, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: bak.appendingPathComponent("keep"), withIntermediateDirectories: true)
    try c.write(0)
    XCTAssertEqual(c.read(), 0)
    try FileManager.default.removeItem(at: bak)
    try c.write(0)
    try Data([0, 0, 0, 10]).write(to: bak)
    XCTAssertEqual(c.read(), 10)
    // Both copies gone leaves one attempt.
    try FileManager.default.removeItem(at: root.appendingPathComponent("attempts"))
    try FileManager.default.removeItem(at: bak)
    XCTAssertEqual(c.read(), 2)
  }

  func testSearchNoteSealedPerItemAndRemovedWithIt() throws {
    let data = Primitives.randomBytes(3000)
    let v = try vault()
    try v.create(pin: pin)
    let id = try importBytes(v, data).item.id
    XCTAssertNil(try v.readSearchNote(id: id))
    let note = Array("{\"text\":\"UNIQUE-RECEIPT-WORD americano\"}".utf8)
    try v.writeSearchNote(id: id, note: note)
    let file = root.appendingPathComponent("items").appendingPathComponent(id).appendingPathComponent("search")
    let sealed = try Data(contentsOf: file)
    XCTAssertNil(String(decoding: sealed, as: UTF8.self).range(of: "UNIQUE-RECEIPT"))
    v.lock()
    XCTAssertThrowsError(try v.readSearchNote(id: id))
    try v.unlock(pin: pin)
    XCTAssertEqual(try v.readSearchNote(id: id), note)
    let out = MemorySink()
    try v.read(id: id, output: out)
    XCTAssertEqual(out.bytes, data)
    var damaged = [UInt8](sealed)
    damaged[damaged.count - 1] ^= 1
    try Data(damaged).write(to: file)
    XCTAssertNil(try v.readSearchNote(id: id))
    try v.writeSearchNote(id: id, note: note)
    try v.delete(id: id)
    XCTAssertFalse(FileManager.default.fileExists(atPath: file.deletingLastPathComponent().path))
    XCTAssertThrowsError(try v.writeSearchNote(id: id, note: note))
  }

  func testDestroyAndRecreate() throws {
    let v = try vault()
    try v.create(pin: pin)
    _ = try importBytes(v, [1])
    try v.destroy()
    XCTAssertFalse(v.exists())
    try v.create(pin: Array("8025".utf8))
    XCTAssertEqual(try v.list().count, 0)
  }

  func testChangePin() throws {
    let v = try vault()
    try v.create(pin: pin)
    let r = try importBytes(v, [4, 4])
    try v.changePin(current: pin, new: Array("97531".utf8))
    v.lock()
    XCTAssertThrowsError(try v.unlock(pin: pin))
    try v.unlock(pin: Array("97531".utf8))
    XCTAssertEqual(try v.list().map(\.id), [r.item.id])
  }

  func testPendingCaptureSurvivesUntilImported() throws {
    let v = try vault()
    try v.create(pin: pin)
    let cam = root.appendingPathComponent("cam.jpg")
    try Data([7, 7, 7]).write(to: cam)
    let inbox = PendingImports(dir: root.appendingPathComponent("pending"))
    let held = try inbox.stash(cam, kind: .PHOTO)
    XCTAssertFalse(SecureFiles.exists(cam))
    v.lock()
    XCTAssertThrowsError(try inbox.importOne(vault: v, file: held, mimeType: "image/jpeg"))
    XCTAssertEqual(inbox.pending().count, 1)
    try v.unlock(pin: pin)
    XCTAssertTrue(try inbox.importOne(vault: v, file: held, mimeType: "image/jpeg").safeToDeleteOriginal)
    XCTAssertEqual(inbox.pending().count, 0)
    XCTAssertEqual(try v.list().count, 1)
  }

  func testMetaEncodingRoundTrip() throws {
    let m = ItemMeta(kind: .VIDEO, mimeType: "video/quicktime", createdAtEpochMs: 1_762_000_000_000, sizeBytes: 123)
    XCTAssertEqual(try Vault.decodeMeta(Vault.encodeMeta(m)), m)
  }
}

final class ReviewFixTests: XCTestCase {
  func testMemoryNeededFollowsStoredHeaderAndCapIs256MiB() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("vault-mem-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    let chip = FakeHardwareKey()
    let v = try Vault(root: root, hardwareKey: chip, params: try Argon2Params(memoryKiB: 64, iterations: 1, parallelism: 1))
    XCTAssertEqual(v.memoryNeededForUnlockKiB(), 64)
    try v.create(pin: Array("8024".utf8))
    // A header asking for 512 MiB is refused as invalid (not counted, nothing allocated).
    XCTAssertThrowsError(try Argon2Params(memoryKiB: 512 * 1024, iterations: 1, parallelism: 1))
    for name in ["vault.key", "vault.key.bak"] {
      let url = root.appendingPathComponent(name)
      var b = try SecureFiles.readBytes(url)
      let m = UInt32(512 * 1024)
      b[5] = UInt8(m >> 24 & 0xFF); b[6] = UInt8(m >> 16 & 0xFF); b[7] = UInt8(m >> 8 & 0xFF); b[8] = UInt8(m & 0xFF)
      try Data(b).write(to: url)
    }
    v.lock()
    XCTAssertThrowsError(try v.unlock(pin: Array("8024".utf8))) { XCTAssertEqual($0 as? VaultError, .keysUnavailable) }
    XCTAssertEqual(v.remainingAttempts(), 3)
  }

  func testLargeCaptureCopiedInPieces() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("copy-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: dir) }
    try SecureFiles.mkdirs(dir)
    let data = Primitives.randomBytes(3 * 1024 * 1024 + 17)
    try Data(data).write(to: dir.appendingPathComponent("a"))
    try SecureFiles.copySynced(from: dir.appendingPathComponent("a"), to: dir.appendingPathComponent("b"))
    XCTAssertEqual(try SecureFiles.readBytes(dir.appendingPathComponent("b")), data)
  }
}

/// Controllable clock for the wait after wrong attempts.
final class FakeClock: MonotonicClock {
  var elapsed: Int64 = 1_000_000
  var bootWall: Int64 = 1_700_000_000_000
  func elapsedMs() -> Int64 { elapsed }
  func wallMs() -> Int64 { bootWall + elapsed }
  func advance(_ ms: Int64) { elapsed += ms }
  /// Phone restarted: time since boot starts again, the wall clock keeps going.
  func reboot() {
    bootWall += elapsed + 30_000
    elapsed = 5_000
  }
}

/// A counter whose reset to 0 always fails, like a nearly full disk.
final class NoResetCounter: AttemptCounter {
  private let inner: FileAttemptCounter
  init(_ inner: FileAttemptCounter) { self.inner = inner }
  func read() -> Int { inner.read() }
  func write(_ value: Int) throws {
    if value == 0 { throw VaultError.io("disk full") }
    try inner.write(value)
  }
}
