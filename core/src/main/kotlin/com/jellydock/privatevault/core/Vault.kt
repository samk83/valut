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
 */
class Vault(
    private val root: File,
    hardwareKey: HardwareKey,
    params: Argon2Params = Argon2Params.DEFAULT,
    private val chunkSize: Int = ChunkedCipher.DEFAULT_CHUNK_SIZE,
) {
    private val items = File(root, "items")
    private val staging = File(root, "staging")
    private val keys = VaultKeyManager(File(root, "vault.key"), FileAttemptCounter(File(root, "attempts")), hardwareKey, params)

    @Volatile
    private var masterKey: ByteArray? = null

    init {
        // An interrupted import leaves only ciphertext in staging; discard it (PRD 14).
        SecureFiles.deleteTree(staging)
        keys.sweepTempFiles()
        // An interrupted delete can leave a folder whose key is already gone; it can never
        // be opened again, so finish removing it.
        items.listFiles { f -> f.isDirectory && isValidId(f.name) && !File(f, "key").exists() }
            ?.forEach { SecureFiles.deleteTree(it) }
    }

    val isUnlocked: Boolean get() = masterKey != null

    fun exists(): Boolean = keys.exists()

    fun remainingAttempts(): Int = keys.remainingAttempts()

    /** See [VaultKeyManager.wipeLeftoversForFreshInstall]. Also removes old ciphertext. */
    fun wipeLeftoversForFreshInstall() {
        lock()
        keys.wipeLeftoversForFreshInstall()
        SecureFiles.deleteTree(items)
    }

    fun create(pin: CharArray) {
        root.mkdirs()
        // Fails without touching anything if a vault already exists or the PIN is weak.
        val mk = keys.create(pin)
        // Only now is it safe to clear leftover ciphertext of a destroyed vault.
        SecureFiles.deleteTree(items)
        setMasterKey(mk)
    }

    fun unlock(pin: CharArray) {
        lock()
        setMasterKey(destroyingItemsOnLockout { keys.unlock(pin) })
    }

    fun changePin(
        currentPin: CharArray,
        newPin: CharArray,
    ) = destroyingItemsOnLockout { keys.changePin(currentPin, newPin) }

    /** Drops the master key from memory. Call when the app leaves the screen (SPEC AC-07). */
    @Synchronized
    fun lock() {
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
    ): ImportResult {
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
            SecureFiles.writeAtomic(File(stage, "meta"), Aead.seal(fileKey, encodeMeta(finalMeta), aad("meta", idBytes)))
            thumbnail?.let { SecureFiles.writeAtomic(File(stage, "thumb"), Aead.seal(fileKey, it, aad("thumb", idBytes))) }
            // The wrapped key is written last: an item without it can never be opened.
            SecureFiles.writeAtomic(File(stage, "key"), Aead.seal(mk, fileKey, aad("key", idBytes)))
            SecureFiles.syncDir(stage)
            items.mkdirs()
            SecureFiles.moveAtomic(stage, File(items, id))
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
        val dirs = items.listFiles { f -> f.isDirectory && isValidId(f.name) && File(f, "key").exists() } ?: return emptyList()
        return dirs.mapNotNull { dir ->
            try {
                withFileKey(dir.name) { fk, idBytes ->
                    VaultItem(dir.name, decodeMeta(Aead.open(fk, File(dir, "meta").readBytes(), aad("meta", idBytes))))
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

    /** Permanent deletion: the wrapped file key goes first, then the ciphertext (PRD 9.2). */
    fun delete(id: String) {
        requireUnlocked().wipe()
        val dir = itemDir(id)
        SecureFiles.shred(File(dir, "key"))
        SecureFiles.shred(File(dir, "meta"))
        SecureFiles.shred(File(dir, "thumb"))
        SecureFiles.deleteTree(dir)
    }

    /** Destroys the whole vault: master key first, then every file (PRD 9.3). */
    fun destroy() {
        lock()
        keys.destroy()
        SecureFiles.deleteTree(items)
        SecureFiles.deleteTree(staging)
    }

    private fun <T> withFileKey(
        id: String,
        block: (ByteArray, ByteArray) -> T,
    ): T {
        val mk = requireUnlocked()
        val idBytes = parseId(id)
        val fk =
            try {
                Aead.open(mk, File(itemDir(id), "key").readBytes(), aad("key", idBytes))
            } finally {
                mk.wipe()
            }
        try {
            return block(fk, idBytes)
        } finally {
            fk.wipe()
        }
    }

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
    private fun setMasterKey(mk: ByteArray) {
        masterKey?.wipe()
        masterKey = mk
    }

    /** Ciphertext is removed only after a real 3-strike destruction, never on a key glitch. */
    private fun <T> destroyingItemsOnLockout(block: () -> T): T =
        try {
            block()
        } catch (e: VaultDestroyedException) {
            lock()
            SecureFiles.deleteTree(items)
            SecureFiles.deleteTree(staging)
            throw e
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
}
