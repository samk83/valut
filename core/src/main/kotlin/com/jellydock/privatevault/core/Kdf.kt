package com.jellydock.privatevault.core

import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.generators.HKDFBytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import org.bouncycastle.crypto.params.HKDFParameters

/**
 * Argon2id cost settings. They are stored in the key envelope header and authenticated,
 * so an attacker cannot lower them. [DEFAULT] targets roughly one second per guess on a
 * current phone; the real value must be measured on devices in the PoC (SPEC AC-14).
 */
data class Argon2Params(
    val memoryKiB: Int,
    val iterations: Int,
    val parallelism: Int,
) {
    init {
        require(memoryKiB >= 8 * parallelism) { "Argon2 memory too small" }
        require(iterations >= 1 && parallelism in 1..16) { "Invalid Argon2 parameters" }
        // Upper bounds stop an edited envelope header from forcing a huge allocation
        // (out-of-memory) before the header is authenticated.
        require(memoryKiB <= MAX_MEMORY_KIB && iterations <= MAX_ITERATIONS) { "Argon2 parameters too large" }
    }

    companion object {
        const val MAX_MEMORY_KIB = 1024 * 1024
        const val MAX_ITERATIONS = 16

        /** 256 MiB, 3 passes. Starting point for device measurement. */
        val DEFAULT = Argon2Params(memoryKiB = 256 * 1024, iterations = 3, parallelism = 1)

        /** OWASP minimum (19 MiB, t=2). Lowest value the vault accepts in production. */
        val OWASP_MINIMUM = Argon2Params(memoryKiB = 19 * 1024, iterations = 2, parallelism = 1)
    }
}

internal object Kdf {
    const val SALT_BYTES = 16
    const val OUT_BYTES = 32

    fun argon2id(
        pin: CharArray,
        salt: ByteArray,
        params: Argon2Params,
    ): ByteArray {
        val generator = Argon2BytesGenerator()
        generator.init(
            Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
                .withVersion(Argon2Parameters.ARGON2_VERSION_13)
                .withSalt(salt)
                .withMemoryAsKB(params.memoryKiB)
                .withIterations(params.iterations)
                .withParallelism(params.parallelism)
                .build(),
        )
        val out = ByteArray(OUT_BYTES)
        generator.generateBytes(pin, out)
        return out
    }

    fun hkdfSha256(
        ikm: ByteArray,
        salt: ByteArray,
        info: ByteArray,
        length: Int = OUT_BYTES,
    ): ByteArray {
        val generator = HKDFBytesGenerator(SHA256Digest())
        generator.init(HKDFParameters(ikm, salt, info))
        return ByteArray(length).also { generator.generateBytes(it, 0, it.size) }
    }
}
