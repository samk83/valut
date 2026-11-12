import Foundation

/// Encrypted backup into a folder the user picked (iCloud Drive or On My iPhone), the iPhone
/// twin of android/.../BackupBridge.kt with the same results and events:
///   { phase: "backup-done" | "backup-error" | "restore-progress" | "restore-done" | "restore-error", ... }
/// Backups and restores run on their own queue, because they can take minutes.
final class BackupBridge {
  static let subfolder = "Private Vision Vault Backup"

  private let vault: () throws -> Vault
  private let stateDir: URL
  private let emit: ([String: Any]) -> Void
  private let queue = DispatchQueue(label: "com.jellydock.privatevault.backup", qos: .utility)
  private let lock = NSLock()
  private var running = false
  private var backingUp = false
  private var again = false

  init(vault: @escaping () throws -> Vault, stateDir: URL, emit: @escaping ([String: Any]) -> Void) {
    self.vault = vault
    self.stateDir = stateDir
    self.emit = emit
  }

  private var stateFile: URL { stateDir.appendingPathComponent("backup-state.json") }
  private var bookmarkFile: URL { stateDir.appendingPathComponent("backup-folder.bookmark") }

  func status() throws -> [String: Any] {
    let state = readState()
    return [
      "hasRecoveryKey": try vault().hasRecoveryKey(),
      "keyConfirmed": try vault().isRecoveryKeyConfirmed(),
      "restorePending": state["restorePending"] as? Bool ?? false,
      "folderName": (state["folderName"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? NSNull(),
      "lastBackupAt": state["lastBackupAt"] as? Double ?? 0,
      "lastError": (state["lastError"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? NSNull(),
      "running": isRunning,
    ]
  }

  /// Remembers the picked folder (a backup subfolder is created inside).
  func setFolder(_ uri: String) -> [String: Any] {
    guard let picked = URL(string: uri) else { return ["ok": false, "error": "FAILED"] }
    do {
      return try withAccess(picked) {
        let folder = try BackupBridge.open(picked, create: true)
        let v = try vault()
        // A folder with another vault's backup must not be mixed with this one.
        if v.isUnlocked, var rk = try v.recoveryKey() {
          defer { rk.wipe() }
          if try folder.list().contains(BackupFormat.info) { try Vault.checkBackup(folder, recoveryKey: rk) }
        }
        try saveBookmark(picked)
        writeState { $0["folderName"] = folder.dir.lastPathComponent; $0["lastError"] = "" }
        return ["ok": true, "folderName": folder.dir.lastPathComponent]
      }
    } catch VaultError.backupKeyMismatch {
      return ["ok": false, "error": "FOREIGN"]
    } catch {
      return ["ok": false, "error": "FAILED"]
    }
  }

  /// Forgets the backup folder and status (the vault was destroyed or a new one made).
  func reset() {
    lock.lock()
    defer { lock.unlock() }
    unlink(stateFile.path)
    unlink(bookmarkFile.path)
  }

  /// The user chose not to continue an unfinished restore.
  func dismissRestore() { writeState { $0["restorePending"] = false } }

  /// Records that the user checked their copy of the recovery key.
  func confirmKey() throws { try vault().confirmRecoveryKey() }

  /// Starts a backup in the background. If one is already running it runs once more after
  /// it, so items added meanwhile are copied too.
  func backupNow() -> Bool {
    guard let v = try? vault(), v.isUnlocked, v.hasRecoveryKey(), let picked = loadBookmark() else { return false }
    lock.lock()
    if running {
      if backingUp { again = true }
      let queued = backingUp
      lock.unlock()
      return queued
    }
    running = true
    backingUp = true
    lock.unlock()
    queue.async {
      // takeAgain() ends the run (running = false) in the same locked step that finds no
      // new request, so a request arriving at that moment starts a fresh run instead of
      // being lost.
      repeat {
        self.emit(self.runBackup(v, picked))
      } while self.takeAgain()
    }
    return true
  }

  private func takeAgain() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    let more = again
    again = false
    if !more {
      backingUp = false
      running = false
    }
    return more
  }

  private func runBackup(_ v: Vault, _ picked: URL) -> [String: Any] {
    do {
      let report = try withAccess(picked) { try v.backup(to: try BackupBridge.open(picked, create: true)) }
      writeState { $0["lastBackupAt"] = Date().timeIntervalSince1970 * 1000; $0["lastError"] = "" }
      return ["phase": "backup-done", "written": report.written, "removed": report.removed, "total": report.total]
    } catch VaultError.state {
      // Locked while running: nothing is wrong, the next run continues.
      return ["phase": "backup-error", "error": "LOCKED"]
    } catch {
      // In a backup, a key mismatch means the folder holds another vault's backup.
      let code = (error as? VaultError) == .backupKeyMismatch ? "FOREIGN" : BackupBridge.code(error)
      writeState { $0["lastError"] = code }
      return ["phase": "backup-error", "error": code]
    }
  }

  /// Checks that the picked folder holds a backup the typed key opens.
  func check(_ uri: String, _ keyText: String) -> [String: Any] {
    guard var rk = RecoveryKey.parse(keyText) else { return ["ok": false, "error": "BAD_KEY"] }
    defer { rk.wipe() }
    guard let picked = URL(string: uri) else { return ["ok": false, "error": "FAILED"] }
    do {
      return try withAccess(picked) {
        let folder = try BackupBridge.open(picked, create: false)
        try Vault.checkBackup(folder, recoveryKey: rk)
        return ["ok": true, "count": try Vault.backupItemCount(folder)]
      }
    } catch {
      return ["ok": false, "error": BackupBridge.code(error)]
    }
  }

  /// Restores in the background; progress and the result arrive as events.
  func restore(_ uri: String, _ keyText: String) -> Bool {
    guard let rk = RecoveryKey.parse(keyText), let picked = URL(string: uri), let v = try? vault() else { return false }
    guard begin() else { return false }
    // Remembered until it finishes, so an interrupted restore can be offered again.
    writeState { $0["restorePending"] = true }
    queue.async {
      defer { self.end() }
      var key = rk
      defer { key.wipe() }
      var result: [String: Any]
      do {
        result = try self.withAccess(picked) {
          let folder = try BackupBridge.open(picked, create: false)
          let report = try v.restore(from: folder, recoveryKey: key) { done, total in
            self.emit(["phase": "restore-progress", "done": done, "total": total])
          }
          // Later backups continue into the folder the photos came from.
          // Only if this vault's recovery key is the backup's (it may have its own key already).
          if self.loadBookmark() == nil, var own = try? v.recoveryKey() {
            defer { own.wipe() }
            if own == key {
              try? self.saveBookmark(picked)
              self.writeState { $0["folderName"] = folder.dir.lastPathComponent }
            }
          }
          self.writeState { $0["restorePending"] = false }
          return ["phase": "restore-done", "restored": report.restored, "alreadyHere": report.alreadyHere, "damaged": report.damaged]
        }
      } catch {
        result = ["phase": "restore-error", "error": BackupBridge.code(error)]
      }
      self.emit(result)
    }
    return true
  }

  /// The backup folder for a picked folder: the folder itself if it already holds a backup,
  /// otherwise its subfolder, created if [create].
  static func open(_ picked: URL, create: Bool) throws -> LocalBackupFolder {
    let pickedFolder = LocalBackupFolder(dir: picked)
    if try pickedFolder.list().contains(BackupFormat.info) { return pickedFolder }
    let sub = picked.appendingPathComponent(subfolder, isDirectory: true)
    if SecureFiles.isDirectory(sub) { return LocalBackupFolder(dir: sub) }
    guard create else { throw VaultError.notABackup }
    try FileManager.default.createDirectory(at: sub, withIntermediateDirectories: true)
    return LocalBackupFolder(dir: sub)
  }

  static func code(_ error: Error) -> String {
    switch error as? VaultError {
    case .notABackup?: return "NOT_A_BACKUP"
    case .backupKeyMismatch?: return "WRONG_KEY"
    case .noRecoveryKey?: return "NO_KEY"
    case .state?: return "LOCKED"
    case .io(let message)?: return message.contains("errno 28") ? "FULL" : "FAILED"
    default:
      let ns = error as NSError
      if ns.domain == NSCocoaErrorDomain && ns.code == NSFileWriteOutOfSpaceError { return "FULL" }
      if ns.domain == NSCocoaErrorDomain && (ns.code == NSFileReadNoPermissionError || ns.code == NSFileWriteNoPermissionError) { return "NO_ACCESS" }
      return "FAILED"
    }
  }

  // MARK: - Folder access

  private func withAccess<T>(_ url: URL, _ block: () throws -> T) throws -> T {
    #if os(iOS)
    let started = url.startAccessingSecurityScopedResource()
    defer { if started { url.stopAccessingSecurityScopedResource() } }
    #endif
    return try block()
  }

  private func saveBookmark(_ url: URL) throws {
    #if os(iOS)
    let data = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
    try SecureFiles.writeAtomic(bookmarkFile, Array(data))
    #else
    try SecureFiles.writeAtomic(bookmarkFile, Array(url.absoluteString.utf8))
    #endif
  }

  private func loadBookmark() -> URL? {
    guard let bytes = try? SecureFiles.readBytes(bookmarkFile) else { return nil }
    #if os(iOS)
    var stale = false
    guard let url = try? URL(resolvingBookmarkData: Data(bytes), options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else { return nil }
    if stale { _ = try? withAccess(url) { try saveBookmark(url) } }
    return url
    #else
    return URL(string: String(decoding: bytes, as: UTF8.self))
    #endif
  }

  // MARK: - State

  private var isRunning: Bool {
    lock.lock()
    defer { lock.unlock() }
    return running
  }

  private func begin() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    if running { return false }
    running = true
    return true
  }

  private func end() {
    lock.lock()
    running = false
    lock.unlock()
  }

  private func readState() -> [String: Any] {
    guard let data = try? Data(contentsOf: stateFile),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
    return object
  }

  private func writeState(_ change: (inout [String: Any]) -> Void) {
    lock.lock()
    defer { lock.unlock() }
    var state = readState()
    change(&state)
    if let data = try? JSONSerialization.data(withJSONObject: state) {
      try? SecureFiles.writeAtomic(stateFile, Array(data))
    }
  }
}
