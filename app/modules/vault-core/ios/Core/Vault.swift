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

  init(root: URL, hardwareKey: HardwareKey, params: Argon2Params = .phone, chunkSize: Int = ChunkedCipher.defaultChunkSize) throws {
    self.root = root
    items = root.appendingPathComponent("items")
    staging = root.appendingPathComponent("staging")
    self.chunkSize = chunkSize
    keys = VaultKeyManager(envelopeFile: root.appendingPathComponent("vault.key"),
                           counter: FileAttemptCounter(file: root.appendingPathComponent("attempts")),
                           hardwareKey: hardwareKey, params: params)
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

  func wipeLeftoversForFreshInstall() throws {
    lock()
    try keys.wipeLeftoversForFreshInstall()
    SecureFiles.deleteTree(items)
  }

  func create(pin: [UInt8]) throws {
    try SecureFiles.mkdirs(root)
    let generation = currentGeneration()
    let mk = try keys.create(pin: pin)
    // Only now is it safe to clear leftover ciphertext of a destroyed vault.
    SecureFiles.deleteTree(items)
    try setMasterKey(mk, generation)
  }

  /// Unlocks the vault. If [lock] is called meanwhile, the result is thrown away.
  func unlock(pin: [UInt8]) throws {
    lock()
    let generation = currentGeneration()
    let mk = try destroyingItemsOnLockout { try keys.unlock(pin: pin) }
    try setMasterKey(mk, generation)
  }

  func changePin(current: [UInt8], new newPin: [UInt8]) throws {
    try destroyingItemsOnLockout { try keys.changePin(current: current, new: newPin) }
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
  func importItem(content: ByteSource, meta: ItemMeta, thumbnail: [UInt8]? = nil, expectedSha256: [UInt8]? = nil) throws -> ImportResult {
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

  /// Permanent deletion: the wrapped file key goes first, then the ciphertext (PRD 9.2).
  func delete(id: String) throws {
    var mk = try requireUnlocked()
    mk.wipe()
    let dir = try itemDir(id)
    guard SecureFiles.exists(dir) else { return }
    try SecureFiles.writeAtomic(dir.appendingPathComponent(Vault.deletedMarker), [])
    for name in ["key", "key.bak", "meta", "meta.bak", "thumb"] { SecureFiles.shred(dir.appendingPathComponent(name)) }
    SecureFiles.deleteTree(dir)
  }

  /// Destroys the whole vault: master key first, then every file (PRD 9.3).
  func destroy() throws {
    lock()
    try keys.destroy()
    SecureFiles.deleteTree(items)
    SecureFiles.deleteTree(staging)
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

  /// Ciphertext is removed only after a real 3-strike destruction, never on a key glitch.
  private func destroyingItemsOnLockout<T>(_ block: () throws -> T) throws -> T {
    do {
      return try block()
    } catch VaultError.destroyed {
      lock()
      SecureFiles.deleteTree(items)
      SecureFiles.deleteTree(staging)
      throw VaultError.destroyed
    }
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
