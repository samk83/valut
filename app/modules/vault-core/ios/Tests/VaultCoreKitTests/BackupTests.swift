import Foundation
import XCTest

@testable import VaultCoreKit

/// Encrypted backup + recovery key (mirrors core BackupTest.kt).
final class BackupTests: XCTestCase {
  private var tmp: URL!
  private let small = try! Argon2Params(memoryKiB: 64, iterations: 1, parallelism: 1)
  private let pin = Array("482915".utf8)

  override func setUpWithError() throws {
    tmp = FileManager.default.temporaryDirectory.appendingPathComponent("backup-test-\(UUID().uuidString)")
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: tmp)
  }

  private func phone(_ name: String) throws -> Vault {
    try Vault(root: tmp.appendingPathComponent(name), hardwareKey: FakeHardwareKey(), params: small, chunkSize: 4096, clock: FakeClock())
  }

  private func folder() -> LocalBackupFolder { LocalBackupFolder(dir: tmp.appendingPathComponent("icloud/Private Vision Vault Backup")) }

  private func importBytes(_ v: Vault, _ data: [UInt8], kind: ItemKind = .PHOTO, thumb: [UInt8]? = [9, 9]) throws -> String {
    try v.importItem(content: MemorySource(data), meta: ItemMeta(kind: kind, mimeType: kind == .PHOTO ? "image/jpeg" : "video/mp4", createdAtEpochMs: 1),
                     thumbnail: thumb).item.id
  }

  private func read(_ v: Vault, _ id: String) throws -> [UInt8] {
    let out = MemorySink()
    try v.read(id: id, output: out)
    return out.bytes
  }

  func testRecoveryKeyTextRoundTrips() {
    for _ in 0..<50 {
      let key = RecoveryKey.generate()
      let text = RecoveryKey.format(key)
      XCTAssertEqual(text.count, 64)
      XCTAssertEqual(RecoveryKey.parse(text), key)
      XCTAssertEqual(RecoveryKey.parse(text.lowercased().replacingOccurrences(of: "-", with: " ")), key)
      XCTAssertEqual(RecoveryKey.parse(text.replacingOccurrences(of: "0", with: "O").replacingOccurrences(of: "1", with: "l")), key)
    }
    XCTAssertNil(RecoveryKey.parse("ABCD-EFGH"))
    XCTAssertNil(RecoveryKey.parse(String(repeating: "U", count: 52)))
  }

  func testAppDeletedNewInstallRestoresEverything() throws {
    let old = try phone("old")
    try old.create(pin: pin)
    let a = Primitives.randomBytes(30_000), b = Primitives.randomBytes(10_000)
    let idA = try importBytes(old, a)
    let idB = try importBytes(old, b, kind: .VIDEO, thumb: nil)
    let idC = try importBytes(old, [])
    let keyText = RecoveryKey.format(try old.createRecoveryKey())
    XCTAssertEqual(try old.backup(to: folder()), BackupReport(written: 3, removed: 0, total: 3))

    try FileManager.default.removeItem(at: tmp.appendingPathComponent("old"))
    let fresh = try phone("new")
    try Vault.checkBackup(folder(), recoveryKey: RecoveryKey.parse(keyText)!)
    try fresh.create(pin: Array("739201".utf8))
    var last = (0, 0)
    let report = try fresh.restore(from: folder(), recoveryKey: RecoveryKey.parse(keyText)!) { last = ($0, $1) }
    XCTAssertEqual(report, RestoreReport(restored: 3, alreadyHere: 0, damaged: 0))
    XCTAssertEqual(last.0, 3)
    XCTAssertEqual(try read(fresh, idA), a)
    XCTAssertEqual(try read(fresh, idB), b)
    XCTAssertEqual(try read(fresh, idC), [])
    XCTAssertEqual(try fresh.list().first { $0.id == idB }?.meta.kind, .VIDEO)
    XCTAssertNil(try fresh.thumbnail(id: idB))
    XCTAssertEqual(try fresh.thumbnail(id: idA), [9, 9])
    XCTAssertEqual(RecoveryKey.format(try fresh.recoveryKey()!), keyText)
    XCTAssertEqual(try fresh.backup(to: folder()), BackupReport(written: 0, removed: 0, total: 3))
    XCTAssertEqual(try fresh.restore(from: folder(), recoveryKey: RecoveryKey.parse(keyText)!), RestoreReport(restored: 0, alreadyHere: 3, damaged: 0))
  }

  func testWrongKeyAndForeignFolderAreRefused() throws {
    let old = try phone("old")
    try old.create(pin: pin)
    _ = try importBytes(old, [1, 2, 3])
    _ = try old.createRecoveryKey()
    _ = try old.backup(to: folder())
    let fresh = try phone("new")
    try fresh.create(pin: Array("739201".utf8))
    XCTAssertThrowsError(try fresh.restore(from: folder(), recoveryKey: RecoveryKey.generate())) { XCTAssertEqual($0 as? VaultError, .backupKeyMismatch) }
    XCTAssertTrue(try fresh.list().isEmpty)
    XCTAssertFalse(fresh.hasRecoveryKey())
    XCTAssertThrowsError(try Vault.checkBackup(LocalBackupFolder(dir: tmp.appendingPathComponent("empty")), recoveryKey: RecoveryKey.generate())) {
      XCTAssertEqual($0 as? VaultError, .notABackup)
    }
    _ = try importBytes(fresh, [4])
    _ = try fresh.createRecoveryKey()
    XCTAssertThrowsError(try fresh.backup(to: folder())) { XCTAssertEqual($0 as? VaultError, .backupKeyMismatch) }
  }

  func testOnlyUserDeletesLeaveTheBackupAndDamageIsSkipped() throws {
    let v = try phone("old")
    try v.create(pin: pin)
    let ids = try (0..<3).map { _ in try importBytes(v, Primitives.randomBytes(20_000)) }
    let rk = try v.createRecoveryKey()
    _ = try v.backup(to: folder())
    try v.delete(id: ids[0])
    try FileManager.default.removeItem(at: tmp.appendingPathComponent("old/items/\(ids[1])/key"))
    try FileManager.default.removeItem(at: tmp.appendingPathComponent("old/items/\(ids[1])/key.bak"))
    XCTAssertEqual(try v.backup(to: folder()), BackupReport(written: 0, removed: 1, total: 1))
    let names = try folder().list()
    XCTAssertFalse(names.contains("\(ids[0]).pvb"))
    XCTAssertTrue(names.contains("\(ids[1]).pvb"))

    // Cut one file short; the other two restore.
    let cut = folder().dir.appendingPathComponent("\(ids[1]).pvb")
    let bytes = try SecureFiles.readBytes(cut)
    try SecureFiles.writeAtomic(cut, Array(bytes[0..<(bytes.count - 100)]))
    let fresh = try phone("new")
    try fresh.create(pin: Array("739201".utf8))
    XCTAssertEqual(try fresh.restore(from: folder(), recoveryKey: rk), RestoreReport(restored: 1, alreadyHere: 0, damaged: 1))
    XCTAssertEqual(try fresh.list().map(\.id), [ids[2]])
  }

  func testCopyCutShortIsWrittenAgainAndBadThumbnailIsDropped() throws {
    let v = try phone("old")
    try v.create(pin: pin)
    let a = Primitives.randomBytes(20_000), b = Primitives.randomBytes(20_000)
    let idA = try importBytes(v, a)
    let idB = try importBytes(v, b)
    let rk = try v.createRecoveryKey()
    XCTAssertEqual(try v.backup(to: folder()), BackupReport(written: 2, removed: 0, total: 2))
    let dir = tmp.appendingPathComponent("icloud/Private Vision Vault Backup")
    try Data().write(to: dir.appendingPathComponent(idA + ".pvb"))
    let fileB = dir.appendingPathComponent(idB + ".pvb")
    let bytesB = try Data(contentsOf: fileB)
    try bytesB.prefix(bytesB.count - 1).write(to: fileB)
    // B's thumbnail gets damaged on the phone: the photo is still backed up, without it.
    try Data(count: 40).write(to: tmp.appendingPathComponent("old/items/\(idB)/thumb"))
    XCTAssertEqual(try v.backup(to: folder()), BackupReport(written: 2, removed: 0, total: 2))
    XCTAssertEqual(try v.backup(to: folder()), BackupReport(written: 0, removed: 0, total: 2))
    let fresh = try phone("new")
    try fresh.create(pin: Array("739201".utf8))
    XCTAssertEqual(try fresh.restore(from: folder(), recoveryKey: rk), RestoreReport(restored: 2, alreadyHere: 0, damaged: 0))
    XCTAssertEqual(try read(fresh, idA), a)
    XCTAssertEqual(try read(fresh, idB), b)
    XCTAssertNil(try fresh.thumbnail(id: idB))
  }

  func testDeleteOfICloudPlaceholderRemovesIt() throws {
    let dir = tmp.appendingPathComponent("icloud/Private Vision Vault Backup")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    try Data([1]).write(to: dir.appendingPathComponent(".abc.pvb.icloud"))
    XCTAssertEqual(try folder().list(), ["abc.pvb"])
    XCTAssertEqual(folder().size("abc.pvb"), -1)
    try folder().delete("abc.pvb")
    XCTAssertEqual(try folder().list(), [])
  }

  func testResetClearsRecoveryKeyButKeepsBackup() throws {
    let v = try phone("old")
    try v.create(pin: pin)
    _ = try importBytes(v, [1])
    XCTAssertThrowsError(try v.backup(to: folder())) { XCTAssertEqual($0 as? VaultError, .noRecoveryKey) }
    let rk = try v.createRecoveryKey()
    XCTAssertEqual(try v.createRecoveryKey(), rk)
    XCTAssertFalse(v.isRecoveryKeyConfirmed())
    try v.confirmRecoveryKey()
    XCTAssertTrue(v.isRecoveryKeyConfirmed())
    v.lock()
    XCTAssertTrue(v.hasRecoveryKey())
    try v.unlock(pin: pin)
    try SecureFiles.writeAtomic(tmp.appendingPathComponent("old/recovery.key"), [UInt8](repeating: 0, count: 40))
    XCTAssertEqual(try v.recoveryKey(), rk)
    _ = try v.backup(to: folder())
    try v.destroy()
    XCTAssertFalse(v.hasRecoveryKey())
    XCTAssertFalse(v.isRecoveryKeyConfirmed())
    XCTAssertEqual(try Vault.backupItemCount(folder()), 1)
  }

  func testBridgeBacksUpIntoPickedFolderAndRestores() throws {
    let v = try phone("old")
    try v.create(pin: pin)
    let content = Primitives.randomBytes(9000)
    let id = try importBytes(v, content)
    let keyText = RecoveryKey.format(try v.createRecoveryKey())
    let picked = tmp.appendingPathComponent("iCloud Drive", isDirectory: true)
    try FileManager.default.createDirectory(at: picked, withIntermediateDirectories: true)
    var events: [[String: Any]] = []
    let done = DispatchSemaphore(value: 0)
    let bridge = BackupBridge(vault: { v }, stateDir: tmp.appendingPathComponent("state")) { e in
      events.append(e)
      if let phase = e["phase"] as? String, phase.hasSuffix("-done") || phase.hasSuffix("-error") { done.signal() }
    }
    XCTAssertFalse(bridge.backupNow()) // no folder yet
    XCTAssertEqual(bridge.setFolder(picked.absoluteString)["ok"] as? Bool, true)
    XCTAssertTrue(bridge.backupNow())
    XCTAssertEqual(done.wait(timeout: .now() + 30), .success)
    XCTAssertEqual(events.last?["phase"] as? String, "backup-done")
    XCTAssertTrue(SecureFiles.exists(picked.appendingPathComponent("\(BackupBridge.subfolder)/\(id).pvb")))
    XCTAssertGreaterThan(try bridge.status()["lastBackupAt"] as? Double ?? 0, 0)

    // New install: check the key, then restore through the bridge.
    let fresh = try phone("new")
    try fresh.create(pin: Array("739201".utf8))
    let bridge2 = BackupBridge(vault: { fresh }, stateDir: tmp.appendingPathComponent("state2")) { e in
      events.append(e)
      if let phase = e["phase"] as? String, phase.hasSuffix("-done") || phase.hasSuffix("-error") { done.signal() }
    }
    XCTAssertEqual(bridge2.check(picked.absoluteString, "AAAA")["error"] as? String, "BAD_KEY")
    XCTAssertEqual(bridge2.check(picked.absoluteString, RecoveryKey.format(RecoveryKey.generate()))["error"] as? String, "WRONG_KEY")
    XCTAssertEqual(bridge2.check(tmp.absoluteString, keyText)["error"] as? String, "NOT_A_BACKUP")
    XCTAssertEqual(bridge2.check(picked.absoluteString, keyText)["count"] as? Int, 1)
    XCTAssertTrue(bridge2.restore(picked.absoluteString, keyText))
    XCTAssertEqual(done.wait(timeout: .now() + 30), .success)
    XCTAssertEqual(events.last?["phase"] as? String, "restore-done")
    XCTAssertEqual(events.last?["restored"] as? Int, 1)
    XCTAssertEqual(try read(fresh, id), content)
    // The restored vault keeps backing up into the same folder.
    XCTAssertEqual(try bridge2.status()["folderName"] as? String, BackupBridge.subfolder)
  }

  // MARK: - Android <-> iPhone: the same backup format on both (fixtures made by each side)

  private static let fixtures = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent()
    .appendingPathComponent("core/src/test/resources/backup-fixtures")

  static func fixtureContent(_ index: Int) -> [UInt8] {
    index == 0 ? (0..<5000).map { UInt8($0 * 7 % 256) } : (0..<70_000).map { UInt8($0 * 13 % 251) }
  }

  /// Run with PV_WRITE_FIXTURE=1 to (re)create the Swift-made fixture.
  func testWriteSwiftFixture() throws {
    guard ProcessInfo.processInfo.environment["PV_WRITE_FIXTURE"] == "1" else { return }
    let v = try phone("fixture")
    try v.create(pin: pin)
    _ = try importBytes(v, BackupTests.fixtureContent(0), thumb: [1, 2, 3])
    _ = try importBytes(v, BackupTests.fixtureContent(1), kind: .VIDEO, thumb: nil)
    let rk = try v.createRecoveryKey()
    let out = BackupTests.fixtures.appendingPathComponent("swift")
    try? FileManager.default.removeItem(at: out)
    _ = try v.backup(to: LocalBackupFolder(dir: out))
    try SecureFiles.writeAtomic(out.appendingPathComponent("key.txt"), Array(RecoveryKey.format(rk).utf8))
  }

  func testRestoresBackupMadeOnAndroid() throws {
    let dir = BackupTests.fixtures.appendingPathComponent("kotlin")
    let keyText = try String(contentsOf: dir.appendingPathComponent("key.txt"), encoding: .utf8)
    let v = try phone("fromAndroid")
    try v.create(pin: pin)
    XCTAssertEqual(try v.restore(from: LocalBackupFolder(dir: dir), recoveryKey: RecoveryKey.parse(keyText)!),
                   RestoreReport(restored: 2, alreadyHere: 0, damaged: 0))
    let items = try v.list()
    let photo = try XCTUnwrap(items.first { $0.meta.kind == .PHOTO })
    let video = try XCTUnwrap(items.first { $0.meta.kind == .VIDEO })
    XCTAssertEqual(try read(v, photo.id), BackupTests.fixtureContent(0))
    XCTAssertEqual(try read(v, video.id), BackupTests.fixtureContent(1))
    XCTAssertEqual(try v.thumbnail(id: photo.id), [1, 2, 3])
  }
}
