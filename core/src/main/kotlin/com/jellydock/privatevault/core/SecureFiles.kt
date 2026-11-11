package com.jellydock.privatevault.core

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.util.UUID

/** Small durable file helpers. All vault files live in app-private storage. */
internal object SecureFiles {
    /** Writes [data] so that readers see either the old or the new content, never a mix. */
    fun writeAtomic(
        target: File,
        data: ByteArray,
    ) {
        target.parentFile?.mkdirs()
        // A unique name so two writers never share a temp file.
        val tmp = File(target.parentFile, "${target.name}.${UUID.randomUUID()}.tmp")
        try {
            FileOutputStream(tmp).use { out ->
                out.write(data)
                out.fd.sync()
            }
            Files.move(tmp.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } finally {
            tmp.delete()
        }
        syncDir(target.absoluteFile.parentFile)
    }

    /** Moves [source] to [target] atomically and makes the rename survive a power cut. */
    fun moveAtomic(
        source: File,
        target: File,
    ) {
        Files.move(source.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE)
        syncDir(target.absoluteFile.parentFile)
        syncDir(source.absoluteFile.parentFile)
    }

    /**
     * Flushes a directory entry to storage, so a rename is not lost after a reboot. Android
     * and iOS support this; Windows (used only for development) does not, so it is skipped.
     */
    fun syncDir(dir: File) {
        try {
            FileChannel.open(dir.toPath(), StandardOpenOption.READ).use { it.force(true) }
        } catch (e: IOException) {
            if (!isWindows) throw e
        }
    }

    private val isWindows = System.getProperty("os.name").orEmpty().startsWith("Windows")

    /**
     * Overwrites a small file with random bytes before deleting it. On flash storage this
     * does not guarantee the old blocks are gone; the real protection is that the keys
     * needed to read anything are destroyed (cryptographic erasure).
     */
    fun shred(file: File) {
        if (!file.exists()) return
        if (file.isFile) {
            RandomAccessFile(file, "rws").use { raf ->
                val length = raf.length()
                if (length in 1..MAX_SHRED_BYTES) {
                    raf.seek(0)
                    raf.write(Aead.randomBytes(length.toInt()))
                }
            }
        }
        file.delete()
    }

    fun deleteTree(dir: File) {
        if (!dir.exists()) return
        dir.walkBottomUp().forEach { it.delete() }
    }

    private const val MAX_SHRED_BYTES = 64L * 1024
}
