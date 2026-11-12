package com.jellydock.privatevault.core

import org.junit.jupiter.api.io.TempDir
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/** Encrypted backup + recovery key: photos survive deleting the app or losing the phone. */
class BackupTest {
    @TempDir
    lateinit var tmp: File

    private val photo = ItemMeta(ItemKind.PHOTO, "image/jpeg", 1_700_000_000_000)
    private val video = ItemMeta(ItemKind.VIDEO, "video/mp4", 1_700_000_100_000)

    private fun phone(name: String) = Vault(File(tmp, name), FakeHardwareKey(), TEST_PARAMS, chunkSize = 4096, clock = FakeClock())

    private fun folder() = LocalBackupFolder(File(tmp, "icloud/Private Vision Vault Backup"))

    private fun read(
        v: Vault,
        id: String,
    ): ByteArray = ByteArrayOutputStream().also { v.read(id, it) }.toByteArray()

    private fun vaultWith(vararg contents: ByteArray): Pair<Vault, List<String>> {
        val v = phone("old")
        v.create(pin("482915"))
        val ids =
            contents.mapIndexed { i, c ->
                v.importItem(c.inputStream(), if (i % 2 == 0) photo else video, thumbnail = byteArrayOf(9, i.toByte())).item.id
            }
        return v to ids
    }

    @Test
    fun `recovery key text round trips and tolerates typing differences`() {
        repeat(50) {
            val key = RecoveryKey.generate()
            val text = RecoveryKey.format(key)
            assertEquals(64, text.length) // 52 characters + 12 dashes
            assertContentEquals(key, RecoveryKey.parse(text))
            assertContentEquals(key, RecoveryKey.parse(text.lowercase().replace("-", " ")))
            assertContentEquals(key, RecoveryKey.parse(text.replace('0', 'O').replace('1', 'l')))
        }
        assertFailsWith<IllegalArgumentException> { RecoveryKey.parse("ABCD-EFGH") }
        assertFailsWith<IllegalArgumentException> { RecoveryKey.parse("U".repeat(52)) }
    }

    @Test
    fun `app deleted - new install restores every photo and video with the recovery key`() {
        val a = Aead.randomBytes(30_000)
        val b = Aead.randomBytes(10_000)
        val empty = ByteArray(0)
        val (old, ids) = vaultWith(a, b, empty)
        val keyText = RecoveryKey.format(old.createRecoveryKey())
        val report = old.backupTo(folder())
        assertEquals(BackupReport(3, 0, 3), report)

        // The app is deleted: its folder is gone. A new install creates a new vault and PIN.
        File(tmp, "old").deleteRecursively()
        val fresh = phone("new")
        Vault.checkBackup(folder(), RecoveryKey.parse(keyText))
        fresh.create(pin("739201"))
        var lastProgress = 0 to 0
        val restored = fresh.restoreFrom(folder(), RecoveryKey.parse(keyText)) { d, t -> lastProgress = d to t }
        assertEquals(RestoreReport(3, 0, 0), restored)
        assertEquals(3 to 3, lastProgress)
        assertEquals(ids.toSet(), fresh.list().map { it.id }.toSet())
        assertContentEquals(a, read(fresh, ids[0]))
        assertContentEquals(b, read(fresh, ids[1]))
        assertContentEquals(empty, read(fresh, ids[2]))
        assertEquals(ItemKind.VIDEO, fresh.list().first { it.id == ids[1] }.meta.kind)
        assertContentEquals(byteArrayOf(9, 1), fresh.thumbnail(ids[1]))
        // The new vault keeps the same recovery key, so backups continue in the same folder.
        assertEquals(keyText, RecoveryKey.format(fresh.recoveryKey()!!))
        assertTrue(fresh.isRecoveryKeyConfirmed())
        assertEquals(BackupReport(0, 0, 3), fresh.backupTo(folder()))
        // Restoring again changes nothing.
        assertEquals(RestoreReport(0, 3, 0), fresh.restoreFrom(folder(), RecoveryKey.parse(keyText)))
    }

    @Test
    fun `wrong recovery key or empty folder is refused and nothing is restored`() {
        val (old, _) = vaultWith(Aead.randomBytes(5000))
        old.createRecoveryKey()
        old.backupTo(folder())
        val fresh = phone("new")
        fresh.create(pin("739201"))
        assertFailsWith<BackupKeyMismatchException> { Vault.checkBackup(folder(), RecoveryKey.generate()) }
        assertFailsWith<BackupKeyMismatchException> { fresh.restoreFrom(folder(), RecoveryKey.generate()) }
        assertTrue(fresh.list().isEmpty())
        assertFalse(fresh.hasRecoveryKey())
        assertFailsWith<NotABackupException> { Vault.checkBackup(LocalBackupFolder(File(tmp, "empty")), RecoveryKey.generate()) }
    }

    @Test
    fun `backup holds no plaintext and only new items are written`() {
        val secret = "TOP-SECRET-PHOTO-BYTES".repeat(500).toByteArray()
        val (v, _) = vaultWith(secret)
        v.createRecoveryKey()
        assertEquals(BackupReport(1, 0, 1), v.backupTo(folder()))
        assertEquals(BackupReport(0, 0, 1), v.backupTo(folder()))
        v.importItem(Aead.randomBytes(100).inputStream(), photo)
        assertEquals(BackupReport(1, 0, 2), v.backupTo(folder()))
        val needle = "TOP-SECRET".toByteArray()
        File(tmp, "icloud").walkTopDown().filter { it.isFile }.forEach { f ->
            val bytes = f.readBytes()
            assertFalse((0..bytes.size - needle.size).any { i -> needle.indices.all { bytes[i + it] == needle[it] } }, f.name)
        }
    }

    @Test
    fun `only items the user deleted leave the backup`() {
        val (v, ids) = vaultWith(Aead.randomBytes(100), Aead.randomBytes(100), Aead.randomBytes(100))
        v.createRecoveryKey()
        v.backupTo(folder())
        v.delete(ids[0])
        // ids[1] gets damaged on the phone: it is hidden, but its backup copy must stay.
        File(tmp, "old/items/${ids[1]}/key").delete()
        File(tmp, "old/items/${ids[1]}/key.bak").delete()
        assertEquals(BackupReport(0, 1, 1), v.backupTo(folder()))
        val names = folder().list()
        assertFalse("${ids[0]}.pvb" in names)
        assertTrue("${ids[1]}.pvb" in names)
        assertTrue("${ids[2]}.pvb" in names)
    }

    @Test
    fun `damaged or cut short backup files are skipped, the rest is restored`() {
        val (old, ids) = vaultWith(Aead.randomBytes(20_000), Aead.randomBytes(20_000), Aead.randomBytes(20_000))
        val rk = old.createRecoveryKey()
        old.backupTo(folder())
        val dir = File(tmp, "icloud/Private Vision Vault Backup")
        File(dir, "${ids[0]}.pvb").let { f -> f.writeBytes(f.readBytes().copyOf(f.length().toInt() - 100)) }
        File(dir, "${ids[1]}.pvb").let { f ->
            val b = f.readBytes()
            b[b.size - 5] = (b[b.size - 5].toInt() xor 1).toByte()
            f.writeBytes(b)
        }
        // A file renamed to another item's id is refused too.
        File(dir, "${ids[2]}.pvb").copyTo(File(dir, "0123456789abcdef0123456789abcdef.pvb"))
        val fresh = phone("new")
        fresh.create(pin("739201"))
        assertEquals(RestoreReport(1, 0, 3), fresh.restoreFrom(folder(), rk))
        assertEquals(listOf(ids[2]), fresh.list().map { it.id })
        assertTrue(File(tmp, "new/staging").listFiles().isNullOrEmpty())
    }

    @Test
    fun `a folder with another vault's backup is never mixed`() {
        val (a, _) = vaultWith(Aead.randomBytes(100))
        a.createRecoveryKey()
        a.backupTo(folder())
        val b = phone("other")
        b.create(pin("739201"))
        b.importItem(Aead.randomBytes(100).inputStream(), photo)
        b.createRecoveryKey()
        assertFailsWith<BackupKeyMismatchException> { b.backupTo(folder()) }
        assertEquals(1, Vault.backupItemCount(folder()))
    }

    @Test
    fun `recovery key needs the vault unlocked, survives lock, and is cleared by reset`() {
        val (v, _) = vaultWith(Aead.randomBytes(100))
        assertFalse(v.hasRecoveryKey())
        assertFailsWith<NoRecoveryKeyException> { v.backupTo(folder()) }
        val rk = v.createRecoveryKey()
        assertContentEquals(rk, v.createRecoveryKey())
        // Shown but not yet confirmed: the app keeps asking until the user checks their copy.
        assertFalse(v.isRecoveryKeyConfirmed())
        v.confirmRecoveryKey()
        assertTrue(v.isRecoveryKeyConfirmed())
        v.lock()
        assertTrue(v.hasRecoveryKey())
        assertFailsWith<VaultStateException> { v.recoveryKey() }
        v.unlock(pin("482915"))
        assertContentEquals(rk, v.recoveryKey())
        // One damaged copy of the sealed key is repaired from the other.
        File(tmp, "old/recovery.key").writeBytes(ByteArray(40))
        assertContentEquals(rk, v.recoveryKey())
        v.backupTo(folder())
        v.destroy()
        assertFalse(v.hasRecoveryKey())
        assertFalse(v.isRecoveryKeyConfirmed())
        // The user's backup folder is left alone.
        assertEquals(1, Vault.backupItemCount(folder()))
        v.create(pin("739201"))
        assertNotEquals(RecoveryKey.format(rk), RecoveryKey.format(v.createRecoveryKey()))
    }

    @Test
    fun `interrupted backup write leaves no half file that counts as done`() {
        val (v, ids) = vaultWith(Aead.randomBytes(10_000))
        v.createRecoveryKey()
        val failing =
            object : BackupFolder by folder() {
                override fun write(
                    name: String,
                    block: (java.io.OutputStream) -> Unit,
                ) {
                    if (name.endsWith(".pvb")) throw java.io.IOException("disk full")
                    folder().write(name, block)
                }
            }
        assertFailsWith<java.io.IOException> { v.backupTo(failing) }
        assertFalse("${ids[0]}.pvb" in folder().list())
        assertEquals(BackupReport(1, 0, 1), v.backupTo(folder()))
    }

    @Test
    fun `a copy cut short by the storage provider is written again`() {
        val (v, ids) = vaultWith(Aead.randomBytes(20_000), Aead.randomBytes(20_000))
        val rk = v.createRecoveryKey()
        assertEquals(BackupReport(2, 0, 2), v.backupTo(folder()))
        val dir = File(tmp, "icloud/Private Vision Vault Backup")
        File(dir, "${ids[0]}.pvb").writeBytes(ByteArray(0))
        File(dir, "${ids[1]}.pvb").let { f -> f.writeBytes(f.readBytes().copyOf(f.length().toInt() - 1)) }
        assertEquals(BackupReport(2, 0, 2), v.backupTo(folder()))
        assertEquals(BackupReport(0, 0, 2), v.backupTo(folder()))
        val fresh = phone("new")
        fresh.create(pin("739201"))
        assertEquals(RestoreReport(2, 0, 0), fresh.restoreFrom(folder(), rk))
    }

    @Test
    fun `a damaged thumbnail never stops the photo from being backed up and restored`() {
        val content = Aead.randomBytes(8_000)
        val (v, ids) = vaultWith(content)
        val rk = v.createRecoveryKey()
        File(tmp, "old/items/${ids[0]}/thumb").writeBytes(ByteArray(40))
        assertEquals(BackupReport(1, 0, 1), v.backupTo(folder()))
        // Nothing to rewrite: a copy without the thumbnail counts as complete.
        assertEquals(BackupReport(0, 0, 1), v.backupTo(folder()))
        val fresh = phone("new")
        fresh.create(pin("739201"))
        assertEquals(RestoreReport(1, 0, 0), fresh.restoreFrom(folder(), rk))
        assertContentEquals(content, read(fresh, ids[0]))
        assertEquals(null, fresh.thumbnail(ids[0]))
    }

    @Test
    fun `a delete the folder refuses stays in the log and is tried again`() {
        val (v, ids) = vaultWith(Aead.randomBytes(100), Aead.randomBytes(100))
        v.createRecoveryKey()
        v.backupTo(folder())
        v.delete(ids[0])
        val stubborn =
            object : BackupFolder by folder() {
                override fun delete(name: String): Unit = throw java.io.IOException("not downloaded")
            }
        assertEquals(BackupReport(0, 0, 1), v.backupTo(stubborn))
        assertTrue("${ids[0]}.pvb" in folder().list())
        assertEquals(BackupReport(0, 1, 1), v.backupTo(folder()))
        assertFalse("${ids[0]}.pvb" in folder().list())
    }

    // Android <-> iPhone: the same backup format on both (fixtures made by each side).

    private val fixtures = File("src/test/resources/backup-fixtures")

    private fun fixtureContent(index: Int): ByteArray =
        if (index == 0) ByteArray(5000) { (it * 7 % 256).toByte() } else ByteArray(70_000) { (it * 13 % 251).toByte() }

    /** Run with PV_WRITE_FIXTURE=1 to (re)create the Kotlin-made fixture. */
    @Test
    fun `write kotlin fixture`() {
        if (System.getenv("PV_WRITE_FIXTURE") != "1") return
        val v = phone("fixture")
        v.create(pin("482915"))
        v.importItem(fixtureContent(0).inputStream(), photo, thumbnail = byteArrayOf(1, 2, 3))
        v.importItem(fixtureContent(1).inputStream(), video)
        val rk = v.createRecoveryKey()
        val out = File(fixtures, "kotlin")
        out.deleteRecursively()
        v.backupTo(LocalBackupFolder(out))
        File(out, "key.txt").writeText(RecoveryKey.format(rk))
    }

    @Test
    fun `restores a backup made on iPhone`() {
        val dir = File(fixtures, "swift")
        val v = phone("fromIphone")
        v.create(pin("482915"))
        val rk = RecoveryKey.parse(File(dir, "key.txt").readText())
        assertEquals(RestoreReport(2, 0, 0), v.restoreFrom(LocalBackupFolder(dir), rk))
        val photoItem = v.list().first { it.meta.kind == ItemKind.PHOTO }
        val videoItem = v.list().first { it.meta.kind == ItemKind.VIDEO }
        assertContentEquals(fixtureContent(0), read(v, photoItem.id))
        assertContentEquals(fixtureContent(1), read(v, videoItem.id))
        assertContentEquals(byteArrayOf(1, 2, 3), v.thumbnail(photoItem.id))
    }
}
