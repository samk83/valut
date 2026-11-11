package com.jellydock.privatevault.core

import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.util.UUID

/**
 * Holding area for captures that exist nowhere else (in-app camera photos and videos).
 *
 * A capture is moved here before it is encrypted and removed only after the vault has
 * verified and registered its encrypted copy. If the app is killed, runs out of battery or
 * the import fails, the capture stays here and is imported on the next unlock (SPEC AC-50).
 * The folder is app-private and excluded from backups; files wait here in plaintext only
 * until the vault is next unlocked.
 */
class PendingImports(private val dir: File) {
    /** Moves [source] into the holding area and returns its new location. */
    fun stash(
        source: File,
        kind: ItemKind,
    ): File {
        dir.mkdirs()
        val target = File(dir, "${UUID.randomUUID()}.${kind.name.lowercase()}")
        try {
            SecureFiles.moveAtomic(source, target)
        } catch (e: IOException) {
            // Different file systems: copy to a temp name durably, publish it with a rename,
            // then remove the source. A partial copy is never mistaken for a capture.
            val tmp = File(dir, target.name + ".tmp")
            try {
                FileInputStream(source).use { input ->
                    FileOutputStream(tmp).use { out ->
                        input.copyTo(out)
                        out.fd.sync()
                    }
                }
                SecureFiles.moveAtomic(tmp, target)
            } finally {
                tmp.delete()
            }
            source.delete()
        }
        return target
    }

    /**
     * Removes every waiting capture. Only for a vault destruction (3 wrong PINs or a reset),
     * so captures meant for the old vault never reach a new one.
     */
    fun clear() {
        dir.listFiles()?.forEach { SecureFiles.shred(it) }
    }

    /** Files waiting to be imported, oldest first. Temp files and unknown names are ignored. */
    fun pending(): List<File> = dir.listFiles { f -> f.isFile && kindOf(f) != null }?.sortedBy { it.lastModified() } ?: emptyList()

    fun kindOf(file: File): ItemKind? =
        when (file.name.substringAfterLast('.', "")) {
            "photo" -> ItemKind.PHOTO
            "video" -> ItemKind.VIDEO
            else -> null
        }

    /**
     * Imports [file] into [vault] and deletes it only once the vault reports a verified copy.
     * On any failure the file is kept and the error is rethrown.
     */
    fun importOne(
        vault: Vault,
        file: File,
        mimeType: String,
        thumbnail: ByteArray? = null,
    ): ImportResult {
        val kind = kindOf(file) ?: throw IllegalArgumentException("Not a pending capture: ${file.name}")
        val sha = FileInputStream(file).use { sha256(it) }
        val result =
            FileInputStream(file).use {
                vault.importItem(it, ItemMeta(kind, mimeType, file.lastModified()), thumbnail, sha)
            }
        if (result.safeToDeleteOriginal) {
            SecureFiles.shred(file)
            SecureFiles.syncDir(dir)
        }
        return result
    }

    private fun sha256(input: java.io.InputStream): ByteArray {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            digest.update(buffer, 0, n)
        }
        return digest.digest()
    }
}
