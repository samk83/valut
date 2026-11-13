import Foundation

enum ItemKind: String { case PHOTO, VIDEO }

/// Item details. Stored only in encrypted form (SPEC AC-11).
struct ItemMeta: Equatable {
  var kind: ItemKind
  var mimeType: String
  var createdAtEpochMs: Int64
  var sizeBytes: Int64 = 0
}

struct VaultItem: Equatable {
  let id: String
  let meta: ItemMeta
}

/// [safeToDeleteOriginal] is true only when the encrypted copy was re-read, decrypted and
/// matched the SHA-256 the caller computed from the original itself (SPEC AC-30).
struct ImportResult {
  let item: VaultItem
  let safeToDeleteOriginal: Bool
}

/// The vault on disk. Port of core/Vault.kt, same layout under [root]:
///   vault.key, attempts, items/<id>/{key,key.bak,meta,meta.bak,data,thumb}, staging/<id>/
final class Vault {
  private let root: URL
  private let items: URL
  private let staging: URL
  private let keys: VaultKeyManager
  private let chunkSize: Int
  private let state = NSRecursiveLock()
  private var masterKey: [UInt8]?
  // Bumped by every lock(); an unlock that finishes after a lock() is discarded.
  private var lockGeneration: UInt64 = 0

  private static let deletedMarker = "deleted"
  private static let sourceFile = "source"

  init(root: URL, hardwareKey: HardwareKey, params: Argon2Params = .phone, chunkSize: Int = ChunkedCipher.defaultChunkSize,
       clock: MonotonicClock = SystemMonotonicClock()) throws {
    self.root = root
    items = root.appendingPathComponent("items")
    staging = root.appendingPathComponent("staging")
    self.chunkSize = chunkSize
    keys = VaultKeyManager(envelopeFile: root.appendingPathComponent("vault.key"),
                           counter: FileAttemptCounter(file: root.appendingPathComponent("attempts")),
                           hardwareKey: hardwareKey, params: params, clock: clock)
    try SecureFiles.mkdirs(root)
    // An interrupted import leaves only ciphertext in staging; discard it (PRD 14).
    SecureFiles.deleteTree(staging)
    try keys.sweepTempFiles()
    // Finish only deletes the user started (tombstone). Never remove anything else here.
    for dir in SecureFiles.list(items)
    where SecureFiles.isDirectory(dir) && Vault.isValidId(dir.lastPathComponent) && SecureFiles.exists(dir.appendingPathComponent(Vault.deletedMarker)) {
      SecureFiles.deleteTree(dir)
    }
  }

  var isUnlocked: Bool {
    state.lock()
    defer { state.unlock() }
    return masterKey != nil
  }

  func exists() -> Bool { keys.exists() }

  func remainingAttempts() -> Int { keys.remainingAttempts() }

  func memoryNeededForUnlockKiB() -> Int { keys.memoryNeededKiB() }

  /// How long until the next PIN attempt is allowed (0 = now).
  func lockedForMs() -> Int64 { keys.lockedForMs() }

  /// Removes Keychain / Secure Enclave keys left by an earlier install. Uninstalling deletes
  /// this folder, so if vault files are still here it is NOT a fresh install (only the marker
  /// went missing): nothing is touched and false is returned. A vault is never wiped on a guess.
  @discardableResult
  func wipeLeftoversForFreshInstall() throws -> Bool {
    if keys.hasKeyFiles() || !SecureFiles.list(items).isEmpty { return false }
    lock()
    try keys.wipeLeftoversForFreshInstall()
    SecureFiles.deleteTree(items)
    return true
  }

  func create(pin: [UInt8]) throws {
    try SecureFiles.mkdirs(root)
    let generation = currentGeneration()
    let mk = try keys.create(pin: pin)
    // Only now is it safe to clear leftover ciphertext of a destroyed vault.
    SecureFiles.deleteTree(items)
    // A recovery key left by a destroyed vault was sealed with its old master key.
    clearBackupState()
    try setMasterKey(mk, generation)
  }

  /// Unlocks the vault. If [lock] is called meanwhile, the result is thrown away.
  func unlock(pin: [UInt8]) throws {
    lock()
    let generation = currentGeneration()
    let mk = try keys.unlock(pin: pin)
    try setMasterKey(mk, generation)
  }

  func changePin(current: [UInt8], new newPin: [UInt8]) throws {
    try keys.changePin(current: current, new: newPin)
  }

  /// Drops the master key from memory. Call when the app leaves the screen (SPEC AC-07).
  func lock() {
    state.lock()
    defer { state.unlock() }
    lockGeneration &+= 1
    masterKey?.wipe()
    masterKey = nil
  }

  /// Imports one photo or video. [expectedSha256] must come from a separate read of the original.
  /// [receivedFrom] is the item's id on the phone it came from (see TransferReceiver).
  func importItem(content: ByteSource, meta: ItemMeta, thumbnail: [UInt8]? = nil, expectedSha256: [UInt8]? = nil,
                  receivedFrom: String? = nil) throws -> ImportResult {
    let sourceBytes = try receivedFrom.map { try Vault.parseId($0) }
    var mk = try requireUnlocked()
    let idBytes = Primitives.randomBytes(16)
    let id = idBytes.map { String(format: "%02x", $0) }.joined()
    let stage = staging.appendingPathComponent(id)
    var fileKey = Primitives.randomBytes(32)
    defer {
      fileKey.wipe()
      mk.wipe()
    }
    do {
      try SecureFiles.mkdirs(stage)
      let dataFile = stage.appendingPathComponent("data")
      let written: ChunkedCipher.EncryptResult
      do {
        let sink = try FileSink(dataFile)
        written = try ChunkedCipher.encrypt(input: content, output: sink, fileKey: fileKey, fileId: idBytes, chunkSize: chunkSize)
        try sink.sync()
      }
      // Verify by decrypting what is actually on disk.
      let check = try ChunkedCipher.decrypt(input: FileSource(dataFile), output: NullSink(), fileKey: fileKey, fileId: idBytes)
      if !Primitives.equal(check, written.sha256) || (expectedSha256.map { !Primitives.equal($0, written.sha256) } ?? false) {
        throw VaultError.importVerification("Encrypted copy does not match the original")
      }
      var finalMeta = meta
      finalMeta.sizeBytes = written.plaintextBytes
      let sealedMeta = try seal(fileKey, Vault.encodeMeta(finalMeta), aad("meta", idBytes))
      let sealedKey = try seal(mk, fileKey, aad("key", idBytes))
      try SecureFiles.writeAtomic(stage.appendingPathComponent("meta"), sealedMeta)
      try SecureFiles.writeAtomic(stage.appendingPathComponent("meta.bak"), sealedMeta)
      if let thumb = thumbnail {
        try SecureFiles.writeAtomic(stage.appendingPathComponent("thumb"), try seal(fileKey, thumb, aad("thumb", idBytes)))
      }
      // Where a transferred item came from, published together with the item itself.
      if let source = sourceBytes {
        try SecureFiles.writeAtomic(stage.appendingPathComponent(Vault.sourceFile), try seal(fileKey, source, aad(Vault.sourceFile, idBytes)))
      }
      try SecureFiles.writeAtomic(stage.appendingPathComponent("key.bak"), sealedKey)
      // The wrapped key is written last: an item without it can never be opened.
      try SecureFiles.writeAtomic(stage.appendingPathComponent("key"), sealedKey)
      try SecureFiles.syncDir(stage)
      // Publish only if this master key is still the vault's key.
      try keys.whileKeyIsLive(mk) {
        try SecureFiles.mkdirs(items)
        try SecureFiles.moveAtomic(stage, items.appendingPathComponent(id))
      }
      return ImportResult(item: VaultItem(id: id, meta: finalMeta), safeToDeleteOriginal: expectedSha256 != nil)
    } catch VaultError.integrity(let message) {
      SecureFiles.deleteTree(stage)
      throw VaultError.importVerification("Verification failed: \(message)")
    } catch {
      SecureFiles.deleteTree(stage)
      throw error
    }
  }

  func list() throws -> [VaultItem] {
    var mk = try requireUnlocked()
    mk.wipe()
    let out: [VaultItem] = SecureFiles.list(items).compactMap { dir in
      guard isLiveItem(dir) else { return nil }
      // Damaged items are hidden and blocked, never shown half-decrypted (PRD 10.2).
      return try? withFileKey(dir.lastPathComponent) { fk, idBytes in
        let meta = try Vault.decodeMeta(try openEither(dir, "meta") { try open(fk, $0, aad("meta", idBytes)) })
        return VaultItem(id: dir.lastPathComponent, meta: meta)
      }
    }
    return out.sorted { $0.meta.createdAtEpochMs > $1.meta.createdAtEpochMs }
  }

  /// Streams the decrypted content into [output] (memory or a digest, or the player's file).
  func read(id: String, output: ByteSink) throws {
    try withFileKey(id) { fk, idBytes in
      _ = try ChunkedCipher.decrypt(input: FileSource(try itemDir(id).appendingPathComponent("data")), output: output, fileKey: fk, fileId: idBytes)
    }
  }

  func thumbnail(id: String) throws -> [UInt8]? {
    try withFileKey(id) { fk, idBytes in
      let file = try itemDir(id).appendingPathComponent("thumb")
      guard SecureFiles.exists(file) else { return nil }
      return try open(fk, try SecureFiles.readBytes(file), aad("thumb", idBytes))
    }
  }

  /// Decrypts a single chunk, for seeking in videos.
  func readChunk(id: String, index: Int) throws -> [UInt8] {
    try withFileKey(id) { fk, idBytes in
      try ChunkedCipher.Reader(url: try itemDir(id).appendingPathComponent("data"), fileKey: fk, fileId: idBytes).readChunk(index)
    }
  }

  /// Ids (on the old phone) of items received by transfer, so an interrupted transfer can run
  /// again without duplicates. Same as core/Vault.kt: each item's sealed "source" file.
  func receivedSources() throws -> Set<String> {
    var mk = try requireUnlocked()
    mk.wipe()
    var out = Set<String>()
    for dir in SecureFiles.list(items) where isLiveItem(dir) && SecureFiles.exists(dir.appendingPathComponent(Vault.sourceFile)) {
      if let id = try? withFileKey(dir.lastPathComponent, { fk, idBytes in
        try open(fk, try SecureFiles.readBytes(dir.appendingPathComponent(Vault.sourceFile)), aad(Vault.sourceFile, idBytes))
      }) {
        out.insert(id.map { String(format: "%02x", $0) }.joined())
      }
    }
    return out
  }

  /// Permanent deletion: the wrapped file key goes first, then the ciphertext (PRD 9.2).
  func delete(id: String) throws {
    var mk = try requireUnlocked()
    mk.wipe()
    let dir = try itemDir(id)
    guard SecureFiles.exists(dir) else { return }
    try SecureFiles.writeAtomic(dir.appendingPathComponent(Vault.deletedMarker), [])
    for name in ["key", "key.bak", "meta", "meta.bak", "thumb", Vault.sourceFile] { SecureFiles.shred(dir.appendingPathComponent(name)) }
    SecureFiles.deleteTree(dir)
    // The user deleted it, so the next backup removes its copy too. Only ids listed here are
    // ever removed from a backup: an item hidden by damage keeps its backup copy.
    deletesLock.lock()
    defer { deletesLock.unlock() }
    if let handle = FileHandle(forWritingAtPath: deletesFile.path) ?? createDeletesFile() {
      handle.seekToEndOfFile()
      handle.write(Data((id + "\n").utf8))
      handle.closeFile()
    }
  }

  private func createDeletesFile() -> FileHandle? {
    FileManager.default.createFile(atPath: deletesFile.path, contents: nil)
    return FileHandle(forWritingAtPath: deletesFile.path)
  }

  /// Destroys the whole vault: master key first, then every file (PRD 9.3).
  func destroy() throws {
    lock()
    try keys.destroy()
    SecureFiles.deleteTree(items)
    SecureFiles.deleteTree(staging)
    // Backup files in the user's folder are left alone: they are the user's copy.
    clearBackupState()
  }

  // MARK: - Backup (owner decision 2026-11-12: photos must survive deleting the app)

  private var recoveryFile: URL { root.appendingPathComponent("recovery.key") }
  private var deletesFile: URL { root.appendingPathComponent("backup.deletes") }
  private let backupLock = NSRecursiveLock()
  // Separate from backupLock so deleting a photo or making the key never waits for a long backup.
  private let deletesLock = NSLock()
  private let recoveryLock = NSLock()
  private static let recoveryAad = Array("PrivateVault recovery key v1".utf8)

  /// True when a recovery key is set up. Works while locked.
  func hasRecoveryKey() -> Bool {
    SecureFiles.exists(recoveryFile) || SecureFiles.exists(root.appendingPathComponent("recovery.key.bak"))
  }

  /// The recovery key, for showing it again. Needs the vault unlocked.
  func recoveryKey() throws -> [UInt8]? {
    var mk = try requireUnlocked()
    defer { mk.wipe() }
    guard hasRecoveryKey() else { return nil }
    return try openEither(root, "recovery.key") { try open(mk, $0, Vault.recoveryAad) }
  }

  private var confirmedFile: URL { root.appendingPathComponent("recovery.confirmed") }

  /// True once the user proved they saved the recovery key (or restored with it).
  func isRecoveryKeyConfirmed() -> Bool { hasRecoveryKey() && SecureFiles.exists(confirmedFile) }

  /// Records that the user saved the recovery key. Until then the app keeps asking.
  func confirmRecoveryKey() throws {
    guard hasRecoveryKey() else { throw VaultError.noRecoveryKey }
    try SecureFiles.writeAtomic(confirmedFile, [])
  }

  /// Returns the recovery key, creating it the first time. Needs the vault unlocked.
  func createRecoveryKey() throws -> [UInt8] {
    recoveryLock.lock()
    defer { recoveryLock.unlock() }
    if let rk = try recoveryKey() { return rk }
    let rk = RecoveryKey.generate()
    try storeRecoveryKey(rk)
    return rk
  }

  private func storeRecoveryKey(_ rk: [UInt8]) throws {
    var mk = try requireUnlocked()
    defer { mk.wipe() }
    let sealed = try seal(mk, rk, Vault.recoveryAad)
    try SecureFiles.writeAtomic(root.appendingPathComponent("recovery.key.bak"), sealed)
    try SecureFiles.writeAtomic(recoveryFile, sealed)
  }

  /// Copies every item not yet in [folder] there and removes copies of items the user
  /// deleted. Items already there are skipped, so it is safe to run often.
  func backup(to folder: BackupFolder) throws -> BackupReport {
    backupLock.lock()
    defer { backupLock.unlock() }
    guard var rk = try recoveryKey() else { throw VaultError.noRecoveryKey }
    var bk = BackupFormat.backupKey(rk)
    rk.wipe()
    defer { bk.wipe() }
    let names = try folder.list()
    if names.contains(BackupFormat.info) {
      let info = try BackupFormat.readAll(folder.openRead(BackupFormat.info))
      // Another vault's backup: never mix two vaults in one folder.
      guard BackupFormat.opensInfo(info, bk) else { throw VaultError.backupKeyMismatch }
    } else {
      let info = try BackupFormat.infoFile(bk)
      try folder.write(BackupFormat.info) { try $0.write(info) }
    }
    for name in names where name.hasSuffix(BackupFormat.part) { try? folder.delete(name) }
    let present = Set(names.filter { $0.hasSuffix(BackupFormat.ext) }.map { String($0.dropLast(BackupFormat.ext.count)) })
    let deleted = readDeletes()
    var handled: Set<String> = []
    var removed = 0
    let live = SecureFiles.list(items).filter(isLiveItem).map { $0.lastPathComponent }
    let liveSet = Set(live)
    for id in deleted {
      // Gone from the folder already, or back in the vault (restored): nothing to remove.
      guard present.contains(id), !liveSet.contains(id) else {
        handled.insert(id)
        continue
      }
      // A delete that fails stays in the log and is tried again next time.
      if (try? folder.delete(id + BackupFormat.ext)) != nil {
        removed += 1
        handled.insert(id)
      }
    }
    if !handled.isEmpty { forgetDeletes(handled) }
    var written = 0
    for id in live {
      // A copy with the wrong size (cut short by a provider) is written again.
      let replacing = present.contains(id)
      if replacing, backupCopyLooksComplete(id, folder.size(id + BackupFormat.ext)) { continue }
      if try writeBackupItem(id, bk, folder, replacing: replacing) { written += 1 }
    }
    return BackupReport(written: written, removed: removed, total: live.count)
  }

  private func readDeletes() -> Set<String> {
    deletesLock.lock()
    defer { deletesLock.unlock() }
    guard let text = try? String(contentsOf: deletesFile, encoding: .utf8) else { return [] }
    return Set(text.split(separator: "\n").map(String.init).filter(Vault.isValidId))
  }

  /// Removes [ids] from the delete log, keeping any added meanwhile.
  private func forgetDeletes(_ ids: Set<String>) {
    deletesLock.lock()
    defer { deletesLock.unlock() }
    let text = (try? String(contentsOf: deletesFile, encoding: .utf8)) ?? ""
    let left = text.split(separator: "\n").map(String.init).filter { Vault.isValidId($0) && !ids.contains($0) }
    if left.isEmpty {
      unlink(deletesFile.path)
    } else {
      try? SecureFiles.writeAtomic(deletesFile, Array(left.map { $0 + "\n" }.joined().utf8))
    }
  }

  /// False if [size] (-1 = unknown) can't be a complete copy of item [id].
  private func backupCopyLooksComplete(_ id: String, _ size: Int64) -> Bool {
    guard size >= 0, let dir = try? itemDir(id) else { return true }
    func length(_ name: String) -> Int64? {
      guard let attrs = try? FileManager.default.attributesOfItem(atPath: dir.appendingPathComponent(name).path),
            let n = attrs[.size] as? NSNumber else { return nil }
      return n.int64Value
    }
    guard let data = length("data") else { return true }
    let metas = ["meta", "meta.bak"].compactMap(length)
    let thumbs = [Int64(0)] + [length("thumb")].compactMap { $0 }
    return metas.contains { m in thumbs.contains { t in size == BackupFormat.headerSize(metaLen: m, thumbLen: t) + data } }
  }

  private func writeBackupItem(_ id: String, _ bk: [UInt8], _ folder: BackupFolder, replacing: Bool = false) throws -> Bool {
    let dir = try itemDir(id)
    let header: [UInt8]
    do {
      header = try withFileKey(id) { fk, idBytes in
        let meta = try openEither(dir, "meta") { sealed -> [UInt8] in
          _ = try open(fk, sealed, aad("meta", idBytes))
          return sealed
        }
        let thumbFile = dir.appendingPathComponent("thumb")
        // A damaged thumbnail is left out rather than making the photo unrestorable.
        var thumb: [UInt8]? = nil
        if SecureFiles.exists(thumbFile), let bytes = try? SecureFiles.readBytes(thumbFile),
           (try? open(fk, bytes, aad("thumb", idBytes))) != nil {
          thumb = bytes
        }
        // Replacing a copy: the phone's own file may be the damaged one, so it must decrypt
        // completely before it may overwrite what may be the last good copy.
        if replacing {
          _ = try ChunkedCipher.decrypt(input: FileSource(dir.appendingPathComponent("data")), output: NullSink(), fileKey: fk, fileId: idBytes)
        }
        return BackupFormat.itemHeader(id: idBytes, wrappedKey: try BackupFormat.wrapKey(bk, fk, idBytes), sealedMeta: meta, sealedThumb: thumb)
      }
    } catch let e as VaultError {
      switch e {
      case .integrity, .io: return false // A damaged item can't be backed up; it is never deleted either.
      default: throw e
      }
    }
    let data = try FileSource(dir.appendingPathComponent("data"))
    try folder.write(id + BackupFormat.ext) { sink in
      try sink.write(header)
      try BackupFormat.copy(data, sink)
    }
    return true
  }

  /// Throws unless [folder] holds a backup that [recoveryKey] opens. Needs no vault.
  static func checkBackup(_ folder: BackupFolder, recoveryKey: [UInt8]) throws {
    var bk = BackupFormat.backupKey(recoveryKey)
    defer { bk.wipe() }
    try checkBackupKey(folder, bk)
  }

  /// Number of items in the backup in [folder] (no key needed).
  static func backupItemCount(_ folder: BackupFolder) throws -> Int {
    try folder.list().filter { $0.hasSuffix(BackupFormat.ext) }.count
  }

  private static func checkBackupKey(_ folder: BackupFolder, _ bk: [UInt8]) throws {
    guard try folder.list().contains(BackupFormat.info) else { throw VaultError.notABackup }
    let info = try BackupFormat.readAll(folder.openRead(BackupFormat.info))
    guard BackupFormat.opensInfo(info, bk) else { throw VaultError.backupKeyMismatch }
  }

  /// Restores every item of the backup in [folder] that is not already here, keeping its id,
  /// and checks each one completely before it appears. Damaged files are skipped and counted.
  /// A vault without a recovery key adopts [recoveryKey], so backups continue in that folder.
  func restore(from folder: BackupFolder, recoveryKey: [UInt8], progress: (Int, Int) -> Void = { _, _ in }) throws -> RestoreReport {
    var mk = try requireUnlocked()
    mk.wipe()
    var bk = BackupFormat.backupKey(recoveryKey)
    defer { bk.wipe() }
    try Vault.checkBackupKey(folder, bk)
    if !hasRecoveryKey() {
      try storeRecoveryKey(recoveryKey)
      // The user just typed it from their copy, so it is saved somewhere.
      try SecureFiles.writeAtomic(confirmedFile, [])
    }
    let names = try folder.list()
      .filter { $0.hasSuffix(BackupFormat.ext) && Vault.isValidId(String($0.dropLast(BackupFormat.ext.count))) }
      .sorted()
    var restored = 0, already = 0, damaged = 0
    for (index, name) in names.enumerated() {
      let id = String(name.dropLast(BackupFormat.ext.count))
      let existing = items.appendingPathComponent(id)
      if isLiveItem(existing) {
        already += 1
      } else if SecureFiles.exists(existing) {
        // Being deleted by the user (tombstone): leave it to finish, don't count it.
      } else {
        do {
          try restoreItem(id, try folder.openRead(name), bk)
          restored += 1
        } catch let e as VaultError {
          switch e {
          case .integrity, .io: damaged += 1
          default: throw e
          }
        }
      }
      progress(index + 1, names.count)
    }
    return RestoreReport(restored: restored, alreadyHere: already, damaged: damaged)
  }

  private func restoreItem(_ id: String, _ input: ByteSource, _ bk: [UInt8]) throws {
    let idBytes = try Vault.parseId(id)
    var header = try BackupFormat.readItemHeader(input, bk)
    var mk = try requireUnlocked()
    let stage = staging.appendingPathComponent(id)
    defer {
      header.fileKey.wipe()
      mk.wipe()
    }
    do {
      let fk = header.fileKey
      guard header.id == idBytes else { throw VaultError.integrity("Backup item name does not match its content") }
      _ = try Vault.decodeMeta(try open(fk, header.sealedMeta, aad("meta", idBytes)))
      // A thumbnail that does not open is dropped: the photo itself still restores.
      let thumb = header.sealedThumb.flatMap { t in (try? open(fk, t, aad("thumb", idBytes))) != nil ? t : nil }
      SecureFiles.deleteTree(stage)
      try SecureFiles.mkdirs(stage)
      let dataFile = stage.appendingPathComponent("data")
      do {
        let sink = try FileSink(dataFile)
        try BackupFormat.copy(input, sink)
        try sink.sync()
      }
      // Every chunk must decrypt before the item appears (truncation or edits fail).
      _ = try ChunkedCipher.decrypt(input: FileSource(dataFile), output: NullSink(), fileKey: fk, fileId: idBytes)
      let sealedKey = try seal(mk, fk, aad("key", idBytes))
      try SecureFiles.writeAtomic(stage.appendingPathComponent("meta"), header.sealedMeta)
      try SecureFiles.writeAtomic(stage.appendingPathComponent("meta.bak"), header.sealedMeta)
      if let thumb { try SecureFiles.writeAtomic(stage.appendingPathComponent("thumb"), thumb) }
      try SecureFiles.writeAtomic(stage.appendingPathComponent("key.bak"), sealedKey)
      try SecureFiles.writeAtomic(stage.appendingPathComponent("key"), sealedKey)
      try SecureFiles.syncDir(stage)
      try keys.whileKeyIsLive(mk) {
        try SecureFiles.mkdirs(items)
        if SecureFiles.exists(items.appendingPathComponent(id)) { throw VaultError.state("Item already restored") }
        try SecureFiles.moveAtomic(stage, items.appendingPathComponent(id))
      }
    } catch {
      SecureFiles.deleteTree(stage)
      throw error
    }
  }

  private func clearBackupState() {
    unlink(confirmedFile.path)
    SecureFiles.shred(recoveryFile)
    SecureFiles.shred(root.appendingPathComponent("recovery.key.bak"))
    unlink(deletesFile.path)
  }

  // MARK: - Internals

  private func withFileKey<T>(_ id: String, _ block: ([UInt8], [UInt8]) throws -> T) throws -> T {
    var mk = try requireUnlocked()
    let idBytes = try Vault.parseId(id)
    var fk: [UInt8]
    do {
      fk = try openEither(try itemDir(id), "key") { try open(mk, $0, aad("key", idBytes)) }
    } catch {
      mk.wipe()
      throw error
    }
    mk.wipe()
    defer { fk.wipe() }
    return try block(fk, idBytes)
  }

  /// Opens [name] in [dir], falling back to its ".bak" copy; restores the damaged copy.
  private func openEither<T>(_ dir: URL, _ name: String, _ openFn: ([UInt8]) throws -> T) throws -> T {
    let first: Error
    do {
      return try openFn(try SecureFiles.readBytes(dir.appendingPathComponent(name)))
    } catch let e as VaultError {
      switch e {
      case .integrity, .io: first = e
      default: throw e
      }
    }
    let backup = dir.appendingPathComponent(name + ".bak")
    guard SecureFiles.exists(backup) else { throw first }
    let bytes: [UInt8]
    let value: T
    do {
      bytes = try SecureFiles.readBytes(backup)
      value = try openFn(bytes)
    } catch {
      throw first
    }
    try? SecureFiles.writeAtomic(dir.appendingPathComponent(name), bytes)
    return value
  }

  private func isLiveItem(_ dir: URL) -> Bool {
    SecureFiles.isDirectory(dir) && Vault.isValidId(dir.lastPathComponent) &&
      (SecureFiles.exists(dir.appendingPathComponent("key")) || SecureFiles.exists(dir.appendingPathComponent("key.bak"))) &&
      !SecureFiles.exists(dir.appendingPathComponent(Vault.deletedMarker))
  }

  private func itemDir(_ id: String) throws -> URL {
    _ = try Vault.parseId(id)
    return items.appendingPathComponent(id)
  }

  static func isValidId(_ id: String) -> Bool {
    id.count == 32 && id.utf8.allSatisfy { ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x61 && $0 <= 0x66) }
  }

  private static func parseId(_ id: String) throws -> [UInt8] {
    guard isValidId(id) else { throw VaultError.state("Invalid item id") }
    let chars = Array(id.utf8)
    return (0..<16).map { i in
      func nibble(_ c: UInt8) -> UInt8 { c <= 0x39 ? c - 0x30 : c - 0x61 + 10 }
      return nibble(chars[2 * i]) << 4 | nibble(chars[2 * i + 1])
    }
  }

  /// A private copy of the master key; the caller wipes it.
  private func requireUnlocked() throws -> [UInt8] {
    state.lock()
    defer { state.unlock() }
    guard let mk = masterKey else { throw VaultError.state("Vault is locked") }
    return Array(mk)
  }

  private func currentGeneration() -> UInt64 {
    state.lock()
    defer { state.unlock() }
    return lockGeneration
  }

  private func setMasterKey(_ key: [UInt8], _ generation: UInt64) throws {
    state.lock()
    defer { state.unlock() }
    var mk = key
    if generation != lockGeneration {
      mk.wipe()
      throw VaultError.state("Vault was locked while unlocking")
    }
    masterKey?.wipe()
    masterKey = mk
  }

  private func aad(_ purpose: String, _ id: [UInt8]) -> [UInt8] { Array("PrivateVault item \(purpose) v1".utf8) + id }

  private func seal(_ key: [UInt8], _ plaintext: [UInt8], _ aad: [UInt8]) throws -> [UInt8] {
    let nonce = Primitives.randomBytes(12)
    return nonce + (try Primitives.aesGcmSeal(key: key, nonce: nonce, plaintext: plaintext, aad: aad))
  }

  private func open(_ key: [UInt8], _ sealed: [UInt8], _ aad: [UInt8]) throws -> [UInt8] {
    guard sealed.count >= 12 + 16 else { throw VaultError.integrity("Sealed data too short") }
    return try Primitives.aesGcmOpen(key: key, nonce: Array(sealed[0..<12]), sealed: Array(sealed[12...]), aad: aad)
  }

  /// Same encoding as Java's DataOutputStream (version, UTF strings with 2-byte length, longs).
  static func encodeMeta(_ meta: ItemMeta) -> [UInt8] {
    func utf(_ s: String) -> [UInt8] {
      let b = Array(s.utf8)
      return [UInt8(b.count >> 8 & 0xFF), UInt8(b.count & 0xFF)] + b
    }
    func long(_ v: Int64) -> [UInt8] { (0..<8).map { UInt8(truncatingIfNeeded: UInt64(bitPattern: v) >> (8 * UInt64(7 - $0))) } }
    return [1] + utf(meta.kind.rawValue) + utf(meta.mimeType) + long(meta.createdAtEpochMs) + long(meta.sizeBytes)
  }

  static func decodeMeta(_ b: [UInt8]) throws -> ItemMeta {
    var p = 0
    func need(_ n: Int) throws { if p + n > b.count { throw VaultError.integrity("Short metadata") } }
    func utf() throws -> String {
      try need(2)
      let n = Int(b[p]) << 8 | Int(b[p + 1])
      p += 2
      try need(n)
      defer { p += n }
      return String(decoding: b[p..<(p + n)], as: UTF8.self)
    }
    func long() throws -> Int64 {
      try need(8)
      var v: UInt64 = 0
      for i in 0..<8 { v = v << 8 | UInt64(b[p + i]) }
      p += 8
      return Int64(bitPattern: v)
    }
    try need(1)
    guard b[0] == 1 else { throw VaultError.integrity("Unknown metadata version") }
    p = 1
    guard let kind = ItemKind(rawValue: try utf()) else { throw VaultError.integrity("Unknown item kind") }
    return ItemMeta(kind: kind, mimeType: try utf(), createdAtEpochMs: try long(), sizeBytes: try long())
  }
}

/// Holding area for in-app camera captures that exist nowhere else (port of PendingImports.kt).
/// A capture is moved here before it is encrypted and removed only after the vault verified
/// its encrypted copy; otherwise it is retried after the next unlock (SPEC AC-50).
final class PendingImports {
  private let dir: URL

  init(dir: URL) { self.dir = dir }

  /// Moves [source] into the holding area and returns its new location.
  func stash(_ source: URL, kind: ItemKind) throws -> URL {
    try SecureFiles.mkdirs(dir)
    let ext = kind == .VIDEO ? "video" : "photo"
    let target = dir.appendingPathComponent("\(UUID().uuidString).\(ext)")
    do {
      try SecureFiles.moveAtomic(source, target)
    } catch {
      // Different volumes: copy durably to a temp name, publish with a rename, then remove.
      let tmp = dir.appendingPathComponent(target.lastPathComponent + ".tmp")
      defer { SecureFiles.deleteTree(tmp) }
      try SecureFiles.copySynced(from: source, to: tmp)
      try SecureFiles.moveAtomic(tmp, target)
      SecureFiles.deleteTree(source)
    }
    // A rename keeps the camera cache's weaker protection; captures wait here in plain
    // form, so they get the strongest class (unreadable while the phone is locked).
    SecureFiles.protectComplete(target)
    return target
  }

  /// Only for a vault destruction: captures meant for the old vault never reach a new one.
  func clear() {
    for f in SecureFiles.list(dir) { SecureFiles.shred(f) }
  }

  /// Files waiting to be imported, oldest first.
  func pending() -> [URL] {
    SecureFiles.list(dir).filter { !SecureFiles.isDirectory($0) && kindOf($0) != nil }
      .sorted { SecureFiles.modifiedAt($0) < SecureFiles.modifiedAt($1) }
  }

  func kindOf(_ file: URL) -> ItemKind? {
    switch file.pathExtension {
    case "photo": return .PHOTO
    case "video": return .VIDEO
    default: return nil
    }
  }

  /// Imports [file]; deletes it only once the vault reports a verified copy.
  func importOne(vault: Vault, file: URL, mimeType: String, thumbnail: [UInt8]? = nil) throws -> ImportResult {
    guard let kind = kindOf(file) else { throw VaultError.state("Not a pending capture") }
    let sha = try sha256(of: file)
    let created = Int64(SecureFiles.modifiedAt(file).timeIntervalSince1970 * 1000)
    let result = try vault.importItem(content: FileSource(file), meta: ItemMeta(kind: kind, mimeType: mimeType, createdAtEpochMs: created),
                                      thumbnail: thumbnail, expectedSha256: sha)
    if result.safeToDeleteOriginal {
      SecureFiles.shred(file)
      try? SecureFiles.syncDir(dir)
    }
    return result
  }
}

/// SHA-256 of a whole file, read in 64 KiB pieces.
func sha256(of url: URL) throws -> [UInt8] {
  let src = try FileSource(url)
  let h = Sha256()
  var buffer = [UInt8](repeating: 0, count: 64 * 1024)
  while true {
    let n = try src.read(into: &buffer, offset: 0, max: buffer.count)
    if n <= 0 { break }
    h.update(buffer, count: n)
  }
  return h.finish()
}
