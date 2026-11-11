import Foundation

/// Every failure the vault core reports to the app layer (mirrors core/Errors.kt).
enum VaultError: Error, Equatable {
  /// The PIN entry was malformed or too short. It is not counted as an attempt.
  case incompleteEntry
  /// The PIN was wrong; [remaining] tries are left.
  case wrongPin(remaining: Int)
  /// The vault keys were destroyed (3 failed attempts, reset or reinstall). Permanent.
  case destroyed
  /// Only part of the key material is present. Nothing destroyed, nothing counted.
  case keysUnavailable
  /// A vault already exists, or none exists, or it is locked, when the opposite was needed.
  case state(String)
  /// Ciphertext, envelope or chunk failed authentication: tampered, truncated or reordered.
  case integrity(String)
  /// An import did not verify. Nothing was registered and the original must be kept.
  case importVerification(String)
  /// The PIN does not meet the creation policy.
  case weakPin(PinPolicy.Rejection)
  /// Argon2 settings out of range.
  case invalidParameters
  /// A file operation failed (errno attached).
  case io(String)
}

/// Mirrors core/PinPolicy.kt (SPEC AC-01).
enum PinPolicy {
  static let minLength = 4
  static let maxLength = 32
  static let recommendedLength = 10

  enum Rejection: String { case TOO_SHORT, TOO_LONG, NOT_DIGITS, REPEATED, SEQUENTIAL, COMMON }

  enum Strength: String { case WEAK, FAIR, STRONG, FORTRESS }

  private static let common: Set<String> = [
    "1234", "1111", "0000", "1212", "7777", "1004", "2000", "4444", "2222", "6969",
    "9999", "3333", "5555", "6666", "1122", "1313", "8888", "4321", "2001", "1010",
    "2580", "0852", "1379", "1470", "0258", "123456", "654321", "121212", "123123",
    "111222", "112233", "159753", "147258", "102030", "123321", "520520", "12345678",
    "11223344", "87654321", "1234567890", "0987654321",
  ]

  /// Returns nil when [pin] (ASCII bytes) is acceptable for a new vault, else the reason.
  static func check(_ pin: [UInt8]) -> Rejection? {
    if pin.count < minLength { return .TOO_SHORT }
    if pin.count > maxLength { return .TOO_LONG }
    if pin.contains(where: { $0 < 0x30 || $0 > 0x39 }) { return .NOT_DIGITS }
    if pin.allSatisfy({ $0 == pin[0] }) { return .REPEATED }
    if isRun(pin, 1) || isRun(pin, -1) { return .SEQUENTIAL }
    if common.contains(String(decoding: pin, as: UTF8.self)) { return .COMMON }
    return nil
  }

  /// Only well-formed entries are checked and counted (SPEC AC-06).
  static func isCompleteEntry(_ pin: [UInt8]) -> Bool {
    pin.count >= minLength && pin.count <= maxLength && pin.allSatisfy { $0 >= 0x30 && $0 <= 0x39 }
  }

  static func strength(length: Int) -> Strength {
    if length >= recommendedLength { return .FORTRESS }
    if length >= 8 { return .STRONG }
    if length >= 6 { return .FAIR }
    return .WEAK
  }

  private static func isRun(_ pin: [UInt8], _ step: Int) -> Bool {
    (1..<pin.count).allSatisfy { Int(pin[$0]) - Int(pin[$0 - 1]) == step }
  }
}
