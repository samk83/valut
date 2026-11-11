Pod::Spec.new do |s|
  s.name           = 'VaultCore'
  s.version        = '0.1.0'
  s.summary        = 'PrivateVault encrypted vault core for iPhone and iPad'
  s.description    = 'Swift port of the shared vault core (Argon2id + Secure Enclave + AES-256-GCM).'
  s.license        = { :type => 'Proprietary' }
  s.author         = 'JellyDock'
  s.homepage       = 'https://github.com/samk83/valut'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/samk83/valut.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'CryptoKit', 'ImageIO', 'Photos', 'Security', 'StoreKit', 'UniformTypeIdentifiers'

  # Only the app sources: Package.swift, Tests/, Tools/ and LinuxShims/ exist for running the
  # core's unit tests off a Mac and are never part of the app.
  s.source_files = 'VaultCoreModule.swift', 'StoreModule.swift', 'IOSHardwareKey.swift', 'Core/*.swift'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
    # Argon2id runs in Swift; keep it optimized even in debug builds (one PIN check would
    # otherwise take many seconds).
    'SWIFT_OPTIMIZATION_LEVEL' => '-O'
  }
end
