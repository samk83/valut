import Foundation
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

/// Small durable file helpers (mirrors core/SecureFiles.kt). All vault files live in the
/// app's private container, excluded from backups by the module.
enum SecureFiles {
  static func exists(_ url: URL) -> Bool { FileManager.default.fileExists(atPath: url.path) }

  static func isDirectory(_ url: URL) -> Bool {
    var dir: ObjCBool = false
    return FileManager.default.fileExists(atPath: url.path, isDirectory: &dir) && dir.boolValue
  }

  static func readBytes(_ url: URL) throws -> [UInt8] {
    do {
      return [UInt8](try Data(contentsOf: url))
    } catch {
      throw VaultError.io("read \(url.lastPathComponent)")
    }
  }

  static func mkdirs(_ url: URL) throws {
    do {
      try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    } catch {
      throw VaultError.io("mkdir \(url.lastPathComponent)")
    }
  }

  /// Writes [data] so that readers see either the old or the new content, never a mix.
  static func writeAtomic(_ target: URL, _ data: [UInt8]) throws {
    let dir = target.deletingLastPathComponent()
    try mkdirs(dir)
    // A unique name so two writers never share a temp file.
    let tmp = dir.appendingPathComponent("\(target.lastPathComponent).\(UUID().uuidString).tmp")
    defer { unlink(tmp.path) }
    try writeSynced(tmp, data)
    guard rename(tmp.path, target.path) == 0 else { throw VaultError.io("rename \(target.lastPathComponent) errno \(errno)") }
    try syncDir(dir)
  }

  /// Creates [url] with [data] and flushes it to storage.
  static func writeSynced(_ url: URL, _ data: [UInt8]) throws {
    let fd = open(url.path, O_WRONLY | O_CREAT | O_TRUNC, 0o600)
    guard fd >= 0 else { throw VaultError.io("open \(url.lastPathComponent) errno \(errno)") }
    defer { close(fd) }
    try writeAll(fd, data, count: data.count)
    try fullSync(fd)
  }

  static func writeAll(_ fd: Int32, _ data: [UInt8], count: Int) throws {
    var written = 0
    while written < count {
      let n = data.withUnsafeBytes { write(fd, $0.baseAddress! + written, count - written) }
      if n < 0 {
        if errno == EINTR { continue }
        throw VaultError.io("write errno \(errno)")
      }
      written += n
    }
  }

  /// fsync, plus F_FULLFSYNC on Apple devices so the data really reaches flash.
  static func fullSync(_ fd: Int32) throws {
    #if canImport(Darwin)
    if fcntl(fd, F_FULLFSYNC) == 0 { return }
    #endif
    guard fsync(fd) == 0 else { throw VaultError.io("fsync errno \(errno)") }
  }

  /// Copies a file in 1 MiB pieces (a long video never has to fit in memory) and flushes it.
  static func copySynced(from source: URL, to target: URL) throws {
    let src = try FileSource(source)
    let sink = try FileSink(target)
    var buffer = [UInt8](repeating: 0, count: 1024 * 1024)
    while true {
      let n = try src.read(into: &buffer, offset: 0, max: buffer.count)
      if n <= 0 { break }
      try writeAll(sink.fd, buffer, count: n)
    }
    try sink.sync()
  }

  /// iPhone/iPad: strongest data protection (file unreadable while the device is locked).
  static func protectComplete(_ url: URL) {
    #if os(iOS)
    try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
    #endif
  }

  /// Moves [source] to [target] atomically and makes the rename survive a power cut.
  static func moveAtomic(_ source: URL, _ target: URL) throws {
    guard rename(source.path, target.path) == 0 else { throw VaultError.io("move errno \(errno)") }
    try syncDir(target.deletingLastPathComponent())
    try syncDir(source.deletingLastPathComponent())
  }

  /// Flushes a directory entry to storage, so a rename is not lost after a reboot.
  static func syncDir(_ dir: URL) throws {
    let fd = open(dir.path, O_RDONLY)
    guard fd >= 0 else { throw VaultError.io("open dir errno \(errno)") }
    defer { close(fd) }
    try fullSync(fd)
  }

  /// Overwrites a small file with random bytes before deleting it. On flash this is not a
  /// guarantee; the real protection is that the keys are destroyed (cryptographic erasure).
  static func shred(_ url: URL) {
    if isDirectory(url) {
      deleteTree(url)
      return
    }
    guard exists(url) else { return }
    if let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size]) as? NSNumber,
       size.intValue > 0, size.intValue <= maxShredBytes {
      let fd = open(url.path, O_WRONLY)
      if fd >= 0 {
        _ = try? writeAll(fd, Primitives.randomBytes(size.intValue), count: size.intValue)
        _ = try? fullSync(fd)
        close(fd)
      }
    }
    unlink(url.path)
  }

  static func deleteTree(_ url: URL) {
    guard exists(url) else { return }
    try? FileManager.default.removeItem(at: url)
  }

  /// Names of the entries in [dir] (empty when it does not exist).
  static func list(_ dir: URL) -> [URL] {
    guard let names = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return [] }
    return names.map { dir.appendingPathComponent($0) }
  }

  static func modifiedAt(_ url: URL) -> Date {
    ((try? FileManager.default.attributesOfItem(atPath: url.path)[.modificationDate]) as? Date) ?? Date(timeIntervalSince1970: 0)
  }

  private static let maxShredBytes = 64 * 1024
}

/// Durable count of consecutive failed unlocks, kept in two copies (mirrors AttemptCounter.kt).
protocol AttemptCounter {
  func read() -> Int
  func write(_ value: Int) throws
}

final class FileAttemptCounter: AttemptCounter {
  private let file: URL
  private let backup: URL

  init(file: URL) {
    self.file = file
    self.backup = file.deletingLastPathComponent().appendingPathComponent(file.lastPathComponent + ".bak")
  }

  /// Both copies missing or damaged leave one attempt; disagreeing copies use the higher
  /// value, so editing one copy never shortens a wait (see the Kotlin version).
  func read() -> Int {
    [file, backup].compactMap(parse).max() ?? tampered
  }

  func write(_ value: Int) throws {
    let v = UInt32(value)
    let bytes: [UInt8] = [UInt8(v >> 24 & 0xFF), UInt8(v >> 16 & 0xFF), UInt8(v >> 8 & 0xFF), UInt8(v & 0xFF)]
    try SecureFiles.writeAtomic(file, bytes)
    // A failed second write must not turn a correct PIN into an error; the old copy is
    // removed so it cannot win over the new value.
    do { try SecureFiles.writeAtomic(backup, bytes) } catch { unlink(backup.path) }
  }

  private func parse(_ url: URL) -> Int? {
    guard let bytes = try? SecureFiles.readBytes(url), bytes.count == 4 else { return nil }
    let value = Int(bytes[0]) << 24 | Int(bytes[1]) << 16 | Int(bytes[2]) << 8 | Int(bytes[3])
    return (0...LockoutPolicy.maxCount).contains(value) ? value : nil
  }

  private var tampered: Int { LockoutPolicy.freeAttempts - 1 }
}

/// A device-bound secret that never leaves the security chip (mirrors HardwareKey.kt).
/// iPhone: P-256 key in the Secure Enclave; mix = HKDF(ECDH(enclaveKey, peer), data).
protocol HardwareKey: AnyObject {
  func exists() -> Bool
  func create() throws
  /// Deterministic keyed function of [data] computed inside the security chip (32 bytes).
  func mix(_ data: [UInt8]) throws -> [UInt8]
  /// Permanently deletes the device key. Must be irreversible.
  func destroy() throws
}
