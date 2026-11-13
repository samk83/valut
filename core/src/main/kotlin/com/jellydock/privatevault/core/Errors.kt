package com.jellydock.privatevault.core

/** Base type for every failure the vault core reports to the app layer. */
sealed class VaultException(message: String) : Exception(message)

/** The PIN entry was shorter than the minimum length. It is not counted as an attempt. */
class IncompleteEntryException : VaultException("PIN entry is incomplete and was not counted")

/**
 * The PIN was wrong. [remainingAttempts] is how many tries are left before a wait starts,
 * [waitMs] how long the next attempt must wait (0 if none). Nothing is ever erased.
 */
class WrongPinException(val remainingAttempts: Int, val waitMs: Long = 0) :
    VaultException("Wrong PIN, $remainingAttempts free attempt(s) remaining")

/** Too many wrong attempts: no attempt is possible for [waitMs]. Nothing was counted or erased. */
class LockedOutException(val waitMs: Long) : VaultException("Locked out for $waitMs ms")

/** There is no vault key any more (the owner destroyed the vault, or a fresh install). */
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

/** The folder holds no backup (no backup.pvbi file). */
class NotABackupException : VaultException("No backup in this folder")

/** The recovery key does not open this backup (a typo, or another vault's backup). */
class BackupKeyMismatchException : VaultException("The recovery key does not match this backup")

/** Backups need a recovery key, and this vault has none yet. */
class NoRecoveryKeyException : VaultException("No recovery key has been set up")
