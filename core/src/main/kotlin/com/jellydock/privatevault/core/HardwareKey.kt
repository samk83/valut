package com.jellydock.privatevault.core

/**
 * A device-bound secret that never leaves the phone's security chip.
 *
 * The vault mixes the Argon2id output through [mix] before deriving the key that wraps
 * the master key, so a guess can only be checked on the device that holds this key.
 * Copying the vault files to another machine is not enough to brute-force the PIN.
 *
 * Platform implementations (validated on real devices in the PoC, not in this module):
 * - Android: HMAC-SHA256 key in Android Keystore, `setIsStrongBoxBacked(true)` and
 *   rollback resistance required (SPEC AC-15), so a deleted key never comes back.
 * - iOS: P-256 key created in the Secure Enclave with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`;
 *   [mix] = HKDF(ECDH(enclaveKey, storedPeerPublicKey), data).
 */
interface HardwareKey {
    /** True if the device key currently exists. */
    fun exists(): Boolean

    /** Creates a new device key, replacing any previous one. */
    fun create()

    /** Deterministic keyed function of [data] computed inside the security chip (32 bytes out). */
    fun mix(data: ByteArray): ByteArray

    /** Permanently deletes the device key. Must be irreversible. */
    fun destroy()
}
