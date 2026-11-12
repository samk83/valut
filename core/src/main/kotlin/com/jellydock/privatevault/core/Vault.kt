package com.jellydock.privatevault.core

import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest

enum class ItemKind { PHOTO, VIDEO }

/** Item details. Stored only in encrypted form (SPEC AC-11). */
data class ItemMeta(
    val kind: ItemKind,
    val mimeType: String,
    val createdAtEpochMs: Long,
    val sizeBytes: Long = 0,
)

data class VaultItem(val id: String, val meta: ItemMeta)

/**
 * Result of an import. [safeToDeleteOriginal] is true only when the encrypted copy was
 * written, re-read, decrypted and matched against the SHA-256 the caller computed from the
 * original by itself. Only then may the app ask the OS to delete the original (SPEC AC-30).
 */
data class ImportResult(val item: VaultItem, val safeToDeleteOriginal: Boolean)

/**
 * The vault on disk. Layout under [root]:
 *   vault.key            key envelope (see [VaultKeyManager])
 *   attempts             failed-attempt counter
 *   items/<id>/key       file key wrapped with the master key
 *   items/<id>/meta      encrypted [ItemMeta]
 *   items/<id>/data      encrypted content ([ChunkedCipher])
 *   items/<id>/thumb     encrypted thumbnail (optional)
 *   staging/<id>/        imports in progress; never listed, cleared on start
 *   recovery.key(.bak)   backup recovery key sealed with the master key ([Backup.kt])
 *   backup.deletes       ids the user deleted, still to be removed from the backup folder
 *   recovery.confirmed   present once the user confirmed they saved the recovery key
 */
class Vault(
    private val root: File,
    hardwareKey: HardwareKey,
    params: Argon2Params = Argon2Params.DEFAULT,
    private val chunkSize: Int = ChunkedCipher.DEFAULT_CHUNK_SIZE,
    clock: MonotonicClock = SystemMonotonicClock,
) {
    private val items = File(root, "items")
    private val staging = File(root, "staging")
    private val keys = VaultKeyManager(File(root, "vault.key"), FileAttemptCounter(File(root, "attempts")), hardwareKey, params, clock)

    @Volatile
    private var masterKey: ByteArray? = null

    // Bumped by every lock(). An unlock that finishes after a lock() that happened while its
    // PIN check was running is discarded, so backgrounding during the check keeps it locked.
    private var lockGeneration = 0L

    init {
        // An interrupted import leaves only ciphertext in staging; discard it (PRD 14).
        SecureFiles.deleteTree(staging)
        keys.sweepTempFiles()
        // Finish only deletes the user started (marked by a tombstone). Folders without a key
        // are hidden but never removed here: a missing file may be a passing storage error,
        // and only the user (one item, or a full reset) may remove anything (SPEC AC-50).
        items.listFiles { f -> f.isDirectory && isValidId(f.name) && File(f, DELETED).exists() }
            ?.forEach { SecureFiles.deleteTree(it) }
    }

    val isUnlocked: Boolean get() = masterKey != null

    fun exists(): Boolean = keys.exists()

    fun remainingAttempts(): Int = keys.remainingAttempts()

    /** How long until the next PIN attempt is allowed (0 = now). */
    fun lockedForMs(): Long = keys.lockedForMs()

    /**
     * See [VaultKeyManager.wipeLeftoversForFreshInstall]: removes security chip keys left by
     * an earlier install. Uninstalling deletes this folder, so if vault files are still here
     * this is NOT a fresh install (only the install marker went missing): then nothing is
     * touched and false is returned. A working vault is never wiped on a guess.
     */
    fun wipeLeftoversForFreshInstall(): Boolean {
        if (keys.hasKeyFiles() || items.listFiles()?.isNotEmpty() == true) return false
        lock()
        keys.wipeLeftoversForFreshInstall()
        SecureFiles.deleteTree(items)
        return true
    }

    fun create(pin: CharArray) {
        root.mkdirs()
        // Fails without touching anything if a vault already exists or the PIN is weak.
        val generation = currentGeneration()
        val mk = keys.create(pin)
        // Only now is it safe to clear leftover ciphertext of a destroyed vault.
        SecureFiles.deleteTree(items)
        // A recovery key left by a destroyed vault was sealed with its old master key.
        clearBackupState()
        setMasterKey(mk, generation)
    }

    /**
     * Unlocks the vault. If [lock] is called while the PIN is being checked (the app went to
     * the background), the result is thrown away and [VaultStateException] is thrown.
     */
    fun unlock(pin: CharArray) {
        lock()
        val generation = currentGeneration()
        setMasterKey(keys.unlock(pin), generation)
    }

    fun changePin(
        currentPin: CharArray,
        newPin: CharArray,
    ) = keys.changePin(currentPin, newPin)

    /** Drops the master key from memory. Call when the app leaves the screen (SPEC AC-07). */
    @Synchronized
    fun lock() {
        lockGeneration++
        masterKey?.wipe()
        masterKey = null
    }

    /**
     * Imports one photo or video. [expectedSha256] must be computed by the caller from the
     * original in a separate read; without it the import works but the original is never
     * reported as safe to delete.
     */
    fun importItem(
        content: InputStream,
        meta: ItemMeta,
        thumbnail: ByteArray? = null,
        expectedSha256: ByteArray? = null,
        receivedFrom: String? = null,
    ): ImportResult {
        val sourceBytes = receivedFrom?.let { parseId(it) }
        val mk = requireUnlocked()
        val idBytes = Aead.randomBytes(16)
        val id = idBytes.joinToString("") { "%02x".format(it) }
        val stage = File(staging, id).apply { mkdirs() }
        val fileKey = Aead.randomBytes(Aead.KEY_BYTES)
        try {
            val dataFile = File(stage, "data")
            val written =
                FileOutputStream(dataFile).use { out ->
                    ChunkedCipher.encrypt(content, out, fileKey, idBytes, chunkSize).also { out.fd.sync() }
                }
            // Verify by decrypting what is actually on disk.
            val check = FileInputStream(dataFile).use { ChunkedCipher.decrypt(it, NullOutput, fileKey, idBytes) }
            if (!MessageDigest.isEqual(check, written.sha256) ||
                (expectedSha256 != null && !MessageDigest.isEqual(expectedSha256, written.sha256))
            ) {
                throw ImportVerificationException("Encrypted copy does not match the original")
            }
            val finalMeta = meta.copy(sizeBytes = written.plaintextBytes)
            val sealedMeta = Aead.seal(fileKey, encodeMeta(finalMeta), aad("meta", idBytes))
            val sealedKey = Aead.seal(mk, fileKey, aad("key", idBytes))
            // Key and metadata are tiny but losing either loses the item, so each has a
            // second copy (SPEC AC-50).
            SecureFiles.writeAtomic(File(stage, "meta"), sealedMeta)
            SecureFiles.writeAtomic(File(stage, "meta.bak"), sealedMeta)
            thumbnail?.let { SecureFiles.writeAtomic(File(stage, "thumb"), Aead.seal(fileKey, it, aad("thumb", idBytes))) }
            // Where a transferred item came from, published together with the item itself,
            // so "already received" can never disagree with what is really here.
            sourceBytes?.let { SecureFiles.writeAtomic(File(stage, SOURCE), Aead.seal(fileKey, it, aad(SOURCE, idBytes))) }
            SecureFiles.writeAtomic(File(stage, "key.bak"), sealedKey)
            // The wrapped key is written last: an item without it can never be opened.
            SecureFiles.writeAtomic(File(stage, "key"), sealedKey)
            SecureFiles.syncDir(stage)
            // Publish only if this master key is still the vault's key. Another object may
            // have destroyed or recreated the vault; then the original must be kept.
            keys.whileKeyIsLive(mk) {
                items.mkdirs()
                SecureFiles.moveAtomic(stage, File(items, id))
            }
            return ImportResult(VaultItem(id, finalMeta), safeToDeleteOriginal = expectedSha256 != null)
        } catch (e: IntegrityException) {
            SecureFiles.deleteTree(stage)
            throw ImportVerificationException("Verification failed: ${e.message}")
        } catch (e: Exception) {
            SecureFiles.deleteTree(stage)
            throw e
        } finally {
            fileKey.wipe()
            mk.wipe()
        }
    }

    fun list(): List<VaultItem> {
        requireUnlocked().wipe()
        val dirs = items.listFiles { f -> isLiveItem(f) } ?: return emptyList()
        return dirs.mapNotNull { dir ->
            try {
                withFileKey(dir.name) { fk, idBytes ->
                    VaultItem(dir.name, decodeMeta(openEither(dir, "meta") { Aead.open(fk, it, aad("meta", idBytes)) }))
                }
            } catch (e: IntegrityException) {
                null // Damaged items are hidden and blocked, never shown half-decrypted (PRD 10.2).
            } catch (e: IOException) {
                null // Missing or unreadable metadata file: same treatment.
            } catch (e: IllegalArgumentException) {
                null // Unknown item kind in metadata.
            }
        }.sortedByDescending { it.meta.createdAtEpochMs }
    }

    /** Streams the decrypted content into [output] (memory or a player buffer, never a file). */
    fun read(
        id: String,
        output: OutputStream,
    ) {
        withFileKey(id) { fk, idBytes ->
            FileInputStream(File(itemDir(id), "data")).use { ChunkedCipher.decrypt(it, output, fk, idBytes) }
        }
    }

    fun thumbnail(id: String): ByteArray? =
        withFileKey(id) { fk, idBytes ->
            val file = File(itemDir(id), "thumb")
            if (file.exists()) Aead.open(fk, file.readBytes(), aad("thumb", idBytes)) else null
        }

    /** Decrypts a single chunk, for seeking in videos. */
    fun readChunk(
        id: String,
        index: Int,
    ): ByteArray =
        withFileKey(id) { fk, idBytes ->
            ChunkedCipher.Reader(File(itemDir(id), "data"), fk, idBytes).use { it.readChunk(index) }
        }

    /**
     * Ids (on the old phone) of items this vault received by transfer, so an interrupted
     * transfer can be run again without duplicates. Read from each item's sealed "source"
     * file. An item the user deleted here is no longer counted and would be sent again.
     */
    fun receivedSources(): Set<String> {
        requireUnlocked().wipe()
        val dirs = items.listFiles { f -> isLiveItem(f) && File(f, SOURCE).exists() } ?: return emptySet()
        return dirs.mapNotNull { dir ->
            try {
                withFileKey(dir.name) { fk, idBytes -> Aead.open(fk, File(dir, SOURCE).readBytes(), aad(SOURCE, idBytes)).toHex() }
            } catch (e: IntegrityException) {
                null // Worst case that item is sent again; nothing is lost.
            } catch (e: IOException) {
                null
            }
        }.toSet()
    }

    /** Permanent deletion: the wrapped file key goes first, then the ciphertext (PRD 9.2). */
    fun delete(id: String) {
        requireUnlocked().wipe()
        val dir = itemDir(id)
        if (!dir.exists()) return
        // The tombstone makes an interrupted delete finish on the next start, instead of
        // leaving a half-deleted item that looks like damage.
        SecureFiles.writeAtomic(File(dir, DELETED), ByteArray(0))
        SecureFiles.shred(File(dir, "key"))
        SecureFiles.shred(File(dir, "key.bak"))
        SecureFiles.shred(File(dir, "meta"))
        SecureFiles.shred(File(dir, "meta.bak"))
        SecureFiles.shred(File(dir, "thumb"))
        SecureFiles.shred(File(dir, SOURCE))
        SecureFiles.deleteTree(dir)
        // The user deleted it, so the next backup removes its copy too. Only ids listed here
        // are ever removed from a backup: an item hidden by damage keeps its backup copy.
        runCatching { synchronized(deletesLock) { deletesFile.appendText("$id\n") } }
    }

    /** Destroys the whole vault: master key first, then every file (PRD 9.3). */
    fun destroy() {
        lock()
        keys.destroy()
        SecureFiles.deleteTree(items)
        SecureFiles.deleteTree(staging)
        // Backup files in the user's folder are left alone: they are the user's copy.
        clearBackupState()
    }

    // --- Backup (owner decision 2026-11-12: photos must survive deleting the app) ---

    private val recoveryFile = File(root, "recovery.key")
    private val deletesFile = File(root, "backup.deletes")
    private val backupLock = Any()

    // Separate from [backupLock] so deleting a photo never waits for a long backup.
    private val deletesLock = Any()

    /** True when a recovery key is set up. Works while locked. */
    fun hasRecoveryKey(): Boolean = recoveryFile.exists() || File(root, "recovery.key.bak").exists()

    /** The recovery key, for showing it again. Needs the vault unlocked. */
    fun recoveryKey(): ByteArray? {
        val mk = requireUnlocked()
        try {
            if (!hasRecoveryKey()) return null
            return openEither(root, "recovery.key") { Aead.open(mk, it, RECOVERY_AAD) }
        } finally {
            mk.wipe()
        }
    }

    private val confirmedFile = File(root, "recovery.confirmed")

    /** True once the user proved they saved the recovery key (or restored with it). */
    fun isRecoveryKeyConfirmed(): Boolean = hasRecoveryKey() && confirmedFile.exists()

    /** Records that the user saved the recovery key. Until then the app keeps asking. */
    fun confirmRecoveryKey() {
        if (!hasRecoveryKey()) throw NoRecoveryKeyException()
        SecureFiles.writeAtomic(confirmedFile, ByteArray(0))
    }

    /** Returns the recovery key, creating it the first time. Needs the vault unlocked. */
    @Synchronized
    fun createRecoveryKey(): ByteArray {
        recoveryKey()?.let { return it }
        val rk = RecoveryKey.generate()
        storeRecoveryKey(rk)
        return rk
    }

    private fun storeRecoveryKey(rk: ByteArray) {
        val mk = requireUnlocked()
        try {
            val sealed = Aead.seal(mk, rk, RECOVERY_AAD)
            SecureFiles.writeAtomic(File(root, "recovery.key.bak"), sealed)
            SecureFiles.writeAtomic(recoveryFile, sealed)
        } finally {
            mk.wipe()
        }
    }

    /**
     * Copies every item not yet in [folder] there and removes the copies of items the user
     * deleted. Safe to run often: items already in the folder are skipped. Stops (throws
     * [VaultStateException]) if the vault is locked meanwhile; the next run continues.
     */
    fun backupTo(folder: BackupFolder): BackupReport =
        synchronized(backupLock) {
            val rk = recoveryKey() ?: throw NoRecoveryKeyException()
            val bk = BackupFormat.backupKey(rk)
            rk.wipe()
            try {
                val names = folder.list()
                if (BackupFormat.INFO in names) {
                    val info = folder.openRead(BackupFormat.INFO).use { it.readBytes() }
                    // Another vault's backup: never mix two vaults in one folder.
                    if (!BackupFormat.opensInfo(info, bk)) throw BackupKeyMismatchException()
                } else {
                    folder.write(BackupFormat.INFO) { it.write(BackupFormat.infoFile(bk)) }
                }
                names.filter { it.endsWith(BackupFormat.PART) }.forEach { runCatching { folder.delete(it) } }
                val present = names.filter { it.endsWith(BackupFormat.EXT) }.map { it.removeSuffix(BackupFormat.EXT) }.toSet()
                var removed = 0
                val deleted =
                    synchronized(
                        deletesLock,
                    ) { if (deletesFile.exists()) deletesFile.readLines().filter { isValidId(it) }.toSet() else emptySet() }
                val handled = HashSet<String>()
                val live = items.listFiles { f -> isLiveItem(f) }?.map { it.name } ?: emptyList()
                val liveSet = live.toSet()
                for (id in deleted) {
                    // Gone from the folder already, or back in the vault (restored): nothing to remove.
                    if (id !in present || id in liveSet) {
                        handled += id
                        continue
                    }
                    try {
                        folder.delete(id + BackupFormat.EXT)
                        removed++
                        handled += id
                    } catch (e: IOException) {
                        // Stays in the log: the next backup tries again.
                    }
                }
                if (handled.isNotEmpty()) forgetDeletes(handled)
                var written = 0
                for (id in live) {
                    // A copy with the wrong size (cut short by a provider) is written again.
                    val replacing = id in present
                    if (replacing && backupCopyLooksComplete(id, folder.size(id + BackupFormat.EXT))) continue
                    if (writeBackupItem(id, bk, folder, replacing)) written++
                }
                BackupReport(written, removed, live.size)
            } finally {
                bk.wipe()
            }
        }

    /** Removes [ids] from the delete log, keeping any added meanwhile. */
    private fun forgetDeletes(ids: Set<String>) =
        synchronized(deletesLock) {
            val left = if (deletesFile.exists()) deletesFile.readLines().filter { isValidId(it) && it !in ids } else emptyList()
            if (left.isEmpty()) {
                deletesFile.delete()
            } else {
                SecureFiles.writeAtomic(deletesFile, left.joinToString("") { "$it\n" }.toByteArray(Charsets.US_ASCII))
            }
        }

    /** False if [size] (-1 = unknown) can't be a complete copy of item [id]. */
    private fun backupCopyLooksComplete(
        id: String,
        size: Long,
    ): Boolean {
        if (size < 0) return true
        val dir = itemDir(id)
        val data = File(dir, "data").length()
        val metas = listOf(File(dir, "meta"), File(dir, "meta.bak")).filter { it.isFile }.map { it.length() }
        val thumbs = listOfNotNull(0L, File(dir, "thumb").takeIf { it.isFile }?.length())
        return metas.any { m -> thumbs.any { t -> size == BackupFormat.headerSize(m, t) + data } }
    }

    private fun writeBackupItem(
        id: String,
        bk: ByteArray,
        folder: BackupFolder,
        replacing: Boolean = false,
    ): Boolean {
        val dir = itemDir(id)
        val header =
            try {
                withFileKey(id) { fk, idBytes ->
                    val meta =
                        openEither(dir, "meta") { sealed ->
                            Aead.open(fk, sealed, aad("meta", idBytes))
                            sealed
                        }
                    // A damaged thumbnail is left out rather than making the photo unrestorable.
                    val thumbFile = File(dir, "thumb")
                    val thumb =
                        if (!thumbFile.exists()) {
                            null
                        } else {
                            runCatching { thumbFile.readBytes().also { Aead.open(fk, it, aad("thumb", idBytes)) } }.getOrNull()
                        }
                    // Replacing a copy: the phone's own file may be the damaged one, so it must
                    // decrypt completely before it may overwrite what may be the last good copy.
                    if (replacing) FileInputStream(File(dir, "data")).use { ChunkedCipher.decrypt(it, NullOutput, fk, idBytes) }
                    BackupFormat.itemHeader(idBytes, BackupFormat.wrapKey(bk, fk, idBytes), meta, thumb)
                }
            } catch (e: IntegrityException) {
                return false // A damaged item can't be backed up; it is never deleted either.
            } catch (e: IOException) {
                return false
            }
        folder.write(id + BackupFormat.EXT) { out ->
            out.write(header)
            FileInputStream(File(dir, "data")).use { it.copyTo(out, 256 * 1024) }
        }
        return true
    }

    /**
     * Restores every item of the backup in [folder] that is not already here, keeping its id,
     * and checks each one completely before it appears. Damaged files are skipped and counted.
     * If this vault has no recovery key yet it adopts [recoveryKey], so later backups go on
     * into the same folder.
     */
    fun restoreFrom(
        folder: BackupFolder,
        recoveryKey: ByteArray,
        progress: (done: Int, total: Int) -> Unit = { _, _ -> },
    ): RestoreReport {
        requireUnlocked().wipe()
        val bk = BackupFormat.backupKey(recoveryKey)
        try {
            checkBackupKey(folder, bk)
            if (!hasRecoveryKey()) {
                storeRecoveryKey(recoveryKey)
                // The user just typed it from their copy, so it is saved somewhere.
                SecureFiles.writeAtomic(confirmedFile, ByteArray(0))
            }
            val names = folder.list().filter { it.endsWith(BackupFormat.EXT) && isValidId(it.removeSuffix(BackupFormat.EXT)) }.sorted()
            var restored = 0
            var already = 0
            var damaged = 0
            names.forEachIndexed { index, name ->
                val id = name.removeSuffix(BackupFormat.EXT)
                val existing = File(items, id)
                if (isLiveItem(existing)) {
                    already++
                } else if (existing.exists()) {
                    // Being deleted by the user (tombstone): leave it to finish, don't count it.
                } else {
                    try {
                        folder.openRead(name).use { restoreItem(id, it, bk) }
                        restored++
                    } catch (e: IntegrityException) {
                        damaged++
                    } catch (e: IOException) {
                        damaged++
                    }
                }
                progress(index + 1, names.size)
            }
            return RestoreReport(restored, already, damaged)
        } finally {
            bk.wipe()
        }
    }

    private fun restoreItem(
        id: String,
        input: InputStream,
        bk: ByteArray,
    ) {
        val idBytes = parseId(id)
        val header = BackupFormat.readItemHeader(input, bk)
        val fk = header.fileKey
        val mk = requireUnlocked()
        val stage = File(staging, id)
        try {
            if (!header.id.contentEquals(idBytes)) throw IntegrityException("Backup item name does not match its content")
            decodeMeta(Aead.open(fk, header.sealedMeta, aad("meta", idBytes)))
            // A thumbnail that does not open is dropped: the photo itself still restores.
            val thumb = header.sealedThumb?.takeIf { runCatching { Aead.open(fk, it, aad("thumb", idBytes)) }.isSuccess }
            SecureFiles.deleteTree(stage)
            stage.mkdirs()
            val dataFile = File(stage, "data")
            FileOutputStream(dataFile).use { out ->
                input.copyTo(out, 256 * 1024)
                out.fd.sync()
            }
            // Every chunk must decrypt before the item appears (truncation or edits fail).
            FileInputStream(dataFile).use { ChunkedCipher.decrypt(it, NullOutput, fk, idBytes) }
            val sealedKey = Aead.seal(mk, fk, aad("key", idBytes))
            SecureFiles.writeAtomic(File(stage, "meta"), header.sealedMeta)
            SecureFiles.writeAtomic(File(stage, "meta.bak"), header.sealedMeta)
            thumb?.let { SecureFiles.writeAtomic(File(stage, "thumb"), it) }
            SecureFiles.writeAtomic(File(stage, "key.bak"), sealedKey)
            SecureFiles.writeAtomic(File(stage, "key"), sealedKey)
            SecureFiles.syncDir(stage)
            keys.whileKeyIsLive(mk) {
                items.mkdirs()
                if (File(items, id).exists()) throw VaultStateException("Item already restored")
                SecureFiles.moveAtomic(stage, File(items, id))
            }
        } catch (e: Exception) {
            SecureFiles.deleteTree(stage)
            throw e
        } finally {
            fk.wipe()
            mk.wipe()
        }
    }

    private fun clearBackupState() {
        File(root, "recovery.confirmed").delete()
        SecureFiles.shred(recoveryFile)
        SecureFiles.shred(File(root, "recovery.key.bak"))
        deletesFile.delete()
    }

    private fun <T> withFileKey(
        id: String,
        block: (ByteArray, ByteArray) -> T,
    ): T {
        val mk = requireUnlocked()
        val idBytes = parseId(id)
        val fk =
            try {
                openEither(itemDir(id), "key") { Aead.open(mk, it, aad("key", idBytes)) }
            } finally {
                mk.wipe()
            }
        try {
            return block(fk, idBytes)
        } finally {
            fk.wipe()
        }
    }

    /**
     * Opens [name] in [dir], falling back to its ".bak" copy when the main file is missing,
     * unreadable or fails authentication. The first error is rethrown if both fail.
     */
    private fun <T> openEither(
        dir: File,
        name: String,
        open: (ByteArray) -> T,
    ): T {
        val first =
            try {
                val bytes = File(dir, name).readBytes()
                val value = open(bytes)
                // Main copy is good: make sure the backup exists and matches (items from the
                // first test build have none, and a damaged backup is replaced).
                val backup = File(dir, "$name.bak")
                runCatching {
                    if (!backup.exists() || !backup.readBytes().contentEquals(bytes)) SecureFiles.writeAtomic(backup, bytes)
                }
                return value
            } catch (e: IntegrityException) {
                e
            } catch (e: IOException) {
                e
            }
        val backup = File(dir, "$name.bak")
        if (!backup.exists()) throw first
        val bytes: ByteArray
        val value =
            try {
                bytes = backup.readBytes()
                open(bytes)
            } catch (e: Exception) {
                first.addSuppressed(e)
                throw first
            }
        // The backup is good: restore the damaged main copy so the item has two again.
        runCatching { SecureFiles.writeAtomic(File(dir, name), bytes) }
        return value
    }

    private fun isLiveItem(f: File) = f.isDirectory && isValidId(f.name) && hasKey(f) && !File(f, DELETED).exists()

    private fun hasKey(dir: File) = File(dir, "key").exists() || File(dir, "key.bak").exists()

    private fun itemDir(id: String): File {
        parseId(id)
        return File(items, id)
    }

    private fun isValidId(id: String) = id.length == 32 && id.all { it in '0'..'9' || it in 'a'..'f' }

    private fun parseId(id: String): ByteArray {
        require(isValidId(id)) { "Invalid item id" }
        return ByteArray(16) { id.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    }

    /**
     * Returns a private copy of the master key; the caller wipes it. A copy is used so that
     * [lock] on another thread cannot zero the key in the middle of an import, which would
     * store an item wrapped under an all-zero key.
     */
    @Synchronized
    private fun requireUnlocked(): ByteArray = masterKey?.copyOf() ?: throw VaultStateException("Vault is locked")

    @Synchronized
    private fun currentGeneration(): Long = lockGeneration

    @Synchronized
    private fun setMasterKey(
        mk: ByteArray,
        generation: Long,
    ) {
        if (generation != lockGeneration) {
            mk.wipe()
            throw VaultStateException("Vault was locked while unlocking")
        }
        masterKey?.wipe()
        masterKey = mk
    }

    private fun aad(
        purpose: String,
        id: ByteArray,
    ): ByteArray = "PrivateVault item $purpose v1".toByteArray(Charsets.US_ASCII) + id

    private fun encodeMeta(meta: ItemMeta): ByteArray {
        val buffer = ByteArrayOutputStream()
        DataOutputStream(buffer).use { out ->
            out.writeByte(1)
            out.writeUTF(meta.kind.name)
            out.writeUTF(meta.mimeType)
            out.writeLong(meta.createdAtEpochMs)
            out.writeLong(meta.sizeBytes)
        }
        return buffer.toByteArray()
    }

    private fun decodeMeta(bytes: ByteArray): ItemMeta =
        DataInputStream(bytes.inputStream()).use { input ->
            if (input.readUnsignedByte() != 1) throw IntegrityException("Unknown metadata version")
            ItemMeta(ItemKind.valueOf(input.readUTF()), input.readUTF(), input.readLong(), input.readLong())
        }

    private object NullOutput : OutputStream() {
        override fun write(b: Int) = Unit

        override fun write(
            b: ByteArray,
            off: Int,
            len: Int,
        ) = Unit
    }

    private fun ByteArray.toHex() = joinToString("") { "%02x".format(it) }

    companion object {
        private const val DELETED = "deleted"
        private const val SOURCE = "source"
        private val RECOVERY_AAD = "PrivateVault recovery key v1".toByteArray(Charsets.US_ASCII)

        /** Throws unless [folder] holds a backup that [recoveryKey] opens. Needs no vault. */
        fun checkBackup(
            folder: BackupFolder,
            recoveryKey: ByteArray,
        ) {
            val bk = BackupFormat.backupKey(recoveryKey)
            try {
                checkBackupKey(folder, bk)
            } finally {
                bk.wipe()
            }
        }

        /** Number of items in the backup in [folder] (no key needed). */
        fun backupItemCount(folder: BackupFolder): Int = folder.list().count { it.endsWith(BackupFormat.EXT) }

        private fun checkBackupKey(
            folder: BackupFolder,
            bk: ByteArray,
        ) {
            if (BackupFormat.INFO !in folder.list()) throw NotABackupException()
            val info = folder.openRead(BackupFormat.INFO).use { it.readBytes() }
            if (!BackupFormat.opensInfo(info, bk)) throw BackupKeyMismatchException()
        }
    }
}
