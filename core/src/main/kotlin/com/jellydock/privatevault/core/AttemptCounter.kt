package com.jellydock.privatevault.core

import java.io.File

/**
 * Durable count of consecutive failed unlocks.
 *
 * The count is written and synced to disk BEFORE a PIN is checked, so killing the app
 * during the check cannot give an attacker a free attempt (SPEC AC-03).
 */
interface AttemptCounter {
    fun read(): Int

    fun write(value: Int)
}

/** File-backed counter in app-private storage. */
class FileAttemptCounter(private val file: File) : AttemptCounter {
    override fun read(): Int {
        // A missing or corrupted counter must never grant a fresh set of attempts, but it
        // also must not destroy the vault on its own (PRD 14), so it leaves one attempt.
        if (!file.exists()) return TAMPERED
        val bytes = file.readBytes()
        if (bytes.size != 4) return TAMPERED
        val value =
            ((bytes[0].toInt() and 0xFF) shl 24) or ((bytes[1].toInt() and 0xFF) shl 16) or
                ((bytes[2].toInt() and 0xFF) shl 8) or (bytes[3].toInt() and 0xFF)
        return if (value in 0..VaultKeyManager.MAX_ATTEMPTS) value else TAMPERED
    }

    private companion object {
        const val TAMPERED = VaultKeyManager.MAX_ATTEMPTS - 1
    }

    override fun write(value: Int) {
        SecureFiles.writeAtomic(
            file,
            byteArrayOf((value ushr 24).toByte(), (value ushr 16).toByte(), (value ushr 8).toByte(), value.toByte()),
        )
    }
}
