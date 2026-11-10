import Foundation
#if canImport(CryptoKit)
import CryptoKit
import Security
#else
import COpenSSL
#endif

/// The few primitives the vault needs, from CryptoKit on iPhone (OpenSSL only in Linux tests).
/// Same algorithms and sizes as the Android core: AES-256-GCM (96-bit nonce, 128-bit tag),
/// SHA-256, HMAC-SHA256.
enum Primitives {
  static func randomBytes(_ count: Int) -> [UInt8] {
    var out = [UInt8](repeating: 0, count: count)
    if count == 0 { return out }
    #if canImport(CryptoKit)
    let status = SecRandomCopyBytes(kSecRandomDefault, count, &out)
    precondition(status == errSecSuccess, "Secure random generator failed")
    #else
    precondition(RAND_bytes(&out, Int32(count)) == 1, "Secure random generator failed")
    #endif
    return out
  }

  static func sha256(_ data: [UInt8]) -> [UInt8] {
    let h = Sha256()
    h.update(data)
    return h.finish()
  }

  static func hmacSha256(key: [UInt8], data: [UInt8]) -> [UInt8] {
    #if canImport(CryptoKit)
    let mac = HMAC<SHA256>.authenticationCode(for: data, using: SymmetricKey(data: key))
    return [UInt8](mac)
    #else
    var out = [UInt8](repeating: 0, count: 32)
    var len: UInt32 = 32
    _ = key.withUnsafeBufferPointer { k in
      data.withUnsafeBufferPointer { d in
        HMAC(EVP_sha256(), k.baseAddress, Int32(k.count), d.baseAddress, d.count, &out, &len)
      }
    }
    return out
    #endif
  }

  /// Returns ciphertext || tag. The caller guarantees the (key, nonce) pair is never reused.
  static func aesGcmSeal(key: [UInt8], nonce: [UInt8], plaintext: [UInt8], aad: [UInt8]) throws -> [UInt8] {
    precondition(key.count == 32, "AES-256 key required")
    precondition(nonce.count == 12, "96-bit nonce required")
    #if canImport(CryptoKit)
    let box = try AES.GCM.seal(plaintext, using: SymmetricKey(data: key), nonce: AES.GCM.Nonce(data: nonce), authenticating: aad)
    return [UInt8](box.ciphertext) + [UInt8](box.tag)
    #else
    let ctx = EVP_CIPHER_CTX_new()!
    defer { EVP_CIPHER_CTX_free(ctx) }
    var out = [UInt8](repeating: 0, count: plaintext.count + 16)
    var len: Int32 = 0
    var total: Int32 = 0
    guard EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), nil, key, nonce) == 1 else { throw VaultError.integrity("cipher init") }
    if !aad.isEmpty { guard EVP_EncryptUpdate(ctx, nil, &len, aad, Int32(aad.count)) == 1 else { throw VaultError.integrity("aad") } }
    if !plaintext.isEmpty {
      guard EVP_EncryptUpdate(ctx, &out, &len, plaintext, Int32(plaintext.count)) == 1 else { throw VaultError.integrity("encrypt") }
      total = len
    }
    guard (out.withUnsafeMutableBufferPointer { EVP_EncryptFinal_ex(ctx, $0.baseAddress! + Int(total), &len) }) == 1 else {
      throw VaultError.integrity("final")
    }
    total += len
    var tag = [UInt8](repeating: 0, count: 16)
    guard EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_GET_TAG, 16, &tag) == 1 else { throw VaultError.integrity("tag") }
    return Array(out[0..<Int(total)]) + tag
    #endif
  }

  /// Opens ciphertext || tag. Throws [VaultError.integrity] if anything was altered.
  static func aesGcmOpen(key: [UInt8], nonce: [UInt8], sealed: [UInt8], aad: [UInt8]) throws -> [UInt8] {
    precondition(key.count == 32, "AES-256 key required")
    precondition(nonce.count == 12, "96-bit nonce required")
    guard sealed.count >= 16 else { throw VaultError.integrity("Ciphertext too short") }
    let body = Array(sealed[0..<(sealed.count - 16)])
    var tag = Array(sealed[(sealed.count - 16)...])
    #if canImport(CryptoKit)
    do {
      let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: nonce), ciphertext: body, tag: tag)
      return [UInt8](try AES.GCM.open(box, using: SymmetricKey(data: key), authenticating: aad))
    } catch {
      throw VaultError.integrity("Authentication failed")
    }
    #else
    let ctx = EVP_CIPHER_CTX_new()!
    defer { EVP_CIPHER_CTX_free(ctx) }
    var out = [UInt8](repeating: 0, count: body.count + 16)
    var len: Int32 = 0
    var total: Int32 = 0
    guard EVP_DecryptInit_ex(ctx, EVP_aes_256_gcm(), nil, key, nonce) == 1 else { throw VaultError.integrity("cipher init") }
    if !aad.isEmpty { guard EVP_DecryptUpdate(ctx, nil, &len, aad, Int32(aad.count)) == 1 else { throw VaultError.integrity("aad") } }
    if !body.isEmpty {
      guard EVP_DecryptUpdate(ctx, &out, &len, body, Int32(body.count)) == 1 else { throw VaultError.integrity("decrypt") }
      total = len
    }
    guard EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_TAG, 16, &tag) == 1 else { throw VaultError.integrity("tag") }
    guard (out.withUnsafeMutableBufferPointer { EVP_DecryptFinal_ex(ctx, $0.baseAddress! + Int(total), &len) }) == 1 else {
      throw VaultError.integrity("Authentication failed")
    }
    total += len
    return Array(out[0..<Int(total)])
    #endif
  }

  /// Constant-time comparison.
  static func equal(_ a: [UInt8], _ b: [UInt8]) -> Bool {
    guard a.count == b.count else { return false }
    var diff: UInt8 = 0
    for i in 0..<a.count { diff |= a[i] ^ b[i] }
    return diff == 0
  }
}

/// Incremental SHA-256.
final class Sha256 {
  #if canImport(CryptoKit)
  private var hasher = SHA256()
  #else
  private let ctx: UnsafeMutablePointer<SHA256_CTX> = .allocate(capacity: 1)
  #endif

  init() {
    #if !canImport(CryptoKit)
    SHA256_Init(ctx)
    #endif
  }

  deinit {
    #if !canImport(CryptoKit)
    ctx.deallocate()
    #endif
  }

  func update(_ data: [UInt8]) {
    update(data, count: data.count)
  }

  func update(_ data: [UInt8], count: Int) {
    if count == 0 { return }
    #if canImport(CryptoKit)
    data.withUnsafeBytes { hasher.update(bufferPointer: UnsafeRawBufferPointer(rebasing: $0[0..<count])) }
    #else
    _ = data.withUnsafeBytes { SHA256_Update(ctx, $0.baseAddress, count) }
    #endif
  }

  func finish() -> [UInt8] {
    #if canImport(CryptoKit)
    return [UInt8](hasher.finalize())
    #else
    var out = [UInt8](repeating: 0, count: 32)
    SHA256_Final(&out, ctx)
    return out
    #endif
  }
}

/// HKDF-SHA256 (RFC 5869) and Argon2id, the two key derivations of the vault.
enum Kdf {
  static let saltBytes = 16
  static let outBytes = 32

  static func hkdfSha256(ikm: [UInt8], salt: [UInt8], info: [UInt8], length: Int = outBytes) -> [UInt8] {
    let prk = Primitives.hmacSha256(key: salt.isEmpty ? [UInt8](repeating: 0, count: 32) : salt, data: ikm)
    var out: [UInt8] = []
    var previous: [UInt8] = []
    var counter: UInt8 = 1
    while out.count < length {
      previous = Primitives.hmacSha256(key: prk, data: previous + info + [counter])
      out += previous
      counter &+= 1
    }
    return Array(out[0..<length])
  }

  static func argon2id(pin: [UInt8], salt: [UInt8], params: Argon2Params) -> [UInt8] {
    Argon2.hash(password: pin, salt: salt, memoryKiB: params.memoryKiB, iterations: params.iterations, parallelism: params.parallelism, length: outBytes)
  }
}

/// Argon2id cost settings, stored in the authenticated envelope header (same rules as Android).
struct Argon2Params: Equatable {
  let memoryKiB: Int
  let iterations: Int
  let parallelism: Int

  // Lower than Android's 1 GiB: an iPhone app is killed (not given an error) when it runs out
  // of memory, so an edited header must not be able to ask for more than a phone can give.
  static let maxMemoryKiB = 256 * 1024
  static let maxIterations = 16

  init(memoryKiB: Int, iterations: Int, parallelism: Int) throws {
    guard parallelism >= 1, parallelism <= 16, iterations >= 1, memoryKiB >= 8 * parallelism else {
      throw VaultError.invalidParameters
    }
    // Upper bounds stop an edited header from forcing a huge allocation before it is authenticated.
    guard memoryKiB <= Argon2Params.maxMemoryKiB, iterations <= Argon2Params.maxIterations else {
      throw VaultError.invalidParameters
    }
    self.memoryKiB = memoryKiB
    self.iterations = iterations
    self.parallelism = parallelism
  }

  /// 64 MiB, 3 passes: the phone setting used by the Android app too (SPEC AC-14).
  static let phone = try! Argon2Params(memoryKiB: 64 * 1024, iterations: 3, parallelism: 1)
}

extension Array where Element == UInt8 {
  /// Best-effort removal of secrets from memory. Swift may still hold copies.
  mutating func wipe() {
    for i in indices { self[i] = 0 }
  }
}
