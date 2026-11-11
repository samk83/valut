import AVFoundation
import ExpoModulesCore
import ImageIO
import Photos
import os
import UIKit
import UniformTypeIdentifiers

/// Bridges the Swift vault core (ios/Core) to the React Native UI: the iPhone/iPad twin of
/// android/.../VaultCoreModule.kt, with the same JS functions and result shapes.
///
/// Every async call runs on one serial queue, so a PIN check never races an import or a lock.
public final class VaultCoreModule: Module {
  private let queue = DispatchQueue(label: "com.jellydock.privatevault.vaultcore", qos: .userInitiated)
  private let hardwareKey = IOSHardwareKey()
  private let stateLock = NSLock()
  private var _vault: Vault?
  private var _inbox: PendingImports?
  // Read from the JS thread (lock) and the work queue, so access is guarded.
  private var vault: Vault? {
    get { stateLock.lock(); defer { stateLock.unlock() }; return _vault }
    set { stateLock.lock(); _vault = newValue; stateLock.unlock() }
  }
  private var inbox: PendingImports? {
    get { stateLock.lock(); defer { stateLock.unlock() }; return _inbox }
    set { stateLock.lock(); _inbox = newValue; stateLock.unlock() }
  }
  private var playbackTicket = 0
  // Set in OnCreate, before any function can be called.
  private var transfer: TransferBridge!
  private let ticketLock = NSLock()

  private static let thumbPx: CGFloat = 360

  private var support: URL {
    FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("PrivateVault")
  }
  private var root: URL { support.appendingPathComponent("vault") }
  private var pendingDir: URL { support.appendingPathComponent("pending") }
  private var playDir: URL { support.appendingPathComponent("play") }
  private var assetTmpDir: URL { support.appendingPathComponent("asset-import") }
  private var caches: URL { FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0] }

  public func definition() -> ModuleDefinition {
    Name("VaultCore")

    Events("onTransfer")

    OnCreate {
      self.transfer = TransferBridge(vault: { [unowned self] in try self.requireVault() }) { [weak self] event in
        self?.sendEvent("onTransfer", event)
      }
      self.queue.sync { self.setUp() }
    }

    AsyncFunction("status") { () -> [String: Any] in
      let v = try self.requireVault()
      return [
        "exists": v.exists(),
        "unlocked": v.isUnlocked,
        "remainingAttempts": v.remainingAttempts(),
        "hardware": self.hardwareKey.describeExisting(),
        // The Android field name is kept; on iPhone it reports the Secure Enclave.
        "strongBoxAvailable": IOSHardwareKey.secureEnclaveAvailable,
      ]
    }.runOnQueue(queue)

    Function("checkPin") { (pin: String) -> [String: Any] in
      var bytes = Array(pin.utf8)
      defer { bytes.wipe() }
      let rejection: Any = PinPolicy.check(bytes)?.rawValue ?? NSNull()
      return ["rejection": rejection, "strength": PinPolicy.strength(length: bytes.count).rawValue]
    }

    AsyncFunction("create") { (pin: String) -> [String: Any] in
      let v = try self.requireVault()
      return self.withPin(pin) { bytes in
        do {
          try v.create(pin: bytes)
          return ["ok": true]
        } catch VaultError.weakPin(let reason) {
          return ["ok": false, "error": "WEAK_PIN", "reason": reason.rawValue]
        } catch VaultError.state {
          // A vault exists, or the app went to the background while sealing the new one.
          return ["ok": false, "error": v.exists() ? "INTERRUPTED" : "EXISTS"]
        } catch {
          return ["ok": false, "error": "FAILED"]
        }
      }
    }.runOnQueue(queue)

    AsyncFunction("unlock") { (pin: String) -> [String: Any] in
      let v = try self.requireVault()
      return self.withPin(pin) { bytes in
        // Check memory before the core records the attempt (SPEC AC-50g).
        if !self.enoughMemoryForPinCheck(v) { return ["ok": false, "error": "OUT_OF_MEMORY"] }
        do {
          try v.unlock(pin: bytes)
          return ["ok": true]
        } catch let e as VaultError {
          switch e {
          case .wrongPin(let remaining): return ["ok": false, "error": "WRONG_PIN", "remaining": remaining]
          case .destroyed:
            self.clearPlayback()
            self.destroyWaitingCaptures()
            return ["ok": false, "error": "DESTROYED"]
          case .incompleteEntry: return ["ok": false, "error": "INCOMPLETE"]
          case .keysUnavailable: return ["ok": false, "error": "KEYS_UNAVAILABLE"]
          case .state: return ["ok": false, "error": "INTERRUPTED"]
          default: return ["ok": false, "error": "FAILED"]
          }
        } catch {
          return ["ok": false, "error": "FAILED"]
        }
      }
    }.runOnQueue(queue)

    // Synchronous on purpose: the key is dropped the moment the app leaves the screen.
    Function("lock") {
      self.transfer.cancel()
      self.vault?.lock()
      self.clearPlayback()
      self.queue.async { self.clearPickerCaches() }
    }

    AsyncFunction("recoverPending") { () -> [String: Int] in
      try self.recoverPendingLocked()
    }.runOnQueue(queue)

    AsyncFunction("importCapture") { (uri: String, kind: String) -> [String: Any] in
      let v = try self.requireVault()
      guard let source = URL(string: uri), source.isFileURL, let itemKind = ItemKind(rawValue: kind), let inbox = self.inbox else {
        throw Exception(name: "E_OPEN", description: "Bad capture uri")
      }
      do {
        // If even the move fails, the file stays in the camera cache and is collected later.
        let mime = self.mimeForCapture(source, itemKind)
        // Thumbnail first, while the file still has its real extension (.mov/.jpg).
        let thumb = self.makeThumbnail(source, itemKind)
        let held = try inbox.stash(source, kind: itemKind)
        let r = try inbox.importOne(vault: v, file: held, mimeType: mime, thumbnail: thumb)
        return ["saved": r.safeToDeleteOriginal, "waiting": inbox.pending().count]
      } catch {
        return ["saved": false, "waiting": inbox.pending().count]
      }
    }.runOnQueue(queue)

    /// Before an original is deleted from Photos, re-reads it and compares it with the
    /// decrypted vault copy. Only an exact match may be deleted (SPEC AC-50e).
    AsyncFunction("matchesOriginal") { (id: String, assetId: String, kind: String) -> Bool in
      let v = try self.requireVault()
      guard let itemKind = ItemKind(rawValue: kind), let resource = self.originalResource(assetId, itemKind, requireSingle: true) else { return false }
      guard let originalSha = self.sha256(of: resource) else { return false }
      let sink = DigestSink()
      try v.read(id: id, output: sink)
      return Primitives.equal(originalSha, sink.hasher.finish())
    }.runOnQueue(queue)

    AsyncFunction("list") { () -> [[String: Any]] in
      try self.requireVault().list().map { item in
        [
          "id": item.id,
          "kind": item.meta.kind.rawValue,
          "mimeType": item.meta.mimeType,
          "createdAt": Double(item.meta.createdAtEpochMs),
          "size": Double(item.meta.sizeBytes),
        ]
      }
    }.runOnQueue(queue)

    AsyncFunction("thumbnail") { (id: String) -> String? in
      try self.requireVault().thumbnail(id: id).map { Data($0).base64EncodedString() }
    }.runOnQueue(queue)

    AsyncFunction("readPhoto") { (id: String) -> String in
      let sink = MemorySink()
      try self.requireVault().read(id: id, output: sink)
      defer { sink.bytes.wipe() }
      return Data(sink.bytes).base64EncodedString()
    }.runOnQueue(queue)

    /// Imports a file:// copy made by the picker or camera. The SHA-256 is computed in a
    /// first, separate read. [deleteSourceFile] removes our own cache copy afterwards.
    AsyncFunction("importUri") { (uri: String, kind: String, mimeType: String, deleteSourceFile: Bool) -> [String: Any] in
      let v = try self.requireVault()
      guard let url = URL(string: uri), url.isFileURL, let itemKind = ItemKind(rawValue: kind) else {
        throw Exception(name: "E_OPEN", description: "Cannot open \(uri)")
      }
      defer { if deleteSourceFile { self.deleteIfOurCache(url) } }
      let sha = try VaultCoreKitSha(url)
      let thumb = self.makeThumbnail(url, itemKind)
      let r = try v.importItem(content: FileSource(url), meta: ItemMeta(kind: itemKind, mimeType: mimeType, createdAtEpochMs: self.nowMs()),
                               thumbnail: thumb, expectedSha256: sha)
      return ["id": r.item.id, "safeToDeleteOriginal": r.safeToDeleteOriginal]
    }.runOnQueue(queue)

    /// iPhone only: imports the exact original bytes of a Photos asset (HEIC, MOV...), so
    /// matchesOriginal can later confirm it and the original may be deleted. The picker's
    /// own copy ([cacheUri]) is removed afterwards. Throws E_NO_ASSET when the asset cannot
    /// be read (no Photos access); the app then falls back to importUri.
    AsyncFunction("importAsset") { (assetId: String, kind: String, cacheUri: String?) -> [String: Any] in
      let v = try self.requireVault()
      guard let itemKind = ItemKind(rawValue: kind), let resource = self.originalResource(assetId, itemKind) else {
        throw Exception(name: "E_NO_ASSET", description: "Photo library item not available")
      }
      try SecureFiles.mkdirs(self.assetTmpDir)
      self.excludeFromBackup(self.assetTmpDir)
      let tmp = self.assetTmpDir.appendingPathComponent(UUID().uuidString)
      defer { SecureFiles.shred(tmp) }
      try self.writeResource(resource, to: tmp)
      let sha = try VaultCoreKitSha(tmp)
      let thumb = self.makeThumbnail(tmp, itemKind)
      let created = (PHAsset.fetchAssets(withLocalIdentifiers: [assetId], options: nil).firstObject?.creationDate).map { Int64($0.timeIntervalSince1970 * 1000) } ?? self.nowMs()
      let mime = UTType(resource.uniformTypeIdentifier)?.preferredMIMEType ?? (itemKind == .VIDEO ? "video/quicktime" : "image/jpeg")
      let r = try v.importItem(content: FileSource(tmp), meta: ItemMeta(kind: itemKind, mimeType: mime, createdAtEpochMs: created),
                               thumbnail: thumb, expectedSha256: sha)
      if let c = cacheUri, let url = URL(string: c), url.isFileURL { self.deleteIfOurCache(url) }
      return ["id": r.item.id, "safeToDeleteOriginal": r.safeToDeleteOriginal]
    }.runOnQueue(queue)

    /// Decrypts a video to a private temp file for the player. Deleted on close and on lock.
    AsyncFunction("openVideo") { (id: String) -> String in
      let v = try self.requireVault()
      self.clearPlayback()
      let ticket = self.currentTicket()
      try SecureFiles.mkdirs(self.playDir)
      self.excludeFromBackup(self.playDir)
      let mime = (try? v.list().first(where: { $0.id == id })?.meta.mimeType) ?? nil
      let ext = mime == "video/quicktime" ? "mov" : "mp4"
      let file = self.playDir.appendingPathComponent("\(UUID().uuidString).\(ext)")
      do {
        let sink = try FileSink(file)
        try v.read(id: id, output: sink)
      } catch {
        SecureFiles.deleteTree(file)
        throw error
      }
      if self.currentTicket() != ticket {
        SecureFiles.deleteTree(file)
        throw Exception(name: "E_CLOSED", description: "Playback was closed")
      }
      return file.absoluteString
    }.runOnQueue(queue)

    Function("closeVideo") { self.clearPlayback() }

    // 1.1 new-phone transfer. Same functions and events as the Android module.
    AsyncFunction("transferReceive") { () -> String in
      do {
        return try self.transfer.startReceiving()
      } catch let f as TransferFailure {
        let code = f.error == .locked ? "E_LOCKED" : "E_NO_WIFI"
        throw Exception(name: code, description: "\(code): \(f.message)")
      }
    }.runOnQueue(queue)

    AsyncFunction("transferSend") { (code: String) in
      do {
        try self.transfer.startSending(code)
      } catch let f as TransferFailure {
        let code = f.error == .locked ? "E_LOCKED" : f.error == .connection ? "E_OTHER_NETWORK" : "E_BAD_CODE"
        throw Exception(name: code, description: "\(code): \(f.message)")
      }
    }.runOnQueue(queue)

    Function("transferCancel") { self.transfer.cancel() }

    AsyncFunction("delete") { (id: String) in
      try self.requireVault().delete(id: id)
    }.runOnQueue(queue)

    AsyncFunction("destroy") { () -> Void in
      self.transfer.cancel()
      try self.requireVault().destroy()
      self.destroyWaitingCaptures()
      self.clearPlayback()
    }.runOnQueue(queue)
  }

  // MARK: - Setup

  private func setUp() {
    do {
      try SecureFiles.mkdirs(support)
      // Keep the whole folder out of iCloud and computer backups (SPEC AC-21) and lock it
      // with the strongest file protection: unreadable while the phone is locked.
      excludeFromBackup(support)
      try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: support.path)
      let v = try Vault(root: root, hardwareKey: hardwareKey, params: .phone)
      let box = PendingImports(dir: pendingDir)
      // The app container is deleted on uninstall but the Keychain is not: if the marker
      // is missing this is a fresh install, so leftovers are wiped (SPEC AC-20).
      let marker = support.appendingPathComponent("installed.marker")
      if !SecureFiles.exists(marker) {
        try v.wipeLeftoversForFreshInstall()
        box.clear()
        try SecureFiles.writeAtomic(marker, Array("1".utf8))
      }
      vault = v
      inbox = box
      clearPlayback()
      clearPickerCaches()
      collectStrayCaptures(minAge: 0)
    } catch {
      vault = nil
    }
  }

  private func requireVault() throws -> Vault {
    if vault == nil { setUp() }
    guard let v = vault else { throw Exception(name: "E_VAULT", description: "The vault could not be opened") }
    return v
  }

  // MARK: - Helpers

  private func withPin<T>(_ pin: String, _ block: ([UInt8]) -> T) -> T {
    var bytes = Array(pin.utf8)
    defer { bytes.wipe() }
    return block(bytes)
  }

  private func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

  private func excludeFromBackup(_ url: URL) {
    var u = url
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? u.setResourceValues(values)
  }

  private func currentTicket() -> Int {
    ticketLock.lock()
    defer { ticketLock.unlock() }
    return playbackTicket
  }

  private func clearPlayback() {
    ticketLock.lock()
    playbackTicket += 1
    ticketLock.unlock()
    for f in SecureFiles.list(playDir) { SecureFiles.deleteTree(f) }
  }

  /// Picker output is only a copy of a Photos item that still exists, so it is safe to
  /// delete. Camera output is NOT deleted here: it may be the only copy.
  private func clearPickerCaches() {
    SecureFiles.deleteTree(caches.appendingPathComponent("ImagePicker"))
    for f in SecureFiles.list(assetTmpDir) { SecureFiles.shred(f) }
  }

  /// Deletes [url] only when it is a plaintext copy inside our own caches folder.
  private func deleteIfOurCache(_ url: URL) {
    let path = url.standardizedFileURL.resolvingSymlinksInPath().path
    let cachePath = caches.standardizedFileURL.resolvingSymlinksInPath().path
    if path.hasPrefix(cachePath + "/") { SecureFiles.deleteTree(url) }
  }

  private func recoverPendingLocked() throws -> [String: Int] {
    let v = try requireVault()
    guard let inbox = inbox else { return ["saved": 0, "waiting": 0] }
    // Skip a capture the camera may still be writing (a video being recorded).
    collectStrayCaptures(minAge: 10)
    var saved = 0
    for file in inbox.pending() {
      guard let kind = inbox.kindOf(file) else { continue }
      let thumb = makeThumbnail(file, kind)
      if (try? inbox.importOne(vault: v, file: file, mimeType: kind == .VIDEO ? "video/quicktime" : "image/jpeg", thumbnail: thumb))?.safeToDeleteOriginal == true {
        saved += 1
      }
    }
    return ["saved": saved, "waiting": inbox.pending().count]
  }

  /// Captures left in expo-camera's cache folder by a crash before they reached the inbox.
  private func collectStrayCaptures(minAge: TimeInterval) {
    guard let inbox = inbox else { return }
    let cutoff = Date().addingTimeInterval(-minAge)
    for f in SecureFiles.list(caches.appendingPathComponent("Camera")) where !SecureFiles.isDirectory(f) {
      let size = ((try? FileManager.default.attributesOfItem(atPath: f.path)[.size]) as? NSNumber)?.intValue ?? 0
      guard size > 0, SecureFiles.modifiedAt(f) <= cutoff else { continue }
      let kind: ItemKind = ["mov", "mp4"].contains(f.pathExtension.lowercased()) ? .VIDEO : .PHOTO
      _ = try? inbox.stash(f, kind: kind)
    }
  }

  /// Only after a destruction (3 wrong PINs or reset): captures must not reach a new vault.
  private func destroyWaitingCaptures() {
    inbox?.clear()
    SecureFiles.deleteTree(caches.appendingPathComponent("Camera"))
  }

  private func mimeForCapture(_ source: URL, _ kind: ItemKind) -> String {
    switch source.pathExtension.lowercased() {
    case "mov": return "video/quicktime"
    case "mp4": return "video/mp4"
    case "png": return "image/png"
    case "heic": return "image/heic"
    default: return kind == .VIDEO ? "video/quicktime" : "image/jpeg"
    }
  }

  /// Checked BEFORE the attempt is counted: an iPhone app that runs out of memory is killed
  /// with the attempt already used. Uses the largest setting any stored envelope asks for.
  private func enoughMemoryForPinCheck(_ v: Vault) -> Bool {
    let available = os_proc_available_memory()
    // 0 means "no limit known" (simulator, iPad app on a Mac): nothing to check.
    if available == 0 { return true }
    return available >= v.memoryNeededForUnlockKiB() * 1024 * 3 / 2
  }

  // MARK: - Photos originals

  /// The asset's original photo or video file. With [requireSingle] (before deleting it),
  /// only assets made of that one file qualify: a Live Photo's video, an edit or a RAW pair
  /// would be deleted along with it but is not in the vault, so such assets are kept.
  private func originalResource(_ assetId: String, _ kind: ItemKind, requireSingle: Bool = false) -> PHAssetResource? {
    let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    guard status == .authorized || status == .limited else { return nil }
    guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [assetId], options: nil).firstObject else { return nil }
    let resources = PHAssetResource.assetResources(for: asset)
    if requireSingle && resources.count != 1 { return nil }
    return resources.first(where: { $0.type == (kind == .VIDEO ? .video : .photo) })
  }

  private func writeResource(_ resource: PHAssetResource, to url: URL) throws {
    let options = PHAssetResourceRequestOptions()
    // Offline app: originals stored only in iCloud are not downloaded; the picker copy is
    // imported instead (and that original is then kept, not deleted).
    options.isNetworkAccessAllowed = false
    let done = DispatchSemaphore(value: 0)
    var failure: Error?
    PHAssetResourceManager.default().writeData(for: resource, toFile: url, options: options) { error in
      failure = error
      done.signal()
    }
    if done.wait(timeout: .now() + 120) == .timedOut { throw Exception(name: "E_NO_ASSET", description: "Photos did not answer") }
    if let e = failure { throw Exception(name: "E_NO_ASSET", description: e.localizedDescription) }
  }

  private func sha256(of resource: PHAssetResource) -> [UInt8]? {
    let options = PHAssetResourceRequestOptions()
    options.isNetworkAccessAllowed = false
    let hasher = Sha256()
    let done = DispatchSemaphore(value: 0)
    var ok = false
    PHAssetResourceManager.default().requestData(for: resource, options: options, dataReceivedHandler: { data in
      hasher.update([UInt8](data))
    }, completionHandler: { error in
      ok = error == nil
      done.signal()
    })
    // Never block the vault queue for long; a timeout just keeps the original.
    if done.wait(timeout: .now() + 120) == .timedOut { return nil }
    return ok ? hasher.finish() : nil
  }

  // MARK: - Thumbnails

  private func makeThumbnail(_ url: URL, _ kind: ItemKind) -> [UInt8]? {
    let image: CGImage?
    switch kind {
    case .PHOTO:
      guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
      let opts: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true, // applies the EXIF orientation
        kCGImageSourceThumbnailMaxPixelSize: Self.thumbPx,
        kCGImageSourceShouldCacheImmediately: true,
      ]
      image = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary)
    case .VIDEO:
      // AVFoundation picks the reader by file extension; the inbox names files ".video".
      var playable = url
      var link: URL?
      if !["mov", "mp4", "m4v"].contains(url.pathExtension.lowercased()) {
        let l = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).mov")
        if (try? FileManager.default.createSymbolicLink(at: l, withDestinationURL: url)) != nil {
          playable = l
          link = l
        }
      }
      defer { if let l = link { try? FileManager.default.removeItem(at: l) } }
      let asset = AVURLAsset(url: playable)
      let gen = AVAssetImageGenerator(asset: asset)
      gen.appliesPreferredTrackTransform = true
      gen.maximumSize = CGSize(width: Self.thumbPx, height: Self.thumbPx)
      image = try? gen.copyCGImage(at: .zero, actualTime: nil)
    }
    guard let cg = image, let jpeg = UIImage(cgImage: cg).jpegData(compressionQuality: 0.8) else { return nil }
    return [UInt8](jpeg)
  }
}

/// SHA-256 of a whole file (thin wrapper so the module reads like the Kotlin one).
private func VaultCoreKitSha(_ url: URL) throws -> [UInt8] { try sha256(of: url) }
