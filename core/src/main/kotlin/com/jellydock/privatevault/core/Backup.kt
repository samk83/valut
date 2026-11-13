package com.jellydock.privatevault.core

import java.io.DataInputStream
import java.io.EOFException
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream

/**
 * Encrypted backup for when the app is deleted or the phone is lost (owner decision
 * 2026-11-12). Nothing goes to a server: the app writes into a folder the user picks
 * (iCloud Drive, the Files app, an Android folder), and only the recovery key opens it.
 *
 * Folder layout (format spec: docs/BACKUP_FORMAT.md):
 *   backup.pvbi       "PVBI" | v1 | u16 len | seal(backupKey, CHECK, aad INFO_AAD)
 *   <item id>.pvb     "PVB1" | v1 | id(16) | u16 len | seal(backupKey, fileKey, aad KEY_AAD+id)
 *                     | u32 len | sealed meta | u32 len | sealed thumbnail (0 = none)
 *                     | item data exactly as stored in the vault ([ChunkedCipher])
 *
 * Meta, thumbnail and data are the vault's own ciphertext under the item's file key, so a
 * backup never holds plaintext and never re-encrypts photos. backupKey = HKDF(recovery key).
 */
interface BackupFolder {
    /** File names directly in the folder. */
    fun list(): List<String>

    fun openRead(name: String): InputStream

    /** Writes [name] completely or not at all (temporary name, then rename). */
    fun write(
        name: String,
        block: (OutputStream) -> Unit,
    )

    /** Removes [name]. Throws [java.io.IOException] if it is still there afterwards. */
    fun delete(name: String)

    /** Size in bytes of [name], or -1 if unknown (for example a cloud file not yet downloaded). */
    fun size(name: String): Long = -1
}

/** A plain folder on disk (tests, and any folder the platform exposes as a path). */
class LocalBackupFolder(private val dir: File) : BackupFolder {
    override fun list(): List<String> = dir.listFiles()?.filter { it.isFile }?.map { it.name } ?: emptyList()

    override fun openRead(name: String): InputStream = File(dir, name).inputStream()

    override fun write(
        name: String,
        block: (OutputStream) -> Unit,
    ) {
        dir.mkdirs()
        val tmp = File(dir, "$name${BackupFormat.PART}")
        try {
            FileOutputStream(tmp).use { out ->
                block(out)
                out.flush()
                out.fd.sync()
            }
            SecureFiles.moveAtomic(tmp, File(dir, name))
        } finally {
            tmp.delete()
        }
    }

    override fun delete(name: String) {
        val f = File(dir, name)
        if (!f.delete() && f.exists()) throw java.io.IOException("Could not delete $name")
    }

    override fun size(name: String): Long = File(dir, name).let { if (it.isFile) it.length() else -1 }
}

/** The 256-bit recovery key and its written form: 52 characters in groups of four. */
object RecoveryKey {
    const val BYTES = 32
    private const val ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ" // Crockford base32
    private const val CHARS = (BYTES * 8 + 4) / 5

    fun generate(): ByteArray = Aead.randomBytes(BYTES)

    fun format(key: ByteArray): String {
        require(key.size == BYTES) { "Recovery key must be 32 bytes" }
        val out = StringBuilder()
        var buffer = 0
        var bits = 0
        for (b in key) {
            buffer = (buffer shl 8) or (b.toInt() and 0xFF)
            bits += 8
            while (bits >= 5) {
                out.append(ALPHABET[(buffer ushr (bits - 5)) and 31])
                bits -= 5
            }
            buffer = buffer and ((1 shl bits) - 1)
        }
        if (bits > 0) out.append(ALPHABET[(buffer shl (5 - bits)) and 31])
        return out.chunked(4).joinToString("-")
    }

    /**
     * Reads a typed key. Spaces, dashes and case are ignored, and the letters people confuse
     * with digits (O, I, L) are read as 0 and 1. Throws [IllegalArgumentException] if it
     * cannot be a recovery key.
     */
    fun parse(text: String): ByteArray {
        val clean =
            text.uppercase().filter { !it.isWhitespace() && it != '-' }
                .map {
                    when (it) {
                        'O' -> '0'
                        'I', 'L' -> '1'
                        else -> it
                    }
                }
        require(clean.size == CHARS) { "Recovery key has the wrong length" }
        val out = ByteArray(BYTES)
        var buffer = 0
        var bits = 0
        var index = 0
        for (c in clean) {
            val v = ALPHABET.indexOf(c)
            require(v >= 0) { "Recovery key has an invalid character" }
            buffer = (buffer shl 5) or v
            bits += 5
            if (bits >= 8) {
                if (index < BYTES) out[index++] = (buffer ushr (bits - 8)).toByte()
                bits -= 8
                buffer = buffer and ((1 shl bits) - 1)
            }
        }
        require(index == BYTES && buffer == 0) { "Recovery key is not valid" }
        return out
    }
}

data class BackupReport(val written: Int, val removed: Int, val total: Int)

data class RestoreReport(val restored: Int, val alreadyHere: Int, val damaged: Int)

internal object BackupFormat {
    const val INFO = "backup.pvbi"
    const val EXT = ".pvb"
    const val PART = ".part"
    private val INFO_MAGIC = "PVBI".toByteArray(Charsets.US_ASCII)
    private val ITEM_MAGIC = "PVB1".toByteArray(Charsets.US_ASCII)
    private const val VERSION = 1
    private val CHECK = "PrivateVault backup check v1".toByteArray(Charsets.US_ASCII)
    private val INFO_AAD = "PrivateVault backup info v1".toByteArray(Charsets.US_ASCII)
    private val KEY_AAD = "PrivateVault backup key v1".toByteArray(Charsets.US_ASCII)
    private val HKDF_INFO = "PrivateVault backup v1".toByteArray(Charsets.US_ASCII)
    private const val MAX_META = 64 * 1024
    private const val MAX_THUMB = 16 * 1024 * 1024

    fun backupKey(recoveryKey: ByteArray): ByteArray = Kdf.hkdfSha256(recoveryKey, ByteArray(0), HKDF_INFO)

    fun infoFile(backupKey: ByteArray): ByteArray {
        val sealed = Aead.seal(backupKey, CHECK, INFO_AAD)
        return INFO_MAGIC + byteArrayOf(VERSION.toByte()) + u16(sealed.size) + sealed
    }

    /** True if [bytes] is an info file made with [backupKey]. */
    fun opensInfo(
        bytes: ByteArray,
        backupKey: ByteArray,
    ): Boolean {
        if (bytes.size < 7 || !bytes.copyOfRange(0, 4).contentEquals(INFO_MAGIC) || bytes[4].toInt() != VERSION) return false
        val len = ((bytes[5].toInt() and 0xFF) shl 8) or (bytes[6].toInt() and 0xFF)
        if (bytes.size != 7 + len) return false
        return try {
            Aead.open(backupKey, bytes.copyOfRange(7, bytes.size), INFO_AAD).contentEquals(CHECK)
        } catch (e: IntegrityException) {
            false
        }
    }

    fun itemHeader(
        id: ByteArray,
        wrappedKey: ByteArray,
        sealedMeta: ByteArray,
        sealedThumb: ByteArray?,
    ): ByteArray {
        val thumb = sealedThumb ?: ByteArray(0)
        return ITEM_MAGIC + byteArrayOf(VERSION.toByte()) + id + u16(wrappedKey.size) + wrappedKey +
            u32(sealedMeta.size) + sealedMeta + u32(thumb.size) + thumb
    }

    /** Bytes before the data in an item file, for a thumbnail of [thumbLen] bytes (0 = none). */
    fun headerSize(
        metaLen: Long,
        thumbLen: Long,
    ): Long = 4 + 1 + 16 + 2 + WRAPPED_KEY_LEN + 4 + metaLen + 4 + thumbLen

    /** Length of a wrapped 32-byte file key. */
    val WRAPPED_KEY_LEN: Long by lazy { Aead.seal(ByteArray(32), ByteArray(32), ByteArray(0)).size.toLong() }

    fun wrapKey(
        backupKey: ByteArray,
        fileKey: ByteArray,
        id: ByteArray,
    ): ByteArray = Aead.seal(backupKey, fileKey, KEY_AAD + id)

    class ItemHeader(val id: ByteArray, val fileKey: ByteArray, val sealedMeta: ByteArray, val sealedThumb: ByteArray?)

    /** Reads an item header from [input], leaving it at the start of the data. */
    fun readItemHeader(
        input: InputStream,
        backupKey: ByteArray,
    ): ItemHeader {
        val data = DataInputStream(input)
        try {
            val magic = ByteArray(4).also { data.readFully(it) }
            if (!magic.contentEquals(ITEM_MAGIC) || data.readUnsignedByte() != VERSION) throw IntegrityException("Not a backup item")
            val id = ByteArray(16).also { data.readFully(it) }
            val keyLen = data.readUnsignedShort()
            if (keyLen > 256) throw IntegrityException("Bad key length")
            val wrapped = ByteArray(keyLen).also { data.readFully(it) }
            val metaLen = data.readInt()
            if (metaLen !in 1..MAX_META) throw IntegrityException("Bad metadata length")
            val meta = ByteArray(metaLen).also { data.readFully(it) }
            val thumbLen = data.readInt()
            if (thumbLen !in 0..MAX_THUMB) throw IntegrityException("Bad thumbnail length")
            val thumb = if (thumbLen == 0) null else ByteArray(thumbLen).also { data.readFully(it) }
            val fileKey = Aead.open(backupKey, wrapped, KEY_AAD + id)
            return ItemHeader(id, fileKey, meta, thumb)
        } catch (e: EOFException) {
            throw IntegrityException("Backup item is cut short")
        }
    }

    private fun u16(v: Int) = byteArrayOf((v ushr 8).toByte(), v.toByte())

    private fun u32(v: Int) = byteArrayOf((v ushr 24).toByte(), (v ushr 16).toByte(), (v ushr 8).toByte(), v.toByte())
}
