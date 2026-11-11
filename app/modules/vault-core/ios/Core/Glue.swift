import Foundation
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

/// Plain POSIX calls under names that do not clash with methods such as Vault.open.
enum Glue {
  #if canImport(Darwin)
  static func open(_ path: String, _ flags: Int32, _ mode: mode_t) -> Int32 { Darwin.open(path, flags, mode) }
  static func close(_ fd: Int32) -> Int32 { Darwin.close(fd) }
  static func lseek(_ fd: Int32, _ offset: off_t, _ whence: Int32) -> off_t { Darwin.lseek(fd, offset, whence) }
  static func read(_ fd: Int32, _ buf: UnsafeMutableRawPointer, _ n: Int) -> Int { Darwin.read(fd, buf, n) }
  static func send(_ fd: Int32, _ buf: UnsafeRawPointer, _ n: Int) -> Int { Darwin.send(fd, buf, n, 0) }
  static func shutdownBoth(_ fd: Int32) { _ = Darwin.shutdown(fd, SHUT_RDWR) }
  static let streamSocket = SOCK_STREAM
  #else
  static func open(_ path: String, _ flags: Int32, _ mode: mode_t) -> Int32 { Glibc.open(path, flags, mode) }
  static func close(_ fd: Int32) -> Int32 { Glibc.close(fd) }
  static func lseek(_ fd: Int32, _ offset: off_t, _ whence: Int32) -> off_t { Glibc.lseek(fd, offset, whence) }
  static func read(_ fd: Int32, _ buf: UnsafeMutableRawPointer, _ n: Int) -> Int { Glibc.read(fd, buf, n) }
  static func send(_ fd: Int32, _ buf: UnsafeRawPointer, _ n: Int) -> Int { Glibc.send(fd, buf, n, Int32(MSG_NOSIGNAL)) }
  static func shutdownBoth(_ fd: Int32) { _ = Glibc.shutdown(fd, Int32(SHUT_RDWR)) }
  static let streamSocket = Int32(SOCK_STREAM.rawValue)
  #endif
}
