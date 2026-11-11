package com.jellydock.privatevault.core

/** Base type for every failure the vault core reports to the app layer. */
sealed class VaultException(message: String) : Exception(message)

/** The PIN entry was shorter than the minimum length. It is not counted as an attempt. */
class IncompleteEntryException : VaultException("PIN entry is incomplete and was not counted")

/** The PIN was wrong. [remainingAttempts] tells the UI how many tries are left. */
class WrongPinException(val remainingAttempts: Int) :
    VaultException("Wrong PIN, $remainingAttempts attempt(s) remaining")

/** The vault keys were destroyed (3 failed attempts, manual reset or reinstall). Permanent. */
class VaultDestroyedException : VaultException("Vault keys have been destroyed")

/**
 * Only part of the key material is present (for example the security chip key could not be
 * found). Nothing is destroyed and nothing is counted; the vault simply cannot be opened.
 */
class KeysUnavailableException : VaultException("Vault keys are incomplete or unavailable")

/** A vault already exists, or none exists, when the opposite was required. */
class VaultStateException(message: String) : VaultException(message)

/** Ciphertext, envelope or chunk failed authentication: tampered, truncated or reordered. */
class IntegrityException(message: String) : VaultException(message)

/** An import did not verify. Nothing was registered and the original must be kept. */
class ImportVerificationException(message: String) : VaultException(message)

/** The PIN does not meet the creation policy. */
class WeakPinException(val reason: PinPolicy.Rejection) : VaultException("PIN rejected: $reason")
