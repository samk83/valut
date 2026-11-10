import Foundation
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

// Moving a vault to a new phone (1.1). Port of core/Transfer.kt; the two must stay
// byte-for-byte compatible so an iPhone and an Android phone can transfer to each other.
// Wire format: docs/TRANSFER_PROTOCOL.md. Summary:
//   QR code  = "PVT1:" host ":" port ":" base64url(secret 32 bytes)
//   handshake (plain)  = "PVT1" | version 1 | random nonce 32, from each side
//   keys     = HMAC(prk, "PrivateVault transfer c2s|s2c" | 0x01), prk = HMAC(nonceC | nonceS, secret)
//   frame    = u32 length | AES-256-GCM(key, nonce = 0000 | u64 counter, msg, aad "PVT1 frame")
// The sender never deletes anything.

/// What the QR code carries.
struct TransferCode: Equatable {
  let host: String
  let port: Int
  let secret: [UInt8]

  static let secretBytes = 32
  private static let prefix = "PVT1:"

  func encode() -> String { TransferCode.prefix + "\(host):\(port):" + TransferCode.base64url(secret) }

  /// Parses a scanned code. Only private, local-network IPv4 addresses are accepted.
  static func parse(_ text: String) throws -> TransferCode {
    guard text.hasPrefix(prefix) else { throw TransferFailure(.badCode, "Not a PrivateVault transfer code") }
    let parts = text.dropFirst(prefix.count).split(separator: ":", omittingEmptySubsequences: false).map(String.init)
    guard parts.count == 3, isLocalIPv4(parts[0]), let port = Int(parts[1]), (1...65535).contains(port),
          let secret = unbase64url(parts[2]), secret.count == secretBytes
    else { throw TransferFailure(.badCode, "Malformed transfer code") }
    return TransferCode(host: parts[0], port: port, secret: secret)
  }

  /// 10/8, 172.16/12, 192.168/16, 169.254/16 and loopback (tests). Nothing on the internet.
  static func isLocalIPv4(_ host: String) -> Bool {
    let octets = host.split(separator: ".", omittingEmptySubsequences: false)
    guard octets.count == 4 else { return false }
    var b: [Int] = []
    for o in octets {
      guard !o.isEmpty, o.count <= 3, o.utf8.allSatisfy({ $0 >= 0x30 && $0 <= 0x39 }), let v = Int(o), v <= 255 else { return false }
      b.append(v)
    }
    return b[0] == 10 || (b[0] == 172 && (16...31).contains(b[1])) || (b[0] == 192 && b[1] == 168) ||
      (b[0] == 169 && b[1] == 254) || b[0] == 127
  }

  /// The phone's own Wi-Fi or hotspot IPv4 address (en0 / bridge100 first), or nil.
  static func localAddress() -> String? {
    var list: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&list) == 0, let first = list else { return nil }
    defer { freeifaddrs(list) }
    var found: [(name: String, host: String)] = []
    var cursor: UnsafeMutablePointer<ifaddrs>? = first
    while let ifa = cursor {
      defer { cursor = ifa.pointee.ifa_next }
      guard let addr = ifa.pointee.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET) || Int32(addr.pointee.sa_family) == AF_INET else { continue }
      let flags = Int32(ifa.pointee.ifa_flags)
      guard flags & Int32(IFF_UP) != 0, flags & Int32(IFF_LOOPBACK) == 0 else { continue }
      var buf = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
      var sin = addr.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee }
      guard inet_ntop(AF_INET, &sin.sin_addr, &buf, socklen_t(INET_ADDRSTRLEN)) != nil else { continue }
      let host = String(cString: buf)
      if isLocalIPv4(host), !host.hasPrefix("127.") { found.append((String(cString: ifa.pointee.ifa_name), host)) }
    }
    func rank(_ name: String) -> Int { name == "en0" ? 0 : name.hasPrefix("bridge") ? 1 : name.hasPrefix("en") ? 2 : 3 }
    return found.sorted { rank($0.name) < rank($1.name) }.first?.host
  }

  static func base64url(_ b: [UInt8]) -> String {
    Data(b).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  static func unbase64url(_ s: String) -> [UInt8]? {
    guard s.utf8.allSatisfy({ ($0 >= 0x41 && $0 <= 0x5A) || ($0 >= 0x61 && $0 <= 0x7A) || ($0 >= 0x30 && $0 <= 0x39) || $0 == 0x2D || $0 == 0x5F })
    else { return nil }
    var t = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    while t.count % 4 != 0 { t += "=" }
    return Data(base64Encoded: t).map { [UInt8]($0) }
  }
}

enum TransferError: Int {
  case badCode = 0, storageFull = 1, locked = 2, integrity = 3, cancelled = 4, other = 5, wrongPeer = 6, connection = 7

  var name: String {
    switch self {
    case .badCode: return "BAD_CODE"
    case .storageFull: return "STORAGE_FULL"
    case .locked: return "LOCKED"
    case .integrity: return "INTEGRITY"
    case .cancelled: return "CANCELLED"
    case .other: return "OTHER"
    case .wrongPeer: return "WRONG_PEER"
    case .connection: return "CONNECTION"
    }
  }

  static func of(_ code: UInt8) -> TransferError { TransferError(rawValue: Int(code)) ?? .other }
}

struct TransferFailure: Error, Equatable {
  let error: TransferError
  let message: String
  init(_ error: TransferError, _ message: String) {
    self.error = error
    self.message = message
  }
}

/// Progress reported to the UI. Byte counts are plaintext bytes.
struct TransferProgress: Equatable {
  var itemsDone: Int
  var itemsTotal: Int
  var bytesDone: Int64
  var bytesTotal: Int64
  var skipped: Int
  var alreadyThere: Int

  mutating func skippedOne(_ bytes: Int64) {
    itemsDone += 1
    skipped += 1
    bytesDone += bytes
  }
}

/// A connected byte stream (TCP socket in the app, socket pair in tests).
protocol TransferStream: AnyObject {
  func readFully(_ count: Int) throws -> [UInt8]
  func writeAll(_ bytes: [UInt8]) throws
  func close()
}

/// Blocking TCP socket. Reads time out after [timeoutSeconds] so a vanished phone is noticed.
final class SocketStream: TransferStream {
  private let fd: Int32
  private let closeLock = NSLock()
  private var closed = false

  init(fd: Int32, timeoutSeconds: Int = 60) {
    self.fd = fd
    var tv = timeval(tv_sec: timeoutSeconds, tv_usec: 0)
    _ = setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
    _ = setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
    var one: Int32 = 1
    _ = setsockopt(fd, Int32(IPPROTO_TCP), TCP_NODELAY, &one, socklen_t(MemoryLayout<Int32>.size))
    #if canImport(Darwin)
    _ = setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))
    #endif
  }

  deinit { close() }

  /// Connects to [host]:[port] (IPv4), giving up after [timeoutSeconds].
  static func connect(host: String, port: Int, timeoutSeconds: Int = 10) throws -> SocketStream {
    let fd = socket(AF_INET, Glue.streamSocket, 0)
    guard fd >= 0 else { throw TransferFailure(.connection, "socket errno \(errno)") }
    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = in_port_t(UInt16(port).bigEndian)
    guard inet_pton(AF_INET, host, &addr.sin_addr) == 1 else {
      _ = Glue.close(fd)
      throw TransferFailure(.badCode, "Bad address")
    }
    // Non-blocking connect so a wrong network fails in seconds, not minutes.
    let flags = fcntl(fd, F_GETFL, 0)
    _ = fcntl(fd, F_SETFL, flags | O_NONBLOCK)
    let rc = withUnsafePointer(to: &addr) { p in
      p.withMemoryRebound(to: sockaddr.self, capacity: 1) { Glibc_connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
    }
    if rc != 0 {
      guard errno == EINPROGRESS else {
        _ = Glue.close(fd)
        throw TransferFailure(.connection, "connect errno \(errno)")
      }
      var pfd = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
      let ready = poll(&pfd, 1, Int32(timeoutSeconds * 1000))
      var err: Int32 = 0
      var len = socklen_t(MemoryLayout<Int32>.size)
      _ = getsockopt(fd, SOL_SOCKET, SO_ERROR, &err, &len)
      guard ready == 1, err == 0 else {
        _ = Glue.close(fd)
        throw TransferFailure(.connection, ready == 1 ? "connect error \(err)" : "connect timed out")
      }
    }
    _ = fcntl(fd, F_SETFL, flags)
    return SocketStream(fd: fd)
  }

  func readFully(_ count: Int) throws -> [UInt8] {
    var out = [UInt8](repeating: 0, count: count)
    var got = 0
    while got < count {
      let n = out.withUnsafeMutableBytes { Glue.read(fd, $0.baseAddress! + got, count - got) }
      if n == 0 { throw TransferFailure(.connection, "Connection closed") }
      if n < 0 {
        if errno == EINTR { continue }
        throw TransferFailure(.connection, errno == EAGAIN || errno == EWOULDBLOCK ? "Timed out" : "read errno \(errno)")
      }
      got += n
    }
    return out
  }

  func writeAll(_ bytes: [UInt8]) throws {
    var sent = 0
    while sent < bytes.count {
      let n = bytes.withUnsafeBytes { Glue.send(fd, $0.baseAddress! + sent, bytes.count - sent) }
      if n < 0 {
        if errno == EINTR { continue }
        throw TransferFailure(.connection, "send errno \(errno)")
      }
      sent += n
    }
  }

  /// Safe to call from another thread to abort a blocked read (cancel).
  func close() {
    closeLock.lock()
    defer { closeLock.unlock() }
    if closed { return }
    closed = true
    Glue.shutdownBoth(fd)
    _ = Glue.close(fd)
  }
}

@inline(__always)
private func Glibc_connect(_ fd: Int32, _ addr: UnsafePointer<sockaddr>, _ len: socklen_t) -> Int32 {
  #if canImport(Darwin)
  return Darwin.connect(fd, addr, len)
  #else
  return Glibc.connect(fd, addr, len)
  #endif
}

/// A listening socket on the new phone, bound to its local address only.
final class TransferListener {
  private let fd: Int32
  let port: Int
  private let closeLock = NSLock()
  private var closed = false

  init(host: String) throws {
    let fd = socket(AF_INET, Glue.streamSocket, 0)
    guard fd >= 0 else { throw TransferFailure(.connection, "socket errno \(errno)") }
    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = 0
    guard inet_pton(AF_INET, host, &addr.sin_addr) == 1 else {
      _ = Glue.close(fd)
      throw TransferFailure(.connection, "Bad local address")
    }
    let bound = withUnsafePointer(to: &addr) { p in
      p.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
    }
    guard bound == 0, listen(fd, 1) == 0 else {
      _ = Glue.close(fd)
      throw TransferFailure(.connection, "bind errno \(errno)")
    }
    var out = sockaddr_in()
    var len = socklen_t(MemoryLayout<sockaddr_in>.size)
    _ = withUnsafeMutablePointer(to: &out) { p in p.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &len) } }
    self.fd = fd
    port = Int(UInt16(bigEndian: out.sin_port))
  }

  deinit { close() }

  /// Waits for the old phone, up to [timeoutSeconds]. Only one connection is ever accepted.
  func accept(timeoutSeconds: Int) throws -> SocketStream {
    var pfd = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
    var remaining = timeoutSeconds * 1000
    while true {
      let started = Date()
      let ready = poll(&pfd, 1, Int32(min(remaining, 1000)))
      closeLock.lock()
      let isClosed = closed
      closeLock.unlock()
      if isClosed { throw TransferFailure(.cancelled, "Cancelled") }
      if ready == 1 { break }
      if ready < 0 && errno != EINTR { throw TransferFailure(.connection, "poll errno \(errno)") }
      remaining -= max(1, Int(Date().timeIntervalSince(started) * 1000))
      if remaining <= 0 { throw TransferFailure(.connection, "No phone connected in time") }
    }
    #if canImport(Darwin)
    let client = Darwin.accept(fd, nil, nil)
    #else
    let client = Glibc.accept(fd, nil, nil)
    #endif
    guard client >= 0 else { throw TransferFailure(.connection, "accept errno \(errno)") }
    close()
    return SocketStream(fd: client)
  }

  func close() {
    closeLock.lock()
    defer { closeLock.unlock() }
    if closed { return }
    closed = true
    _ = Glue.close(fd)
  }
}

enum Msg {
  static let hello: UInt8 = 1
  static let offer: UInt8 = 2
  static let want: UInt8 = 3
  static let begin: UInt8 = 4
  static let data: UInt8 = 5
  static let end: UInt8 = 6
  static let itemOk: UInt8 = 7
  static let fail: UInt8 = 8
  static let done: UInt8 = 9
  static let doneOk: UInt8 = 10
  static let itemAbort: UInt8 = 11

  static let dataBytes = 256 * 1024
  static let maxMime = 128
  static let maxThumb = 1024 * 1024
  static let offerBatch = 20_000
}

/// Encrypted, ordered, authenticated frames. Same rules as SecureChannel in core/Transfer.kt.
final class SecureChannel {
  static let maxFrame = 1024 * 1024 + 4096
  private static let magic: [UInt8] = Array("PVT1".utf8)
  private static let version: UInt8 = 1
  private static let frameAad: [UInt8] = Array("PVT1 frame".utf8)

  private let stream: TransferStream
  private var sendKey: [UInt8]
  private var receiveKey: [UInt8]
  private var sendCounter: UInt64 = 0
  private var receiveCounter: UInt64 = 0

  private init(stream: TransferStream, sendKey: [UInt8], receiveKey: [UInt8]) {
    self.stream = stream
    self.sendKey = sendKey
    self.receiveKey = receiveKey
  }

  static func client(_ stream: TransferStream, secret: [UInt8]) throws -> SecureChannel { try open(stream, secret, isClient: true) }

  static func server(_ stream: TransferStream, secret: [UInt8]) throws -> SecureChannel { try open(stream, secret, isClient: false) }

  private static func open(_ stream: TransferStream, _ secret: [UInt8], isClient: Bool) throws -> SecureChannel {
    precondition(secret.count == TransferCode.secretBytes, "Secret must be 32 bytes")
    let mine = Primitives.randomBytes(32)
    try stream.writeAll(magic + [version] + mine)
    let header = try stream.readFully(magic.count + 1)
    let theirs = try stream.readFully(32)
    guard Array(header[0..<magic.count]) == magic, header[magic.count] == version else {
      throw TransferFailure(.wrongPeer, "Not a PrivateVault transfer")
    }
    var prk = Primitives.hmacSha256(key: isClient ? mine + theirs : theirs + mine, data: secret)
    let c2s = Primitives.hmacSha256(key: prk, data: Array("PrivateVault transfer c2s".utf8) + [1])
    let s2c = Primitives.hmacSha256(key: prk, data: Array("PrivateVault transfer s2c".utf8) + [1])
    prk.wipe()
    let channel = isClient ? SecureChannel(stream: stream, sendKey: c2s, receiveKey: s2c)
                           : SecureChannel(stream: stream, sendKey: s2c, receiveKey: c2s)
    // Both sides prove they know the secret before anything else is said.
    do {
      try channel.send([Msg.hello, version])
      let hello = try channel.receive()
      guard hello == [Msg.hello, version] else { throw TransferFailure(.wrongPeer, "Unexpected hello") }
    } catch {
      channel.close()
      throw error
    }
    return channel
  }

  func send(_ message: [UInt8]) throws {
    precondition(message.count <= SecureChannel.maxFrame, "Frame too large")
    let sealed = try Primitives.aesGcmSeal(key: sendKey, nonce: SecureChannel.nonce(sendCounter), plaintext: message, aad: SecureChannel.frameAad)
    sendCounter += 1
    try stream.writeAll(Wire.u32(UInt32(sealed.count)) + sealed)
  }

  func receive() throws -> [UInt8] {
    let lenBytes = try stream.readFully(4)
    let length = Int(lenBytes[0]) << 24 | Int(lenBytes[1]) << 16 | Int(lenBytes[2]) << 8 | Int(lenBytes[3])
    guard length >= 16, length <= SecureChannel.maxFrame + 16 else { throw TransferFailure(.integrity, "Bad frame length") }
    let sealed = try stream.readFully(length)
    do {
      let plain = try Primitives.aesGcmOpen(key: receiveKey, nonce: SecureChannel.nonce(receiveCounter), sealed: sealed, aad: SecureChannel.frameAad)
      receiveCounter += 1
      return plain
    } catch is VaultError {
      throw TransferFailure(.wrongPeer, "Frame failed authentication")
    }
  }

  func close() {
    sendKey.wipe()
    receiveKey.wipe()
    stream.close()
  }

  private static func nonce(_ counter: UInt64) -> [UInt8] { [0, 0, 0, 0] + Wire.u64(counter) }
}

/// Big-endian encoding, matching java.io.DataOutputStream.
enum Wire {
  static func u32(_ v: UInt32) -> [UInt8] { [UInt8(v >> 24 & 0xFF), UInt8(v >> 16 & 0xFF), UInt8(v >> 8 & 0xFF), UInt8(v & 0xFF)] }
  static func u64(_ v: UInt64) -> [UInt8] { (0..<8).map { UInt8(truncatingIfNeeded: v >> (8 * UInt64(7 - $0))) } }
  static func i64(_ v: Int64) -> [UInt8] { u64(UInt64(bitPattern: v)) }
  /// java writeUTF for ASCII text: u16 length + bytes.
  static func utf(_ s: String) -> [UInt8] {
    let b = Array(String(s.unicodeScalars.filter { $0.isASCII && $0.value != 0 }.prefix(Msg.maxMime)).utf8)
    return [UInt8(b.count >> 8 & 0xFF), UInt8(b.count & 0xFF)] + b
  }

  struct Reader {
    let b: [UInt8]
    var p: Int
    init(_ b: [UInt8], from: Int) {
      self.b = b
      p = from
    }

    mutating func bytes(_ n: Int) throws -> [UInt8] {
      guard n >= 0, p + n <= b.count else { throw TransferFailure(.integrity, "Short message") }
      defer { p += n }
      return Array(b[p..<p + n])
    }

    mutating func u8() throws -> UInt8 { try bytes(1)[0] }
    mutating func u32() throws -> UInt32 { try bytes(4).reduce(0) { $0 << 8 | UInt32($1) } }
    mutating func i32() throws -> Int32 { Int32(bitPattern: try u32()) }
    mutating func i64() throws -> Int64 { Int64(bitPattern: try bytes(8).reduce(UInt64(0)) { $0 << 8 | UInt64($1) }) }
    mutating func utf() throws -> String {
      let n = Int(try u8()) << 8 | Int(try u8())
      return String(decoding: try bytes(n), as: UTF8.self)
    }
  }
}

private func hexOf(_ b: [UInt8]) -> String { b.map { String(format: "%02x", $0) }.joined() }

private func bytesOf(_ id: String) -> [UInt8] {
  let c = Array(id.utf8)
  func nibble(_ x: UInt8) -> UInt8 { x <= 0x39 ? x - 0x30 : x - 0x61 + 10 }
  return (0..<16).map { nibble(c[2 * $0]) << 4 | nibble(c[2 * $0 + 1]) }
}

private func expect(_ channel: SecureChannel, _ type: UInt8) throws -> [UInt8] {
  let frame = try channel.receive()
  if frame.first == Msg.fail { throw TransferFailure(.of(frame.count > 1 ? frame[1] : 5), "Other phone stopped the transfer") }
  guard frame.first == type else { throw TransferFailure(.integrity, "Unexpected message") }
  return frame
}

/// A vault locked (app sent to the background) or erased mid-transfer stops it on both phones.
private func whileVaultOpen<T>(_ channel: SecureChannel, _ block: () throws -> T) throws -> T {
  do {
    return try block()
  } catch let e as VaultError {
    switch e {
    case .state, .destroyed, .keysUnavailable:
      try? channel.send([Msg.fail, UInt8(TransferError.locked.rawValue)])
      throw TransferFailure(.locked, "Vault locked")
    default:
      throw e
    }
  }
}

/// The old phone: sends every item of [vault] that the new phone does not have yet.
final class TransferSender {
  private let vault: Vault
  private let flag = NSLock()
  private var _cancelled = false
  var cancelled: Bool {
    get { flag.lock(); defer { flag.unlock() }; return _cancelled }
    set { flag.lock(); _cancelled = newValue; flag.unlock() }
  }

  init(vault: Vault) { self.vault = vault }

  func run(_ channel: SecureChannel, onProgress: (TransferProgress) -> Void = { _ in }) throws -> TransferProgress {
    try whileVaultOpen(channel) { try send(channel, onProgress) }
  }

  private func send(_ channel: SecureChannel, _ onProgress: (TransferProgress) -> Void) throws -> TransferProgress {
    let items = try vault.list()
    var start = 0
    repeat {
      let end = min(items.count, start + Msg.offerBatch)
      var msg: [UInt8] = [Msg.offer, end == items.count ? 1 : 0] + Wire.u32(UInt32(end - start))
      for item in items[start..<end] {
        msg += bytesOf(item.id) + [item.meta.kind == .VIDEO ? 1 : 0] + Wire.i64(item.meta.sizeBytes)
      }
      try channel.send(msg)
      start = end
    } while start < items.count

    let want = try expect(channel, Msg.want)
    var r = Wire.Reader(want, from: 1)
    let count = Int(try r.u32())
    guard count == items.count, want.count == 5 + (items.count + 7) / 8 else { throw TransferFailure(.integrity, "Bad want list") }
    let wanted = items.enumerated().filter { (want[5 + $0.offset / 8] >> UInt8($0.offset % 8)) & 1 == 1 }.map { $0.element }
    var progress = TransferProgress(itemsDone: 0, itemsTotal: wanted.count, bytesDone: 0,
                                    bytesTotal: wanted.reduce(0) { $0 + $1.meta.sizeBytes }, skipped: 0, alreadyThere: items.count - wanted.count)
    onProgress(progress)

    for item in wanted {
      try checkCancelled(channel)
      var thumb = (try? vault.thumbnail(id: item.id)) ?? nil
      if let t = thumb, t.count > Msg.maxThumb { thumb = nil }
      var begin: [UInt8] = [Msg.begin] + bytesOf(item.id) + [item.meta.kind == .VIDEO ? 1 : 0]
      begin += Wire.utf(item.meta.mimeType) + Wire.i64(item.meta.createdAtEpochMs) + Wire.i64(item.meta.sizeBytes)
      begin += Wire.u32(UInt32(thumb?.count ?? 0)) + (thumb ?? [])
      try channel.send(begin)
      let frames = FrameSink(channel: channel) { [unowned self] in try self.checkCancelled(channel) }
      var ok = true
      do {
        try vault.read(id: item.id, output: frames)
        try frames.flush()
      } catch let e as TransferFailure {
        throw e
      } catch let e as VaultError {
        switch e {
        case .integrity, .io: ok = false // Damaged on this phone; drop it and go on.
        default: throw e
        }
      }
      if !ok {
        try channel.send([Msg.itemAbort])
        progress.skippedOne(item.meta.sizeBytes)
        onProgress(progress)
        continue
      }
      try channel.send([Msg.end] + frames.sha256())
      _ = try expect(channel, Msg.itemOk)
      progress.itemsDone += 1
      progress.bytesDone += item.meta.sizeBytes
      onProgress(progress)
    }
    try channel.send([Msg.done])
    _ = try expect(channel, Msg.doneOk)
    return progress
  }

  private func checkCancelled(_ channel: SecureChannel) throws {
    if cancelled {
      try? channel.send([Msg.fail, UInt8(TransferError.cancelled.rawValue)])
      throw TransferFailure(.cancelled, "Cancelled")
    }
  }

  /// Buffers decrypted bytes into DATA frames and hashes exactly what was sent.
  private final class FrameSink: ByteSink {
    private let channel: SecureChannel
    private let beforeSend: () throws -> Void
    private let digest = Sha256()
    private var buffer: [UInt8] = []

    init(channel: SecureChannel, beforeSend: @escaping () throws -> Void) {
      self.channel = channel
      self.beforeSend = beforeSend
      buffer.reserveCapacity(Msg.dataBytes)
    }

    func write(_ bytes: [UInt8]) throws {
      var i = 0
      while i < bytes.count {
        let n = min(bytes.count - i, Msg.dataBytes - buffer.count)
        buffer += bytes[i..<i + n]
        i += n
        if buffer.count == Msg.dataBytes { try sendBuffer() }
      }
    }

    func flush() throws { if !buffer.isEmpty { try sendBuffer() } }

    private func sendBuffer() throws {
      try beforeSend()
      digest.update(buffer)
      var frame = [Msg.data] + buffer
      buffer.wipe()
      buffer.removeAll(keepingCapacity: true)
      defer { frame.wipe() }
      try channel.send(frame)
    }

    func sha256() -> [UInt8] { digest.finish() }
  }
}

/// The new phone: stores what the old phone sends, under this vault's own keys.
final class TransferReceiver {
  private let vault: Vault
  private let flag = NSLock()
  private var _cancelled = false
  var cancelled: Bool {
    get { flag.lock(); defer { flag.unlock() }; return _cancelled }
    set { flag.lock(); _cancelled = newValue; flag.unlock() }
  }

  init(vault: Vault) { self.vault = vault }

  func run(_ channel: SecureChannel, onProgress: (TransferProgress) -> Void = { _ in }) throws -> TransferProgress {
    try whileVaultOpen(channel) { try receive(channel, onProgress) }
  }

  private struct ItemAborted: Error {}

  private func receive(_ channel: SecureChannel, _ onProgress: (TransferProgress) -> Void) throws -> TransferProgress {
    var offered: [(id: String, size: Int64)] = []
    while true {
      let frame = try expect(channel, Msg.offer)
      var r = Wire.Reader(frame, from: 1)
      let last = try r.u8() != 0
      let count = Int(try r.u32())
      guard count <= Msg.offerBatch else { throw TransferFailure(.integrity, "Bad offer") }
      for _ in 0..<count {
        let id = hexOf(try r.bytes(16))
        _ = try r.u8()
        offered.append((id, try r.i64()))
      }
      if last { break }
      if offered.count > 10_000_000 { throw TransferFailure(.integrity, "Offer too large") }
    }
    let have = try vault.receivedSources()
    var bitmap = [UInt8](repeating: 0, count: (offered.count + 7) / 8)
    var wantedIds = Set<String>()
    var wantedBytes: Int64 = 0
    for (i, o) in offered.enumerated() where !have.contains(o.id) {
      bitmap[i / 8] |= UInt8(1 << (i % 8))
      wantedIds.insert(o.id)
      wantedBytes += max(0, o.size)
    }
    let wantedCount = offered.enumerated().filter { (bitmap[$0.offset / 8] >> UInt8($0.offset % 8)) & 1 == 1 }.count
    try channel.send([Msg.want] + Wire.u32(UInt32(offered.count)) + bitmap)
    var progress = TransferProgress(itemsDone: 0, itemsTotal: wantedCount, bytesDone: 0, bytesTotal: wantedBytes,
                                    skipped: 0, alreadyThere: offered.count - wantedCount)
    onProgress(progress)

    while true {
      if cancelled { try fail(channel, .cancelled, "Cancelled") }
      let frame = try channel.receive()
      switch frame.first {
      case Msg.done:
        try channel.send([Msg.doneOk])
        return progress
      case Msg.fail:
        throw TransferFailure(.of(frame.count > 1 ? frame[1] : 5), "Other phone stopped the transfer")
      case Msg.begin:
        var r = Wire.Reader(frame, from: 1)
        let sourceId = hexOf(try r.bytes(16))
        let kind: ItemKind = try r.u8() == 1 ? .VIDEO : .PHOTO
        let mime = try r.utf()
        let createdAt = try r.i64()
        let size = try r.i64()
        let thumbLen = Int(try r.i32())
        guard mime.count <= Msg.maxMime, (0...Msg.maxThumb).contains(thumbLen), wantedIds.contains(sourceId) else {
          try fail(channel, .integrity, "Bad item header")
        }
        wantedIds.remove(sourceId)
        let thumb = thumbLen > 0 ? try r.bytes(thumbLen) : nil
        let content = FrameSource(channel: channel)
        do {
          _ = try vault.importItem(content: content, meta: ItemMeta(kind: kind, mimeType: mime, createdAtEpochMs: createdAt),
                                   thumbnail: thumb, receivedFrom: sourceId)
        } catch is ItemAborted {
          progress.skippedOne(size)
          onProgress(progress)
          continue
        } catch let e as TransferFailure {
          throw e
        } catch let e as VaultError {
          switch e {
          case .state, .destroyed, .keysUnavailable: try fail(channel, .locked, "Vault locked")
          case .importVerification, .integrity: try fail(channel, .integrity, "Item did not verify")
          case .io(let m): try fail(channel, m.contains("errno \(ENOSPC)") ? .storageFull : .other, m)
          default: try fail(channel, .other, "\(e)")
          }
        }
        try channel.send([Msg.itemOk])
        progress.itemsDone += 1
        progress.bytesDone += size
        onProgress(progress)
      default:
        try fail(channel, .integrity, "Unexpected message")
      }
    }
  }

  private func fail(_ channel: SecureChannel, _ error: TransferError, _ message: String) throws -> Never {
    try? channel.send([Msg.fail, UInt8(error.rawValue)])
    throw TransferFailure(error, message)
  }

  /// Plaintext of one item, read from DATA frames until END; the hash must match.
  private final class FrameSource: ByteSource {
    private let channel: SecureChannel
    private let digest = Sha256()
    private var current: [UInt8] = []
    private var pos = 0
    private var finished = false

    init(channel: SecureChannel) { self.channel = channel }

    deinit { current.wipe() }

    func read(into buffer: inout [UInt8], offset: Int, max: Int) throws -> Int {
      if max == 0 { return 0 }
      while pos >= current.count {
        if finished { return 0 }
        current.wipe()
        var frame = try channel.receive()
        switch frame.first {
        case Msg.data:
          current = Array(frame[1...])
          frame.wipe()
          pos = 0
          digest.update(current)
        case Msg.end:
          // Thrown as an integrity failure so importItem discards the copy.
          guard frame.count == 33, Primitives.equal(Array(frame[1...]), digest.finish()) else { throw VaultError.integrity("Item hash does not match") }
          current = []
          pos = 0
          finished = true
        case Msg.itemAbort:
          throw ItemAborted()
        case Msg.fail:
          throw TransferFailure(.of(frame.count > 1 ? frame[1] : 5), "Other phone stopped the transfer")
        default:
          throw TransferFailure(.integrity, "Unexpected message")
        }
      }
      let n = min(max, current.count - pos)
      for i in 0..<n { buffer[offset + i] = current[pos + i] }
      pos += n
      return n
    }
  }
}
