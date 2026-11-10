// swift-tools-version:5.9
// Test harness for the iOS vault core. The app itself builds these sources through
// VaultCore.podspec; this package only lets the core be compiled and tested off a Mac
// (Linux uses OpenSSL in place of CryptoKit).
import PackageDescription

var targets: [Target] = [
  .target(name: "VaultCoreKit", dependencies: [], path: "Core"),
  .testTarget(name: "VaultCoreKitTests", dependencies: ["VaultCoreKit"], path: "Tests/VaultCoreKitTests"),
]
#if os(Linux)
targets.append(.systemLibrary(name: "COpenSSL", path: "LinuxShims/COpenSSL"))
targets[0] = .target(name: "VaultCoreKit", dependencies: ["COpenSSL"], path: "Core")
#endif

let package = Package(name: "VaultCoreKit", products: [.library(name: "VaultCoreKit", targets: ["VaultCoreKit"])], targets: targets)
