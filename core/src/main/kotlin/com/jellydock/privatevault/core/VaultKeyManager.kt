package com.jellydock.privatevault.core

import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/**
 * Owns the vault master key (MK) and the 3-strike rule.
 *
 * Key hierarchy:
 *   A   = Argon2id(PIN, salt, params)
 *   H   = HardwareKey.mix(A)                      computed inside the security chip
 *   KEK = HKDF-SHA256(A || H, salt, "PrivateVault KEK v1")
 *   envelope = AES-256-GCM(KEK, MK, aad = envelope header)
 *
 * The PIN alone cannot open the envelope (H is needed), and the device key alone cannot
 * either (A is needed). There is no recovery key of any kind (PRD PV-SEC-001).
 */
class VaultKeyManager(
    private val envelopeFile: File,
    private val counter: AttemptCounter,
    private val hardwareKey: HardwareKey,
    private val params: Argon2Params = Argon2Params.DEFAULT,
) {
    private val lockFile = File(envelopeFile.absoluteFile.parentFile, envelopeFile.name + ".lock")

    // Identifies the current master key without revealing it, so an object holding a master
    // key can tell whether the vault was destroyed or recreated by someone else meanwhile.
    private val checkFile = File(envelopeFile.absoluteFile.parentFile, envelopeFile.name + ".check")

    fun exists(): Boolean = envelopeFile.exists() && hardwareKey.exists()

    fun remainingAttempts(): Int = (MAX_ATTEMPTS - counter.read()).coerceAtLeast(0)

    /** Creates a new vault and returns its master key. The caller must wipe it when done. */
    fun create(pin: CharArray): ByteArray =
        exclusive {
            if (envelopeFile.exists()) throw VaultStateException("Vault already exists")
            PinPolicy.check(pin)?.let { throw WeakPinException(it) }
            // The counter goes first: an envelope must never exist next to a stale count.
            counter.write(0)
            hardwareKey.create()
            val mk = Aead.randomBytes(Aead.KEY_BYTES)
            try {
                SecureFiles.writeAtomic(checkFile, keyCheck(mk))
                writeEnvelope(pin, mk)
            } catch (e: Throwable) {
                mk.wipe()
                throw e
            }
            mk
        }

    /**
     * Checks [pin] and returns the master key. On the third consecutive wrong PIN the keys
     * are destroyed and [VaultDestroyedException] is thrown.
     */
    fun unlock(pin: CharArray): ByteArray = exclusive { unlockLocked(pin) }

    /**
     * Runs [block] only if [mk] is still the live master key, holding the vault lock so the
     * vault cannot be destroyed while it runs. Otherwise throws [VaultDestroyedException].
     */
    fun <T> whileKeyIsLive(
        mk: ByteArray,
        block: () -> T,
    ): T =
        exclusive {
            val live =
                envelopeFile.exists() && hardwareKey.exists() && checkFile.exists() &&
                    MessageDigest.isEqual(checkFile.readBytes(), keyCheck(mk))
            if (!live) throw VaultDestroyedException()
            block()
        }

    /** Re-wraps the same master key under a new PIN. The current PIN is required (PV-017). */
    fun changePin(
        currentPin: CharArray,
        newPin: CharArray,
    ) = exclusive {
        PinPolicy.check(newPin)?.let { throw WeakPinException(it) }
        val mk = unlockLocked(currentPin)
        try {
            writeEnvelope(newPin, mk)
        } finally {
            mk.wipe()
        }
    }

    /** Cryptographic erasure: after this no PIN can ever open the old vault. */
    fun destroy() = exclusive { destroyLocked() }

    /**
     * Call on the first launch after (re)install, before anything else. On iOS, Keychain and
     * Secure Enclave items can survive an uninstall, so leftovers are deleted here (SPEC AC-20).
     */
    fun wipeLeftoversForFreshInstall() =
        exclusive {
            if (hardwareKey.exists()) hardwareKey.destroy()
            SecureFiles.shred(envelopeFile)
            SecureFiles.shred(checkFile)
            counter.write(0)
        }

    /**
     * Shreds temp files left in the vault folder by a write interrupted by a crash (an
     * envelope copy among them). Runs under the vault lock, because every envelope and
     * counter write creates such a file while it holds that lock.
     */
    fun sweepTempFiles() =
        exclusive {
            envelopeFile.absoluteFile.parentFile?.listFiles { f -> f.isFile && f.name.endsWith(".tmp") }
                ?.forEach { SecureFiles.shred(it) }
        }

    private fun unlockLocked(pin: CharArray): ByteArray {
        if (!PinPolicy.isCompleteEntry(pin)) throw IncompleteEntryException()
        val used = counter.read()
        if (used >= MAX_ATTEMPTS) {
            // Either the final attempt was recorded but the process died before it finished,
            // or a destruction was interrupted halfway. Giving the attempt again would let an
            // attacker kill the app after each wrong final guess and retry forever, so the
            // destruction is (re)done.
            destroyLocked()
            throw VaultDestroyedException()
        }
        val hasEnvelope = envelopeFile.exists()
        val hasChipKey = hardwareKey.exists()
        if (!hasEnvelope && !hasChipKey) throw VaultDestroyedException()
        // Half the key material is missing: nothing can open the vault, but this is not a
        // completed wrong guess, so nothing is destroyed or counted.
        if (!hasEnvelope || !hasChipKey) throw KeysUnavailableException()
        // Count first, check second (SPEC AC-03). If the process is killed during the check,
        // the attempt stays counted.
        counter.write(used + 1)
        val mk =
            try {
                openEnvelope(pin)
            } catch (e: IntegrityException) {
                if (used + 1 >= MAX_ATTEMPTS) {
                    destroyLocked()
                    throw VaultDestroyedException()
                }
                throw WrongPinException(MAX_ATTEMPTS - (used + 1))
            } catch (e: Throwable) {
                // The check did not complete (out of memory, security chip error). No answer
                // was learned, so the attempt is given back instead of being counted.
                runCatching { counter.write(used) }.exceptionOrNull()?.let(e::addSuppressed)
                throw e
            }
        try {
            counter.write(0)
        } catch (e: Throwable) {
            mk.wipe()
            throw e
        }
        return mk
    }

    private fun destroyLocked() {
        // The count is set first so an interruption still leaves the vault refusing entry.
        counter.write(MAX_ATTEMPTS)
        if (hardwareKey.exists()) hardwareKey.destroy()
        SecureFiles.shred(envelopeFile)
        SecureFiles.shred(checkFile)
        // Temp copies of an envelope (left by a crash during a write) open with the same keys.
        envelopeFile.absoluteFile.parentFile?.listFiles { f -> f.name.startsWith(envelopeFile.name + ".") && f.name.endsWith(".tmp") }
            ?.forEach { SecureFiles.shred(it) }
    }

    /**
     * Runs [block] while holding both a JVM monitor (threads) and a file lock (processes), so
     * parallel unlock calls cannot each read the same count and get extra attempts.
     */
    private fun <T> exclusive(block: () -> T): T =
        synchronized(monitorFor(lockFile)) {
            lockFile.parentFile?.mkdirs()
            RandomAccessFile(lockFile, "rw").use { raf ->
                raf.channel.lock().use { block() }
            }
        }

    private fun writeEnvelope(
        pin: CharArray,
        mk: ByteArray,
    ) {
        val salt = Aead.randomBytes(Kdf.SALT_BYTES)
        val header = encodeHeader(params, salt)
        val kek = deriveKek(pin, salt, params)
        try {
            SecureFiles.writeAtomic(envelopeFile, header + Aead.seal(kek, mk, header))
        } finally {
            kek.wipe()
        }
    }

    private fun openEnvelope(pin: CharArray): ByteArray {
        val bytes = envelopeFile.readBytes()
        // The header (including Argon2 params) is the AEAD's associated data, so editing it
        // to cheapen guesses only makes the envelope fail to open.
        val (storedParams, salt, headerLength) = decodeHeader(bytes)
        val header = bytes.copyOfRange(0, headerLength)
        val kek = deriveKek(pin, salt, storedParams)
        try {
            return Aead.open(kek, bytes.copyOfRange(headerLength, bytes.size), header)
        } finally {
            kek.wipe()
        }
    }

    private fun keyCheck(mk: ByteArray): ByteArray = Kdf.hkdfSha256(mk, ByteArray(0), CHECK_INFO)

    private fun deriveKek(
        pin: CharArray,
        salt: ByteArray,
        p: Argon2Params,
    ): ByteArray {
        val a = Kdf.argon2id(pin, salt, p)
        val h = hardwareKey.mix(a)
        val ikm = a + h
        try {
            return Kdf.hkdfSha256(ikm, salt, KEK_INFO)
        } finally {
            a.wipe()
            h.wipe()
            ikm.wipe()
        }
    }

    private fun encodeHeader(
        p: Argon2Params,
        salt: ByteArray,
    ): ByteArray {
        val buffer = ByteArrayOutputStream()
        DataOutputStream(buffer).use { out ->
            out.write(MAGIC)
            out.writeByte(FORMAT_VERSION)
            out.writeInt(p.memoryKiB)
            out.writeInt(p.iterations)
            out.writeByte(p.parallelism)
            out.write(salt)
        }
        return buffer.toByteArray()
    }

    private fun decodeHeader(bytes: ByteArray): Triple<Argon2Params, ByteArray, Int> {
        if (bytes.size < HEADER_BYTES + Aead.NONCE_BYTES + Aead.TAG_BYTES) throw IntegrityException("Envelope too short")
        DataInputStream(bytes.inputStream()).use { input ->
            val magic = ByteArray(MAGIC.size).also { input.readFully(it) }
            if (!magic.contentEquals(MAGIC)) throw IntegrityException("Not a vault envelope")
            val version = input.readUnsignedByte()
            if (version != FORMAT_VERSION) throw IntegrityException("Unsupported envelope version $version")
            val p =
                try {
                    Argon2Params(input.readInt(), input.readInt(), input.readUnsignedByte())
                } catch (e: IllegalArgumentException) {
                    throw IntegrityException("Invalid envelope parameters")
                }
            val salt = ByteArray(Kdf.SALT_BYTES).also { input.readFully(it) }
            return Triple(p, salt, HEADER_BYTES)
        }
    }

    companion object {
        const val MAX_ATTEMPTS = 3

        // One monitor per vault folder: two manager objects for the same files must also
        // wait for each other (a JVM cannot hold two file locks on one file).
        private val monitors = ConcurrentHashMap<String, Any>()

        private fun monitorFor(file: File): Any = monitors.computeIfAbsent(file.canonicalPath) { Any() }

        private const val FORMAT_VERSION = 1
        private val MAGIC = "PVK1".toByteArray(Charsets.US_ASCII)
        private const val HEADER_BYTES = 4 + 1 + 4 + 4 + 1 + Kdf.SALT_BYTES
        private val CHECK_INFO = "PrivateVault MK check v1".toByteArray(Charsets.US_ASCII)
        private val KEK_INFO = "PrivateVault KEK v1".toByteArray(Charsets.US_ASCII)
    }
}
