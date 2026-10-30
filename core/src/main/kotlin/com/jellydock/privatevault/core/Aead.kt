package com.jellydock.privatevault.core

import java.security.SecureRandom
import javax.crypto.BadPaddingException
import javax.crypto.Cipher
import javax.crypto.IllegalBlockSizeException
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** AES-256-GCM with a 96-bit nonce and 128-bit tag. Uses only the platform JCA provider. */
internal object Aead {
    const val KEY_BYTES = 32
    const val NONCE_BYTES = 12
    const val TAG_BYTES = 16
    private const val TAG_BITS = TAG_BYTES * 8

    val random: SecureRandom = SecureRandom()

    fun randomBytes(size: Int): ByteArray = ByteArray(size).also { random.nextBytes(it) }

    /** Returns nonce || ciphertext || tag, with a fresh random nonce. */
    fun seal(
        key: ByteArray,
        plaintext: ByteArray,
        aad: ByteArray,
    ): ByteArray {
        val nonce = randomBytes(NONCE_BYTES)
        return nonce + sealWithNonce(key, nonce, plaintext, aad)
    }

    /** Opens the output of [seal]. Throws [IntegrityException] if anything was altered. */
    fun open(
        key: ByteArray,
        sealed: ByteArray,
        aad: ByteArray,
    ): ByteArray {
        if (sealed.size < NONCE_BYTES + TAG_BYTES) throw IntegrityException("Sealed data too short")
        val nonce = sealed.copyOfRange(0, NONCE_BYTES)
        return openWithNonce(key, nonce, sealed.copyOfRange(NONCE_BYTES, sealed.size), aad)
    }

    /** Caller guarantees the (key, nonce) pair is never reused. */
    fun sealWithNonce(
        key: ByteArray,
        nonce: ByteArray,
        plaintext: ByteArray,
        aad: ByteArray,
    ): ByteArray {
        val cipher = cipher(Cipher.ENCRYPT_MODE, key, nonce)
        cipher.updateAAD(aad)
        return cipher.doFinal(plaintext)
    }

    fun openWithNonce(
        key: ByteArray,
        nonce: ByteArray,
        ciphertext: ByteArray,
        aad: ByteArray,
    ): ByteArray {
        val cipher = cipher(Cipher.DECRYPT_MODE, key, nonce)
        cipher.updateAAD(aad)
        try {
            return cipher.doFinal(ciphertext)
        } catch (e: BadPaddingException) {
            // AEADBadTagException is a BadPaddingException.
            throw IntegrityException("Authentication failed")
        } catch (e: IllegalBlockSizeException) {
            throw IntegrityException("Ciphertext too short")
        }
    }

    private fun cipher(
        mode: Int,
        key: ByteArray,
        nonce: ByteArray,
    ): Cipher {
        require(key.size == KEY_BYTES) { "AES-256 key required" }
        require(nonce.size == NONCE_BYTES) { "96-bit nonce required" }
        return Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, nonce))
        }
    }
}

/** Best-effort removal of secrets from memory. The JVM may still hold copies. */
internal fun ByteArray.wipe() = fill(0)
