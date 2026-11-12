import Foundation
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

/// Time source for the wait after wrong attempts (mirrors core/Lockout.kt). [elapsedMs] keeps
/// counting while the phone sleeps and does not follow wall-clock changes; [wallMs] only
/// tells one boot from the next.
protocol MonotonicClock {
  func elapsedMs() -> Int64
  func wallMs() -> Int64
}

/// Real clock. On iPhone CLOCK_MONOTONIC keeps counting during sleep; on Linux (tests only)
/// CLOCK_BOOTTIME does.
struct SystemMonotonicClock: MonotonicClock {
  func elapsedMs() -> Int64 {
    var ts = timespec()
    #if canImport(Darwin)
    clock_gettime(CLOCK_MONOTONIC, &ts)
    #else
    clock_gettime(CLOCK_BOOTTIME, &ts)
    #endif
    return Int64(ts.tv_sec) * 1000 + Int64(ts.tv_nsec) / 1_000_000
  }

  func wallMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }
}

/// Wrong attempts never erase anything (owner decision 2026-11-12, SPEC AC-04). After
/// [freeAttempts] wrong attempts each further attempt has to wait, longer every time.
enum LockoutPolicy {
  static let freeAttempts = 3
  static let maxCount = 100_000

  static func delayMs(_ failures: Int) -> Int64 {
    switch failures {
    case ..<freeAttempts: return 0
    case freeAttempts: return 60_000
    case freeAttempts + 1: return 5 * 60_000
    case freeAttempts + 2: return 15 * 60_000
    default: return 60 * 60_000
    }
  }
}

/// When the last attempt was made, as (boot, time since boot), in two copies. After a reboot
/// or a clock change the full wait starts again, so neither shortens it (see Lockout.kt).
final class LockoutRecord {
  private let file: URL
  private let backup: URL
  private let clock: MonotonicClock
  private static let bootToleranceMs: Int64 = 120_000

  init(file: URL, clock: MonotonicClock) {
    self.file = file
    backup = file.deletingLastPathComponent().appendingPathComponent(file.lastPathComponent + ".bak")
    self.clock = clock
  }

  func markNow() throws {
    let bytes = encode(now())
    try SecureFiles.writeAtomic(file, bytes)
    try? SecureFiles.writeAtomic(backup, bytes)
  }

  func remainingMs(_ failures: Int) -> Int64 {
    let delay = LockoutPolicy.delayMs(failures)
    if delay == 0 { return 0 }
    let current = now()
    let stored = [file, backup].compactMap(decode).filter { sameBoot($0, current) }.max { $0.1 < $1.1 }
    guard let last = stored else {
      try? markNow()
      return delay
    }
    return min(max(delay - (current.1 - last.1), 0), delay)
  }

  func clear() {
    SecureFiles.shred(file)
    SecureFiles.shred(backup)
  }

  private func sameBoot(_ a: (Int64, Int64), _ b: (Int64, Int64)) -> Bool {
    abs(a.0 - b.0) <= LockoutRecord.bootToleranceMs && b.1 >= a.1
  }

  private func now() -> (Int64, Int64) {
    let elapsed = clock.elapsedMs()
    return (clock.wallMs() - elapsed, elapsed)
  }

  private func encode(_ v: (Int64, Int64)) -> [UInt8] {
    var out: [UInt8] = []
    for x in [v.0, v.1] { for i in (0..<8).reversed() { out.append(UInt8(truncatingIfNeeded: UInt64(bitPattern: x) >> (UInt64(i) * 8))) } }
    return out
  }

  private func decode(_ url: URL) -> (Int64, Int64)? {
    guard let b = try? SecureFiles.readBytes(url), b.count == 16 else { return nil }
    func read(_ o: Int) -> Int64 { Int64(bitPattern: (0..<8).reduce(UInt64(0)) { $0 << 8 | UInt64(b[o + $1]) }) }
    return (read(0), read(8))
  }
}
