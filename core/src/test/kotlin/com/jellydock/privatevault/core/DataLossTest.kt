package com.jellydock.privatevault.core

import org.junit.jupiter.api.io.TempDir
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * SPEC AC-50: the vault never loses stored items through its own faults. Only the three
 * wrong PINs, a user delete and a user reset may remove anything. Every test here guards
 * one of the AC-50 rules; a change that breaks one must not be merged.
 */
class DataLossTest {
    @TempDir
    lateinit var dir: File

    private val hw = FakeHardwareKey()
    private val pinOk = pin("482915")
    private val photo = ItemMeta(ItemKind.PHOTO, "image/jpeg", 1_700_000_000_000)

    private fun newVault() = Vault(dir, hw, TEST_PARAMS, chunkSize = 4096)

    private fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes)

    private fun readAll(
        v: Vault,
        id: String,
    ) = ByteArrayOutputStream().also { v.read(id, it) }.toByteArray()

    private fun vaultWithOneItem(content: ByteArray = Aead.randomBytes(10_000)): Pair<Vault, String> {
        val v = newVault()
        v.create(pinOk)
        val id = v.importItem(content.inputStream(), photo, expectedSha256 = sha256(content)).item.id
        return v to id
    }

    private fun flipLastByte(file: File) {
        val b = file.readBytes()
        b[b.size - 1] = (b[b.size - 1].toInt() xor 1).toByte()
        file.writeBytes(b)
    }

    // AC-50a: one damaged or missing key envelope does not lose the vault.

    @Test
    fun `missing main envelope still opens with the right PIN and is repaired`() {
        val content = Aead.randomBytes(5000)
        val (v, id) = vaultWithOneItem(content)
        v.lock()
        File(dir, "vault.key").delete()
        v.unlock(pinOk)
        assertContentEquals(content, readAll(v, id))
        assertTrue(File(dir, "vault.key").exists(), "main copy is rewritten")
        assertContentEquals(File(dir, "vault.key").readBytes(), File(dir, "vault.key.bak").readBytes())
    }

    @Test
    fun `corrupted main envelope still opens with the right PIN`() {
        val (v, id) = vaultWithOneItem()
        v.lock()
        flipLastByte(File(dir, "vault.key"))
        v.unlock(pinOk)
        assertEquals(1, v.list().size)
        assertEquals(id, v.list().single().id)
        assertEquals(3, v.remainingAttempts())
    }

    @Test
    fun `corrupted backup envelope still opens and is repaired`() {
        val (v, _) = vaultWithOneItem()
        v.lock()
        flipLastByte(File(dir, "vault.key.bak"))
        v.unlock(pinOk)
        assertContentEquals(File(dir, "vault.key").readBytes(), File(dir, "vault.key.bak").readBytes())
    }

    @Test
    fun `a wrong PIN is still counted when one envelope copy is damaged`() {
        val (v, _) = vaultWithOneItem()
        v.lock()
        flipLastByte(File(dir, "vault.key"))
        assertFailsWith<WrongPinException> { v.unlock(pin("111222")) }
        assertEquals(2, v.remainingAttempts())
    }

    @Test
    fun `both envelopes unreadable is not counted and destroys nothing`() {
        val (v, id) = vaultWithOneItem()
        v.lock()
        File(dir, "vault.key").writeBytes(ByteArray(10))
        File(dir, "vault.key.bak").writeBytes(ByteArray(10))
        repeat(5) { assertFailsWith<KeysUnavailableException> { v.unlock(pinOk) } }
        assertEquals(3, v.remainingAttempts())
        assertTrue(File(dir, "items/$id").exists(), "ciphertext kept")
    }

    @Test
    fun `interrupted PIN change leaves a vault that still opens`() {
        val (v, id) = vaultWithOneItem()
        val oldMain = File(dir, "vault.key").readBytes()
        v.changePin(pinOk, pin("73915046"))
        v.lock()
        // Crash after the backup was rewritten but before the main copy was.
        File(dir, "vault.key").writeBytes(oldMain)
        v.unlock(pin("73915046"))
        assertEquals(id, v.list().single().id)
    }

    // AC-50b: one damaged attempt-counter file neither grants nor costs attempts.

    @Test
    fun `damaged counter copy keeps the real count`() {
        val (v, _) = vaultWithOneItem()
        v.lock()
        assertFailsWith<WrongPinException> { v.unlock(pin("111222")) }
        File(dir, "attempts").writeBytes(byteArrayOf(9))
        assertEquals(2, v.remainingAttempts())
        File(dir, "attempts").delete()
        assertEquals(2, v.remainingAttempts())
        v.unlock(pinOk)
        assertEquals(3, v.remainingAttempts())
    }

    @Test
    fun `a correct third PIN whose counter reset was cut short does not destroy the vault`() {
        val (v, id) = vaultWithOneItem()
        v.lock()
        repeat(2) { assertFailsWith<WrongPinException> { v.unlock(pin("111222")) } }
        v.unlock(pinOk)
        // Crash after the main copy was reset but before the backup copy was.
        FileAttemptCounter(File(dir, "x")).write(3)
        File(dir, "x").copyTo(File(dir, "attempts.bak"), overwrite = true)
        v.lock()
        assertEquals(1, v.remainingAttempts())
        v.unlock(pinOk)
        assertEquals(id, v.list().single().id)
        assertEquals(3, v.remainingAttempts())
    }

    @Test
    fun `restoring one old counter copy gives no extra attempts`() {
        val (v, _) = vaultWithOneItem()
        v.lock()
        val fresh = File(dir, "attempts").readBytes()
        repeat(2) { assertFailsWith<WrongPinException> { v.unlock(pin("111222")) } }
        File(dir, "attempts").writeBytes(fresh)
        assertEquals(1, v.remainingAttempts())
        // Rewriting every copy needs root and was already possible with one file; that limit
        // is documented in docs/POC.md (rollback on rooted devices).
    }

    // AC-50c: one damaged or missing item key / metadata file does not lose the item.

    @Test
    fun `item survives losing its main key file, also across restarts`() {
        val content = Aead.randomBytes(7000)
        val (v, id) = vaultWithOneItem(content)
        File(dir, "items/$id/key").delete()
        v.lock()
        val restarted = newVault()
        restarted.unlock(pinOk)
        assertEquals(id, restarted.list().single().id)
        assertContentEquals(content, readAll(restarted, id))
    }

    @Test
    fun `item survives corrupted key and metadata files`() {
        val content = Aead.randomBytes(7000)
        val (v, id) = vaultWithOneItem(content)
        flipLastByte(File(dir, "items/$id/key"))
        flipLastByte(File(dir, "items/$id/meta"))
        assertEquals(id, v.list().single().id)
        assertContentEquals(content, readAll(v, id))
    }

    @Test
    fun `damaged item key copy is repaired after a successful read`() {
        val (v, id) = vaultWithOneItem()
        val good = File(dir, "items/$id/key").readBytes()
        flipLastByte(File(dir, "items/$id/key"))
        v.list()
        assertContentEquals(good, File(dir, "items/$id/key").readBytes())
    }

    @Test
    fun `item folder that lost both key copies is hidden but never deleted automatically`() {
        val (v, id) = vaultWithOneItem()
        File(dir, "items/$id/key").delete()
        File(dir, "items/$id/key.bak").delete()
        assertTrue(v.list().isEmpty())
        v.lock()
        newVault()
        assertTrue(File(dir, "items/$id/data").exists())
    }

    @Test
    fun `a delete interrupted by a crash is finished on restart, not left half-done`() {
        val (v, id) = vaultWithOneItem()
        // Crash right after the tombstone was written.
        File(dir, "items/$id/deleted").writeBytes(ByteArray(0))
        v.lock()
        val restarted = newVault()
        restarted.unlock(pinOk)
        assertTrue(restarted.list().isEmpty())
        assertFalse(File(dir, "items/$id").exists())
    }

    // AC-50d: an in-app capture exists nowhere else, so it is kept until its encrypted copy
    // is verified, across failures and restarts.

    @Test
    fun `capture waits in the holding area until it is imported`() {
        val content = Aead.randomBytes(30_000)
        val v = newVault()
        v.create(pinOk)
        val capture = File(dir, "cam.jpg").apply { writeBytes(content) }
        val inbox = PendingImports(File(dir, "pending"))
        val held = inbox.stash(capture, ItemKind.PHOTO)
        assertFalse(capture.exists())

        // Import fails (app went to background and locked): the capture is kept.
        v.lock()
        assertFailsWith<VaultStateException> { inbox.importOne(v, held, "image/jpeg") }
        assertTrue(held.exists())

        // App is killed and restarted: still there, and imported on the next unlock.
        val restarted = newVault()
        restarted.unlock(pinOk)
        assertEquals(listOf(held), inbox.pending())
        assertTrue(inbox.importOne(restarted, inbox.pending().single(), "image/jpeg").safeToDeleteOriginal)
        assertTrue(inbox.pending().isEmpty())
        assertContentEquals(content, readAll(restarted, restarted.list().single().id))
    }

    @Test
    fun `capture is kept when the encrypted copy does not verify`() {
        val v = newVault()
        v.create(pinOk)
        val inbox = PendingImports(File(dir, "pending"))
        val held = inbox.stash(File(dir, "cam.mp4").apply { writeBytes(Aead.randomBytes(9000)) }, ItemKind.VIDEO)
        // Simulate the vault being destroyed by another object mid-way: import is refused.
        newVault().destroy()
        assertFailsWith<VaultDestroyedException> { inbox.importOne(v, held, "video/mp4") }
        assertTrue(held.exists())
    }

    @Test
    fun `waiting captures are removed with the vault so they never reach a new vault`() {
        val v = newVault()
        v.create(pinOk)
        val inbox = PendingImports(File(dir, "pending"))
        inbox.stash(File(dir, "cam.jpg").apply { writeBytes(Aead.randomBytes(100)) }, ItemKind.PHOTO)
        v.destroy()
        inbox.clear()
        assertTrue(inbox.pending().isEmpty())
    }

    @Test
    fun `half-written holding copies are ignored`() {
        val inbox = PendingImports(File(dir, "pending").apply { mkdirs() })
        File(dir, "pending/abc.photo.tmp").writeBytes(byteArrayOf(1, 2))
        assertTrue(inbox.pending().isEmpty())
    }

    // AC-50e: originals are never reported deletable unless the vault copy matches them.

    @Test
    fun `original is deletable only when the vault copy matches it byte for byte`() {
        val v = newVault()
        v.create(pinOk)
        val original = Aead.randomBytes(12_000)
        assertFalse(v.importItem(original.inputStream(), photo).safeToDeleteOriginal)
        assertFailsWith<ImportVerificationException> {
            v.importItem(original.copyOf(11_000).inputStream(), photo, expectedSha256 = sha256(original))
        }
        assertTrue(v.importItem(original.inputStream(), photo, expectedSha256 = sha256(original)).safeToDeleteOriginal)
        assertEquals(2, v.list().size)
    }

    // AC-50f: vaults written by the first test build (no backup copies) keep working.

    @Test
    fun `vault from the previous format without backup files still opens`() {
        val content = Aead.randomBytes(4000)
        val (v, id) = vaultWithOneItem(content)
        v.lock()
        listOf("vault.key.bak", "attempts.bak", "items/$id/key.bak", "items/$id/meta.bak").forEach { File(dir, it).delete() }
        val restarted = newVault()
        restarted.unlock(pinOk)
        assertContentEquals(content, readAll(restarted, id))
        assertTrue(File(dir, "vault.key.bak").exists(), "backup is added on first unlock")
    }
}
