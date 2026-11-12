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

/**
 * File-backed counter in app-private storage, kept in two copies (SPEC AC-50): one damaged
 * file costs nothing.
 *
 * If the two copies disagree (the app died between the two writes, or one copy was
 * edited or restored from an old snapshot) the higher value is used, so changing one copy
 * never shortens a wait. When the second write fails, the stale copy is removed instead,
 * so a correct PIN whose reset was cut short does not leave an old, higher count behind.
 */
class FileAttemptCounter(private val file: File) : AttemptCounter {
    private val backup = File(file.absoluteFile.parentFile, file.name + ".bak")

    override fun read(): Int {
        // Both copies missing or corrupted must never grant a fresh set of attempts, but it
        // also must not lock the user out on its own (PRD 14), so it leaves one free attempt.
        val values = listOf(file, backup).mapNotNull { parse(it) }
        if (values.isEmpty()) return TAMPERED
        return values.max()
    }

    private fun parse(f: File): Int? {
        if (!f.exists()) return null
        val bytes = runCatching { f.readBytes() }.getOrNull() ?: return null
        if (bytes.size != 4) return null
        val value =
            ((bytes[0].toInt() and 0xFF) shl 24) or ((bytes[1].toInt() and 0xFF) shl 16) or
                ((bytes[2].toInt() and 0xFF) shl 8) or (bytes[3].toInt() and 0xFF)
        return value.takeIf { it in 0..LockoutPolicy.MAX_COUNT }
    }

    private companion object {
        const val TAMPERED = LockoutPolicy.FREE_ATTEMPTS - 1
    }

    override fun write(value: Int) {
        val bytes = byteArrayOf((value ushr 24).toByte(), (value ushr 16).toByte(), (value ushr 8).toByte(), value.toByte())
        SecureFiles.writeAtomic(file, bytes)
        // A failed second write must not turn a correct PIN into an error. The old copy is
        // removed so it cannot win over the new value; one missing copy is read as the other.
        runCatching { SecureFiles.writeAtomic(backup, bytes) }.onFailure { runCatching { backup.delete() } }
    }
}
