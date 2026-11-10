import Foundation
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

/// Owns the vault master key (MK) and the 3-strike rule. Port of core/VaultKeyManager.kt.
///
///   A   = Argon2id(PIN, salt, params)
///   H   = HardwareKey.mix(A)                      computed inside the Secure Enclave
///   KEK = HKDF-SHA256(A || H, salt, "PrivateVault KEK v1")
///   envelope = AES-256-GCM(KEK, MK, aad = envelope header)
///
/// The PIN alone cannot open the envelope (H is needed), and the device key alone cannot
/// either (A is needed). There is no recovery key of any kind (PRD PV-SEC-001).
final class VaultKeyManager {
  static let maxAttempts = 3

  private let envelopeFile: URL
  private let backupFile: URL
  private let checkFile: URL
  private let lockFile: URL
  private let counter: AttemptCounter
  private let hardwareKey: HardwareKey
  private let params: Argon2Params

  // Bytes of the envelope copy that opened in the current unlock; used only by repairCopies.
  private var lastOpened: [UInt8]?

  init(envelopeFile: URL, counter: AttemptCounter, hardwareKey: HardwareKey, params: Argon2Params) {
    self.envelopeFile = envelopeFile
    let dir = envelopeFile.deletingLastPathComponent()
    let name = envelopeFile.lastPathComponent
    backupFile = dir.appendingPathComponent(name + ".bak")
    checkFile = dir.appendingPathComponent(name + ".check")
    lockFile = dir.appendingPathComponent(name + ".lock")
    self.counter = counter
    self.hardwareKey = hardwareKey
    self.params = params
  }

  private func hasEnvelope() -> Bool { SecureFiles.exists(envelopeFile) || SecureFiles.exists(backupFile) }

  func exists() -> Bool { hasEnvelope() && hardwareKey.exists() }

  func remainingAttempts() -> Int { max(VaultKeyManager.maxAttempts - counter.read(), 0) }

  /// Creates a new vault and returns its master key. The caller must wipe it when done.
  func create(pin: [UInt8]) throws -> [UInt8] {
    try exclusive {
      if hasEnvelope() { throw VaultError.state("Vault already exists") }
      if let r = PinPolicy.check(pin) { throw VaultError.weakPin(r) }
      // The counter goes first: an envelope must never exist next to a stale count.
      try counter.write(0)
      try hardwareKey.create()
      var mk = Primitives.randomBytes(32)
      do {
        try SecureFiles.writeAtomic(checkFile, keyCheck(mk))
        try writeEnvelope(pin: pin, mk: mk)
      } catch {
        mk.wipe()
        throw error
      }
      return mk
    }
  }

  /// Checks [pin] and returns the master key. On the third wrong PIN the keys are destroyed.
  func unlock(pin: [UInt8]) throws -> [UInt8] {
    try exclusive { try unlockLocked(pin) }
  }

  /// Runs [block] only if [mk] is still the live master key, holding the vault lock.
  func whileKeyIsLive<T>(_ mk: [UInt8], _ block: () throws -> T) throws -> T {
    try exclusive {
      let live = hasEnvelope() && hardwareKey.exists() && SecureFiles.exists(checkFile) &&
        Primitives.equal((try? SecureFiles.readBytes(checkFile)) ?? [], keyCheck(mk))
      if !live { throw VaultError.destroyed }
      return try block()
    }
  }

  /// Re-wraps the same master key under a new PIN. The current PIN is required (PV-017).
  func changePin(current: [UInt8], new newPin: [UInt8]) throws {
    try exclusive {
      if let r = PinPolicy.check(newPin) { throw VaultError.weakPin(r) }
      var mk = try unlockLocked(current)
      defer { mk.wipe() }
      try writeEnvelope(pin: newPin, mk: mk)
    }
  }

  /// Cryptographic erasure: after this no PIN can ever open the old vault.
  func destroy() throws { try exclusive { try destroyLocked() } }

  /// First launch after (re)install: Keychain and Secure Enclave items survive an uninstall
  /// on iPhone, so leftovers are deleted here (SPEC AC-20).
  func wipeLeftoversForFreshInstall() throws {
    try exclusive {
      if hardwareKey.exists() { try hardwareKey.destroy() }
      SecureFiles.shred(envelopeFile)
      SecureFiles.shred(backupFile)
      SecureFiles.shred(checkFile)
      try counter.write(0)
    }
  }

  /// Shreds temp files left by a write interrupted by a crash.
  func sweepTempFiles() throws {
    try exclusive {
      for f in SecureFiles.list(envelopeFile.deletingLastPathComponent()) where f.lastPathComponent.hasSuffix(".tmp") && !SecureFiles.isDirectory(f) {
        SecureFiles.shred(f)
      }
    }
  }

  private func unlockLocked(_ pin: [UInt8]) throws -> [UInt8] {
    if !PinPolicy.isCompleteEntry(pin) { throw VaultError.incompleteEntry }
    let used = counter.read()
    if used >= VaultKeyManager.maxAttempts {
      // The final attempt was recorded but the process died, or a destruction was
      // interrupted: the destruction is (re)done so killing the app gives no free retry.
      try destroyLocked()
      throw VaultError.destroyed
    }
    let envelope = hasEnvelope()
    let chipKey = hardwareKey.exists()
    if !envelope && !chipKey { throw VaultError.destroyed }
    if !envelope || !chipKey { throw VaultError.keysUnavailable }
    let copies = readEnvelopeCopies()
    if copies.isEmpty { throw VaultError.keysUnavailable }
    // Count first, check second (SPEC AC-03).
    try counter.write(used + 1)
    var mk: [UInt8]
    do {
      mk = try openEnvelope(pin: pin, copies: copies)
    } catch VaultError.integrity {
      if used + 1 >= VaultKeyManager.maxAttempts {
        try destroyLocked()
        throw VaultError.destroyed
      }
      throw VaultError.wrongPin(remaining: VaultKeyManager.maxAttempts - (used + 1))
    } catch {
      // The check did not complete (Secure Enclave error): give the attempt back.
      try? counter.write(used)
      throw error
    }
    do {
      try counter.write(0)
      repairCopies(mk)
    } catch {
      mk.wipe()
      throw error
    }
    return mk
  }

  /// After a successful unlock, rewrite a missing or damaged copy (SPEC AC-50).
  private func repairCopies(_ mk: [UInt8]) {
    guard let good = lastOpened else { return }
    lastOpened = nil
    if (try? SecureFiles.readBytes(envelopeFile)) != good { try? SecureFiles.writeAtomic(envelopeFile, good) }
    if (try? SecureFiles.readBytes(backupFile)) != good { try? SecureFiles.writeAtomic(backupFile, good) }
    let check = keyCheck(mk)
    if !Primitives.equal((try? SecureFiles.readBytes(checkFile)) ?? [], check) { try? SecureFiles.writeAtomic(checkFile, check) }
  }

  /// Structurally valid envelope copies, primary first, duplicates removed.
  private func readEnvelopeCopies() -> [[UInt8]] {
    var out: [[UInt8]] = []
    for f in [envelopeFile, backupFile] {
      guard let bytes = try? SecureFiles.readBytes(f), (try? decodeHeader(bytes)) != nil else { continue }
      if !out.contains(bytes) { out.append(bytes) }
    }
    return out
  }

  private func destroyLocked() throws {
    // The count is set first so an interruption still leaves the vault refusing entry.
    try counter.write(VaultKeyManager.maxAttempts)
    if hardwareKey.exists() { try hardwareKey.destroy() }
    SecureFiles.shred(envelopeFile)
    SecureFiles.shred(backupFile)
    SecureFiles.shred(checkFile)
    let prefix = envelopeFile.lastPathComponent + "."
    for f in SecureFiles.list(envelopeFile.deletingLastPathComponent())
    where f.lastPathComponent.hasPrefix(prefix) && f.lastPathComponent.hasSuffix(".tmp") {
      SecureFiles.shred(f)
    }
  }

  /// Holds an in-process lock (threads) and a file lock (processes and extensions).
  private func exclusive<T>(_ block: () throws -> T) throws -> T {
    let monitor = VaultKeyManager.monitor(for: lockFile.standardizedFileURL.path)
    monitor.lock()
    defer { monitor.unlock() }
    try SecureFiles.mkdirs(lockFile.deletingLastPathComponent())
    let fd = open(lockFile.path, O_RDWR | O_CREAT, 0o600)
    guard fd >= 0 else { throw VaultError.io("lock errno \(errno)") }
    defer { close(fd) }
    while flock(fd, LOCK_EX) != 0 {
      if errno != EINTR { throw VaultError.io("flock errno \(errno)") }
    }
    defer { flock(fd, LOCK_UN) }
    return try block()
  }

  private func writeEnvelope(pin: [UInt8], mk: [UInt8]) throws {
    let salt = Primitives.randomBytes(Kdf.saltBytes)
    let header = encodeHeader(params, salt)
    var kek = try deriveKek(pin: pin, salt: salt, params: params)
    defer { kek.wipe() }
    let nonce = Primitives.randomBytes(12)
    let envelope = header + nonce + (try Primitives.aesGcmSeal(key: kek, nonce: nonce, plaintext: mk, aad: header))
    // Backup first: if the app dies between the two writes, one copy always opens.
    try SecureFiles.writeAtomic(backupFile, envelope)
    try SecureFiles.writeAtomic(envelopeFile, envelope)
  }

  /// Tries each envelope copy; one unlock call is one attempt however many copies are tried.
  private func openEnvelope(pin: [UInt8], copies: [[UInt8]]) throws -> [UInt8] {
    var keks: [[UInt8]: [UInt8]] = [:]
    defer {
      for k in keks.keys { keks[k]?.wipe() }
    }
    var lastError: Error = VaultError.integrity("No envelope copy")
    for bytes in copies {
      // The header (with the Argon2 params) is the AEAD's associated data.
      let (stored, salt, headerLength) = try decodeHeader(bytes)
      let header = Array(bytes[0..<headerLength])
      let kek: [UInt8]
      if let k = keks[header] {
        kek = k
      } else {
        kek = try deriveKek(pin: pin, salt: salt, params: stored)
        keks[header] = kek
      }
      let sealed = Array(bytes[headerLength...])
      guard sealed.count >= 12 + 16 else { lastError = VaultError.integrity("Envelope too short"); continue }
      do {
        let mk = try Primitives.aesGcmOpen(key: kek, nonce: Array(sealed[0..<12]), sealed: Array(sealed[12...]), aad: header)
        lastOpened = bytes
        return mk
      } catch let e as VaultError {
        lastError = e
      }
    }
    throw lastError
  }

  private func keyCheck(_ mk: [UInt8]) -> [UInt8] {
    Kdf.hkdfSha256(ikm: mk, salt: [], info: Array("PrivateVault MK check v1".utf8))
  }

  private func deriveKek(pin: [UInt8], salt: [UInt8], params p: Argon2Params) throws -> [UInt8] {
    var a = Kdf.argon2id(pin: pin, salt: salt, params: p)
    var h = try hardwareKey.mix(a)
    var ikm = a + h
    defer {
      a.wipe()
      h.wipe()
      ikm.wipe()
    }
    return Kdf.hkdfSha256(ikm: ikm, salt: salt, info: Array("PrivateVault KEK v1".utf8))
  }

  private static let magic: [UInt8] = Array("PVK1".utf8)
  private static let formatVersion: UInt8 = 1
  private static let headerBytes = 4 + 1 + 4 + 4 + 1 + Kdf.saltBytes

  private func encodeHeader(_ p: Argon2Params, _ salt: [UInt8]) -> [UInt8] {
    VaultKeyManager.magic + [VaultKeyManager.formatVersion] + be32(p.memoryKiB) + be32(p.iterations) + [UInt8(p.parallelism)] + salt
  }

  private func decodeHeader(_ bytes: [UInt8]) throws -> (Argon2Params, [UInt8], Int) {
    let h = VaultKeyManager.headerBytes
    guard bytes.count >= h + 12 + 16 else { throw VaultError.integrity("Envelope too short") }
    guard Array(bytes[0..<4]) == VaultKeyManager.magic else { throw VaultError.integrity("Not a vault envelope") }
    guard bytes[4] == VaultKeyManager.formatVersion else { throw VaultError.integrity("Unsupported envelope version") }
    let p: Argon2Params
    do {
      p = try Argon2Params(memoryKiB: readBe32(bytes, 5), iterations: readBe32(bytes, 9), parallelism: Int(bytes[13]))
    } catch {
      throw VaultError.integrity("Invalid envelope parameters")
    }
    return (p, Array(bytes[14..<(14 + Kdf.saltBytes)]), h)
  }

  private func be32(_ v: Int) -> [UInt8] {
    let u = UInt32(truncatingIfNeeded: v)
    return [UInt8(u >> 24 & 0xFF), UInt8(u >> 16 & 0xFF), UInt8(u >> 8 & 0xFF), UInt8(u & 0xFF)]
  }

  private func readBe32(_ b: [UInt8], _ o: Int) -> Int {
    // Signed like Java's readInt, so a huge stored value fails validation instead of wrapping.
    Int(Int32(bitPattern: UInt32(b[o]) << 24 | UInt32(b[o + 1]) << 16 | UInt32(b[o + 2]) << 8 | UInt32(b[o + 3])))
  }

  // One monitor per vault folder: two manager objects for the same files wait for each other.
  private static var monitors: [String: NSLock] = [:]
  private static let monitorsLock = NSLock()

  private static func monitor(for path: String) -> NSLock {
    monitorsLock.lock()
    defer { monitorsLock.unlock() }
    if let m = monitors[path] { return m }
    let m = NSLock()
    monitors[path] = m
    return m
  }
}
