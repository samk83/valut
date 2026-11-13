import Foundation
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

/// Encrypted backup for when the app is deleted or the phone is lost (port of Backup.kt;
/// format: docs/BACKUP_FORMAT.md). The app writes into a folder the user picked (iCloud
/// Drive, the Files app); only the recovery key opens it. No server is involved.
protocol BackupFolder: AnyObject {
  func list() throws -> [String]
  func openRead(_ name: String) throws -> ByteSource
  /// Writes [name] completely or not at all (temporary name, then rename).
  func write(_ name: String, _ block: (ByteSink) throws -> Void) throws
  /// Removes [name]. Throws if it is still there afterwards.
  func delete(_ name: String) throws
  /// Size in bytes of [name], or -1 if unknown (for example an iCloud file not downloaded yet).
  func size(_ name: String) -> Int64
}

extension BackupFolder {
  func size(_ name: String) -> Int64 { -1 }
}

/// A folder given as a file URL. On iPhone this is the folder the user picked; files that
/// are only in iCloud (not downloaded yet) are fetched before they are read.
final class LocalBackupFolder: BackupFolder {
  let dir: URL

  init(dir: URL) { self.dir = dir }

  func list() throws -> [String] {
    var names: Set<String> = []
    for url in SecureFiles.list(dir) {
      var name = url.lastPathComponent
      // iCloud placeholder of a file not downloaded yet: ".name.pvb.icloud".
      if name.hasPrefix("."), name.hasSuffix(".icloud") {
        name = String(name.dropFirst().dropLast(".icloud".count))
      }
      if !SecureFiles.isDirectory(url) { names.insert(name) }
    }
    return Array(names)
  }

  func openRead(_ name: String) throws -> ByteSource {
    let url = dir.appendingPathComponent(name)
    #if os(iOS)
    try downloadIfNeeded(url)
    #endif
    return try FileSource(url)
  }

  func write(_ name: String, _ block: (ByteSink) throws -> Void) throws {
    try SecureFiles.mkdirs(dir)
    let tmp = dir.appendingPathComponent(name + BackupFormat.part)
    defer { unlink(tmp.path) }
    do {
      let sink = try FileSink(tmp)
      try block(sink)
      try sink.sync()
    }
    try SecureFiles.moveAtomic(tmp, dir.appendingPathComponent(name))
  }

  func delete(_ name: String) throws {
    // Also the iCloud placeholder (".name.icloud") of a copy not downloaded to this phone.
    for url in [dir.appendingPathComponent(name), placeholder(name)] where SecureFiles.exists(url) {
      try FileManager.default.removeItem(at: url)
    }
  }

  func size(_ name: String) -> Int64 {
    let url = dir.appendingPathComponent(name)
    guard SecureFiles.exists(url), !SecureFiles.exists(placeholder(name)),
          let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
          let size = attrs[.size] as? NSNumber else { return -1 }
    return size.int64Value
  }

  private func placeholder(_ name: String) -> URL { dir.appendingPathComponent("." + name + ".icloud") }

  #if os(iOS)
  /// Starts the iCloud download of [url] if needed and waits for it (up to 10 minutes).
  private func downloadIfNeeded(_ url: URL) throws {
    let status = (try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]))?.ubiquitousItemDownloadingStatus
    // Not in iCloud (a local folder) or already downloaded: nothing to do.
    if status == .current || (status == nil && SecureFiles.exists(url)) { return }
    try? FileManager.default.startDownloadingUbiquitousItem(at: url)
    try waitForDownload(url)
  }

  private func waitForDownload(_ url: URL) throws {
    let deadline = Date().addingTimeInterval(600)
    while Date() < deadline {
      var fresh = url
      fresh.removeAllCachedResourceValues()
      let status = (try? fresh.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]))?.ubiquitousItemDownloadingStatus
      if status == .current || (status == nil && SecureFiles.exists(url)) { return }
      Thread.sleep(forTimeInterval: 0.5)
    }
    throw VaultError.io("iCloud download timed out: \(url.lastPathComponent)")
  }
  #endif
}

/// The 256-bit recovery key and its written form: 52 characters in groups of four.
enum RecoveryKey {
  static let bytes = 32
  private static let alphabet = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ".utf8) // Crockford base32
  private static let chars = (bytes * 8 + 4) / 5

  static func generate() -> [UInt8] { Primitives.randomBytes(bytes) }

  static func format(_ key: [UInt8]) -> String {
    precondition(key.count == bytes)
    var out: [UInt8] = []
    var buffer = 0
    var bits = 0
    for b in key {
      buffer = (buffer << 8) | Int(b)
      bits += 8
      while bits >= 5 {
        out.append(alphabet[(buffer >> (bits - 5)) & 31])
        bits -= 5
      }
      buffer &= (1 << bits) - 1
    }
    if bits > 0 { out.append(alphabet[(buffer << (5 - bits)) & 31]) }
    var groups: [String] = []
    var i = 0
    while i < out.count {
      groups.append(String(decoding: out[i..<min(i + 4, out.count)], as: UTF8.self))
      i += 4
    }
    return groups.joined(separator: "-")
  }

  /// Reads a typed key. Spaces, dashes and case are ignored; O, I and L are read as 0, 1, 1.
  /// Returns nil if the text cannot be a recovery key.
  static func parse(_ text: String) -> [UInt8]? {
    let clean: [UInt8] = Array(text.uppercased().utf8).compactMap { c in
      switch c {
      case 0x20, 0x09, 0x0A, 0x0D, 0x2D: return nil
      case 0x4F: return 0x30 // O
      case 0x49, 0x4C: return 0x31 // I, L
      default: return c
      }
    }
    guard clean.count == chars else { return nil }
    var out: [UInt8] = []
    var buffer = 0
    var bits = 0
    for c in clean {
      guard let v = alphabet.firstIndex(of: c) else { return nil }
      buffer = (buffer << 5) | v
      bits += 5
      if bits >= 8 {
        if out.count < bytes { out.append(UInt8((buffer >> (bits - 8)) & 0xFF)) }
        bits -= 8
        buffer &= (1 << bits) - 1
      }
    }
    guard out.count == bytes, buffer == 0 else { return nil }
    return out
  }
}

struct BackupReport: Equatable {
  let written: Int
  let removed: Int
  let total: Int
}

struct RestoreReport: Equatable {
  let restored: Int
  let alreadyHere: Int
  let damaged: Int
}

enum BackupFormat {
  static let info = "backup.pvbi"
  static let ext = ".pvb"
  static let part = ".part"
  private static let infoMagic = Array("PVBI".utf8)
  private static let itemMagic = Array("PVB1".utf8)
  private static let version: UInt8 = 1
  private static let check = Array("PrivateVault backup check v1".utf8)
  private static let infoAad = Array("PrivateVault backup info v1".utf8)
  private static let keyAad = Array("PrivateVault backup key v1".utf8)
  private static let hkdfInfo = Array("PrivateVault backup v1".utf8)
  private static let maxMeta = 64 * 1024
  private static let maxThumb = 16 * 1024 * 1024

  static func backupKey(_ recoveryKey: [UInt8]) -> [UInt8] { Kdf.hkdfSha256(ikm: recoveryKey, salt: [], info: hkdfInfo) }

  static func infoFile(_ backupKey: [UInt8]) throws -> [UInt8] {
    let sealed = try seal(backupKey, check, infoAad)
    return infoMagic + [version] + u16(sealed.count) + sealed
  }

  static func opensInfo(_ bytes: [UInt8], _ backupKey: [UInt8]) -> Bool {
    guard bytes.count >= 7, Array(bytes[0..<4]) == infoMagic, bytes[4] == version else { return false }
    let len = Int(bytes[5]) << 8 | Int(bytes[6])
    guard bytes.count == 7 + len else { return false }
    guard let plain = try? open(backupKey, Array(bytes[7...]), infoAad) else { return false }
    return plain == check
  }

  static func itemHeader(id: [UInt8], wrappedKey: [UInt8], sealedMeta: [UInt8], sealedThumb: [UInt8]?) -> [UInt8] {
    let thumb = sealedThumb ?? []
    return itemMagic + [version] + id + u16(wrappedKey.count) + wrappedKey + u32(sealedMeta.count) + sealedMeta + u32(thumb.count) + thumb
  }

  /// Bytes before the data in an item file, for a thumbnail of [thumbLen] bytes (0 = none).
  static func headerSize(metaLen: Int64, thumbLen: Int64) -> Int64 {
    4 + 1 + 16 + 2 + wrappedKeyLen + 4 + metaLen + 4 + thumbLen
  }

  /// Length of a wrapped 32-byte file key.
  static let wrappedKeyLen: Int64 = {
    let sealed = try? seal([UInt8](repeating: 0, count: 32), [UInt8](repeating: 0, count: 32), [])
    return Int64(sealed?.count ?? 60)
  }()

  static func wrapKey(_ backupKey: [UInt8], _ fileKey: [UInt8], _ id: [UInt8]) throws -> [UInt8] {
    try seal(backupKey, fileKey, keyAad + id)
  }

  struct ItemHeader {
    let id: [UInt8]
    var fileKey: [UInt8]
    let sealedMeta: [UInt8]
    let sealedThumb: [UInt8]?
  }

  /// Reads an item header, leaving [input] at the start of the data.
  static func readItemHeader(_ input: ByteSource, _ backupKey: [UInt8]) throws -> ItemHeader {
    guard try readFully(input, 5) == itemMagic + [version] else { throw VaultError.integrity("Not a backup item") }
    let id = try readFully(input, 16)
    let keyLen = try int(readFully(input, 2))
    guard keyLen <= 256 else { throw VaultError.integrity("Bad key length") }
    let wrapped = try readFully(input, keyLen)
    let metaLen = try int(readFully(input, 4))
    guard metaLen >= 1, metaLen <= maxMeta else { throw VaultError.integrity("Bad metadata length") }
    let meta = try readFully(input, metaLen)
    let thumbLen = try int(readFully(input, 4))
    guard thumbLen <= maxThumb else { throw VaultError.integrity("Bad thumbnail length") }
    let thumb = thumbLen == 0 ? nil : try readFully(input, thumbLen)
    let fileKey = try open(backupKey, wrapped, keyAad + id)
    return ItemHeader(id: id, fileKey: fileKey, sealedMeta: meta, sealedThumb: thumb)
  }

  static func readFully(_ input: ByteSource, _ count: Int) throws -> [UInt8] {
    var buffer = [UInt8](repeating: 0, count: count)
    var filled = 0
    while filled < count {
      let n = try input.read(into: &buffer, offset: filled, max: count - filled)
      if n == 0 { throw VaultError.integrity("Backup item is cut short") }
      filled += n
    }
    return buffer
  }

  static func readAll(_ input: ByteSource) throws -> [UInt8] {
    let sink = MemorySink()
    try copy(input, sink)
    return sink.bytes
  }

  /// Copies the rest of [input] into [output].
  static func copy(_ input: ByteSource, _ output: ByteSink) throws {
    var buffer = [UInt8](repeating: 0, count: 256 * 1024)
    while true {
      let n = try input.read(into: &buffer, offset: 0, max: buffer.count)
      if n == 0 { return }
      try output.write(n == buffer.count ? buffer : Array(buffer[0..<n]))
    }
  }

  static func seal(_ key: [UInt8], _ plaintext: [UInt8], _ aad: [UInt8]) throws -> [UInt8] {
    let nonce = Primitives.randomBytes(12)
    return nonce + (try Primitives.aesGcmSeal(key: key, nonce: nonce, plaintext: plaintext, aad: aad))
  }

  static func open(_ key: [UInt8], _ sealed: [UInt8], _ aad: [UInt8]) throws -> [UInt8] {
    guard sealed.count >= 12 + 16 else { throw VaultError.integrity("Sealed data too short") }
    return try Primitives.aesGcmOpen(key: key, nonce: Array(sealed[0..<12]), sealed: Array(sealed[12...]), aad: aad)
  }

  private static func int(_ b: [UInt8]) -> Int { b.reduce(0) { $0 << 8 | Int($1) } }
  private static func u16(_ v: Int) -> [UInt8] { [UInt8(v >> 8 & 0xFF), UInt8(v & 0xFF)] }
  private static func u32(_ v: Int) -> [UInt8] { [UInt8(v >> 24 & 0xFF), UInt8(v >> 16 & 0xFF), UInt8(v >> 8 & 0xFF), UInt8(v & 0xFF)] }
}
