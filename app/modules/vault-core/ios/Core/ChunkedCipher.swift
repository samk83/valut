import Foundation
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

/// Where bytes are read from: a file or memory. read returns 0 at the end.
protocol ByteSource: AnyObject {
  func read(into buffer: inout [UInt8], offset: Int, max: Int) throws -> Int
}

/// Where decrypted or encrypted bytes go.
protocol ByteSink: AnyObject {
  func write(_ bytes: [UInt8]) throws
}

final class FileSource: ByteSource {
  private let fd: Int32

  init(_ url: URL) throws {
    fd = open(url.path, O_RDONLY)
    guard fd >= 0 else { throw VaultError.io("open \(url.lastPathComponent) errno \(errno)") }
  }

  deinit { close(fd) }

  func read(into buffer: inout [UInt8], offset: Int, max: Int) throws -> Int {
    while true {
      let n = buffer.withUnsafeMutableBytes { Darwin_read(fd, $0.baseAddress! + offset, max) }
      if n >= 0 { return n }
      if errno != EINTR { throw VaultError.io("read errno \(errno)") }
    }
  }
}

final class FileSink: ByteSink {
  let fd: Int32

  init(_ url: URL) throws {
    fd = open(url.path, O_WRONLY | O_CREAT | O_TRUNC, 0o600)
    guard fd >= 0 else { throw VaultError.io("create \(url.lastPathComponent) errno \(errno)") }
  }

  deinit { close(fd) }

  func write(_ bytes: [UInt8]) throws { try SecureFiles.writeAll(fd, bytes, count: bytes.count) }

  func sync() throws { try SecureFiles.fullSync(fd) }
}

final class MemorySink: ByteSink {
  var bytes: [UInt8] = []
  func write(_ b: [UInt8]) throws { bytes += b }
}

final class DigestSink: ByteSink {
  let hasher = Sha256()
  func write(_ b: [UInt8]) throws { hasher.update(b) }
}

final class NullSink: ByteSink {
  func write(_ b: [UInt8]) throws {}
}

@inline(__always)
private func Darwin_read(_ fd: Int32, _ buf: UnsafeMutableRawPointer, _ n: Int) -> Int {
  #if canImport(Darwin)
  return Darwin.read(fd, buf, n)
  #else
  return Glibc.read(fd, buf, n)
  #endif
}

/// Streaming AES-256-GCM for photos and videos. Same file layout as core/ChunkedCipher.kt:
///   header = "PVF1" | version(1) | chunkSize(4) | noncePrefix(7)
///   chunk i = GCM(fileKey, nonce = noncePrefix || i (4, BE) || isLast (1), aad = fileId || header)
enum ChunkedCipher {
  static let defaultChunkSize = 256 * 1024
  private static let magic: [UInt8] = Array("PVF1".utf8)
  private static let version: UInt8 = 1
  private static let prefixBytes = 7
  static let headerBytes = 4 + 1 + 4 + prefixBytes
  private static let tagBytes = 16

  struct EncryptResult {
    let plaintextBytes: Int64
    let sha256: [UInt8]
  }

  static func encrypt(input: ByteSource, output: ByteSink, fileKey: [UInt8], fileId: [UInt8],
                      chunkSize: Int = defaultChunkSize) throws -> EncryptResult {
    precondition(chunkSize >= 1024 && chunkSize <= 16 * 1024 * 1024, "Chunk size out of range")
    let header = makeHeader(chunkSize: chunkSize, prefix: Primitives.randomBytes(prefixBytes))
    let aad = fileId + header
    let digest = Sha256()
    try output.write(header)
    var index: UInt32 = 0
    var total: Int64 = 0
    var current = try readChunk(input, chunkSize)
    while true {
      // Read ahead one chunk so we know whether the current one is the last.
      var next = current.count == chunkSize ? try readChunk(input, chunkSize) : []
      let isLast = next.isEmpty
      digest.update(current)
      total += Int64(current.count)
      try output.write(Primitives.aesGcmSeal(key: fileKey, nonce: nonce(header, index, isLast), plaintext: current, aad: aad))
      current.wipe()
      if isLast { break }
      current = next
      next = []
      index += 1
      if index == UInt32(Int32.max) { throw VaultError.io("File too large") }
    }
    return EncryptResult(plaintextBytes: total, sha256: digest.finish())
  }

  /// Decrypts a whole stream, failing on any tampering. Returns the plaintext SHA-256.
  @discardableResult
  static func decrypt(input: ByteSource, output: ByteSink, fileKey: [UInt8], fileId: [UInt8]) throws -> [UInt8] {
    let header = try readChunk(input, headerBytes)
    guard header.count == headerBytes else { throw VaultError.integrity("Missing file header") }
    let chunkSize = try parseChunkSize(header)
    let aad = fileId + header
    let digest = Sha256()
    var index: UInt32 = 0
    let stride = chunkSize + tagBytes
    var current = try readChunk(input, stride)
    while true {
      let next = current.count == stride ? try readChunk(input, stride) : []
      let isLast = next.isEmpty
      var plain = try Primitives.aesGcmOpen(key: fileKey, nonce: nonce(header, index, isLast), sealed: current, aad: aad)
      digest.update(plain)
      try output.write(plain)
      plain.wipe()
      if isLast { break }
      current = next
      index += 1
    }
    return digest.finish()
  }

  /// Random-access reader (one chunk at a time) for seeking inside an encrypted video.
  final class Reader {
    private let fd: Int32
    private let header: [UInt8]
    private let fileKey: [UInt8]
    private let fileId: [UInt8]
    private let length: Int64
    let chunkSize: Int
    let chunkCount: Int

    init(url: URL, fileKey: [UInt8], fileId: [UInt8]) throws {
      self.fileKey = fileKey
      self.fileId = fileId
      let fd = open(url.path, O_RDONLY)
      guard fd >= 0 else { throw VaultError.io("open errno \(errno)") }
      self.fd = fd
      do {
        length = Int64(lseek(fd, 0, SEEK_END))
        guard length >= Int64(headerBytes + tagBytes) else { throw VaultError.integrity("File too short") }
        var h = [UInt8](repeating: 0, count: headerBytes)
        guard h.withUnsafeMutableBytes({ pread(fd, $0.baseAddress!, headerBytes, 0) }) == headerBytes else {
          throw VaultError.integrity("Missing file header")
        }
        header = h
        chunkSize = try parseChunkSize(h)
        let stride = Int64(chunkSize + tagBytes)
        chunkCount = Int((length - Int64(headerBytes) + stride - 1) / stride)
      } catch {
        close(fd)
        throw error
      }
    }

    deinit { close(fd) }

    func readChunk(_ index: Int) throws -> [UInt8] {
      precondition(index >= 0 && index < chunkCount, "Chunk index out of range")
      let stride = Int64(chunkSize + tagBytes)
      let offset = Int64(headerBytes) + Int64(index) * stride
      let count = Int(min(stride, length - offset))
      var sealed = [UInt8](repeating: 0, count: count)
      guard sealed.withUnsafeMutableBytes({ pread(fd, $0.baseAddress!, count, off_t(offset)) }) == count else {
        throw VaultError.integrity("Short read")
      }
      return try Primitives.aesGcmOpen(key: fileKey, nonce: ChunkedCipher.nonce(header, UInt32(index), index == chunkCount - 1),
                                       sealed: sealed, aad: fileId + header)
    }
  }

  private static func makeHeader(chunkSize: Int, prefix: [UInt8]) -> [UInt8] {
    let c = UInt32(chunkSize)
    return magic + [version, UInt8(c >> 24 & 0xFF), UInt8(c >> 16 & 0xFF), UInt8(c >> 8 & 0xFF), UInt8(c & 0xFF)] + prefix
  }

  fileprivate static func parseChunkSize(_ header: [UInt8]) throws -> Int {
    guard Array(header[0..<4]) == magic, header[4] == version else { throw VaultError.integrity("Not a vault file") }
    let size = Int(header[5]) << 24 | Int(header[6]) << 16 | Int(header[7]) << 8 | Int(header[8])
    guard size >= 1024, size <= 16 * 1024 * 1024 else { throw VaultError.integrity("Invalid chunk size") }
    return size
  }

  fileprivate static func nonce(_ header: [UInt8], _ index: UInt32, _ isLast: Bool) -> [UInt8] {
    Array(header[(headerBytes - prefixBytes)..<headerBytes]) +
      [UInt8(index >> 24 & 0xFF), UInt8(index >> 16 & 0xFF), UInt8(index >> 8 & 0xFF), UInt8(index & 0xFF), isLast ? 1 : 0]
  }

  private static func readChunk(_ input: ByteSource, _ size: Int) throws -> [UInt8] {
    var buffer = [UInt8](repeating: 0, count: size)
    var filled = 0
    while filled < size {
      let n = try input.read(into: &buffer, offset: filled, max: size - filled)
      if n <= 0 { break }
      filled += n
    }
    if filled == size { return buffer }
    let out = Array(buffer[0..<filled])
    buffer.wipe()
    return out
  }
}
