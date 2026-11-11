package com.jellydock.privatevault.core

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** Small Argon2 settings so tests run fast. Production uses [Argon2Params.DEFAULT]. */
val TEST_PARAMS = Argon2Params(memoryKiB = 1024, iterations = 1, parallelism = 1)

/** Stand-in for the security chip: an HMAC key held only in memory. */
class FakeHardwareKey : HardwareKey {
    private var key: ByteArray? = null
    var mixCalls = 0
        private set

    override fun exists() = key != null

    override fun create() {
        key = Aead.randomBytes(32)
    }

    override fun mix(data: ByteArray): ByteArray {
        mixCalls++
        val k = key ?: throw IllegalStateException("No hardware key")
        return Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(k, "HmacSHA256"))
            doFinal(data)
        }
    }

    override fun destroy() {
        key?.fill(0)
        key = null
    }

    /** Simulates moving the hardware key, which a real chip never allows. Test-only. */
    fun copyFrom(other: FakeHardwareKey) {
        key = other.key?.copyOf()
    }
}

fun pin(text: String) = text.toCharArray()
