import CryptoKit
import Foundation
import Security

/// The device-bound half of the vault key (SPEC AC-15/AC-20), iPhone version.
///
/// A P-256 key-agreement key is created inside the Secure Enclave; its private part never
/// leaves the chip (CryptoKit only hands out an encrypted blob that this one chip can use).
/// mix(data) = HKDF-SHA256(ECDH(enclaveKey, peerPublicKey), salt: data). Both the blob and
/// the peer public key are stored in the Keychain as "this device only, when unlocked", so
/// they are excluded from iCloud and device-to-device backups.
///
/// Devices without a Secure Enclave (the simulator) fall back to a software key in the
/// Keychain and report "SOFTWARE" so the UI can say so.
final class IOSHardwareKey: HardwareKey {
  private static let service = "com.jellydock.privatevault.hardwarekey"
  private static let enclaveAccount = "enclave-key"
  private static let softwareAccount = "software-key"
  private static let peerAccount = "peer-public-key"
  private static let mixInfo = Array("PrivateVault HW mix v1".utf8)

  private let lock = NSLock()

  static var secureEnclaveAvailable: Bool { SecureEnclave.isAvailable }

  func exists() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    // A Keychain that cannot be read right now (device locked) is NOT a missing key: saying
    // "missing" could let a destroyed-vault path skip the delete. Only "not found" counts.
    if [Self.peerAccount, Self.enclaveAccount, Self.softwareAccount].contains(where: { status($0) == .unreadable }) { return true }
    return loadPeer() != nil && (load(Self.enclaveAccount) != nil || load(Self.softwareAccount) != nil)
  }

  private enum ItemStatus { case present, missing, unreadable }

  private func status(_ account: String) -> ItemStatus {
    var q = query(account)
    q[kSecReturnData as String] = false
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    switch SecItemCopyMatching(q as CFDictionary, nil) {
    case errSecSuccess: return .present
    case errSecItemNotFound: return .missing
    default: return .unreadable
    }
  }

  /// "SECURE_ENCLAVE", "SOFTWARE" or "NONE" for the key that exists now.
  func describeExisting() -> String {
    lock.lock()
    defer { lock.unlock() }
    if loadPeer() == nil { return "NONE" }
    if load(Self.enclaveAccount) != nil { return "SECURE_ENCLAVE" }
    if load(Self.softwareAccount) != nil { return "SOFTWARE" }
    return "NONE"
  }

  func create() throws {
    lock.lock()
    defer { lock.unlock() }
    deleteAll()
    if SecureEnclave.isAvailable {
      var error: Unmanaged<CFError>?
      guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, .privateKeyUsage, &error) else {
        throw VaultError.io("access control")
      }
      let key = try SecureEnclave.P256.KeyAgreement.PrivateKey(accessControl: access)
      try store(Self.enclaveAccount, key.dataRepresentation)
    } else {
      try store(Self.softwareAccount, P256.KeyAgreement.PrivateKey().rawRepresentation)
    }
    // Only the public half of the peer is kept; its private half is discarded right away.
    try store(Self.peerAccount, P256.KeyAgreement.PrivateKey().publicKey.x963Representation)
  }

  func mix(_ data: [UInt8]) throws -> [UInt8] {
    lock.lock()
    defer { lock.unlock() }
    guard let peerData = loadPeer() else { throw VaultError.keysUnavailable }
    let peer = try P256.KeyAgreement.PublicKey(x963Representation: peerData)
    let shared: SharedSecret
    if let blob = load(Self.enclaveAccount) {
      shared = try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: blob).sharedSecretFromKeyAgreement(with: peer)
    } else if let raw = load(Self.softwareAccount) {
      shared = try P256.KeyAgreement.PrivateKey(rawRepresentation: raw).sharedSecretFromKeyAgreement(with: peer)
    } else {
      throw VaultError.keysUnavailable
    }
    let key = shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: data, sharedInfo: Self.mixInfo, outputByteCount: 32)
    return key.withUnsafeBytes { Array($0) }
  }

  func destroy() throws {
    lock.lock()
    defer { lock.unlock() }
    deleteAll()
    // Must be gone for sure; anything else (still there, or unreadable) is an error so the
    // destruction is retried on the next unlock.
    if [Self.peerAccount, Self.enclaveAccount, Self.softwareAccount].contains(where: { status($0) != .missing }) {
      throw VaultError.io("Keychain delete failed")
    }
  }

  // MARK: - Keychain

  private func query(_ account: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: Self.service,
      kSecAttrAccount as String: account,
    ]
  }

  private func store(_ account: String, _ data: Data) throws {
    SecItemDelete(query(account) as CFDictionary)
    var add = query(account)
    add[kSecValueData as String] = data
    add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    add[kSecAttrSynchronizable as String] = false
    let status = SecItemAdd(add as CFDictionary, nil)
    guard status == errSecSuccess else { throw VaultError.io("Keychain add \(status)") }
  }

  private func load(_ account: String) -> Data? {
    var q = query(account)
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
    return out as? Data
  }

  private func loadPeer() -> Data? { load(Self.peerAccount) }

  private func deleteAll() {
    for account in [Self.enclaveAccount, Self.softwareAccount, Self.peerAccount] {
      SecItemDelete(query(account) as CFDictionary)
    }
  }
}
