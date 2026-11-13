package com.jellydock.privatevault.core

import org.junit.jupiter.api.io.TempDir
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class VaultTest {
    @TempDir
    lateinit var dir: File

    private val hw = FakeHardwareKey()

    private val clock = FakeClock()

    private fun newVault() = Vault(dir, hw, TEST_PARAMS, chunkSize = 4096, clock = clock)

    private val photo = ItemMeta(ItemKind.PHOTO, "image/jpeg", 1_700_000_000_000)

    private fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes)

    private fun readAll(
        v: Vault,
        id: String,
    ) = ByteArrayOutputStream().also { v.read(id, it) }.toByteArray()

    @Test
    fun `imported photo can be listed and read after relock`() {
        val v = newVault()
        v.create(pin("482915"))
        val content = Aead.randomBytes(20_000)
        val result = v.importItem(content.inputStream(), photo, thumbnail = byteArrayOf(1, 2, 3), expectedSha256 = sha256(content))
        assertTrue(result.safeToDeleteOriginal)
        v.lock()
        assertFailsWith<VaultStateException> { v.list() }
        v.unlock(pin("482915"))
        val item = v.list().single()
        assertEquals(20_000, item.meta.sizeBytes)
        assertContentEquals(content, readAll(v, item.id))
        assertContentEquals(byteArrayOf(1, 2, 3), v.thumbnail(item.id))
    }

    @Test
    fun `no plaintext or metadata appears anywhere on disk`() {
        val v = newVault()
        v.create(pin("482915"))
        val marker = "SECRET-PASSPORT-SCAN-".repeat(500).toByteArray()
        v.importItem(marker.inputStream(), photo.copy(mimeType = "image/x-very-unique-type"))
        dir.walk().filter { it.isFile }.forEach { file ->
            val text = String(file.readBytes(), Charsets.ISO_8859_1)
            assertFalse(text.contains("SECRET-PASSPORT"), "plaintext in ${file.name}")
            assertFalse(text.contains("very-unique"), "metadata in ${file.name}")
        }
    }

    @Test
    fun `failed import registers nothing and does not allow deleting the original`() {
        val v = newVault()
        v.create(pin("482915"))
        val broken =
            object : InputStream() {
                var n = 0

                override fun read(): Int = if (n++ < 10_000) 7 else throw IOException("source vanished")
            }
        assertFailsWith<IOException> { v.importItem(broken, photo) }
        assertTrue(v.list().isEmpty())
        assertTrue(File(dir, "staging").listFiles().isNullOrEmpty())
    }

    @Test
    fun `interrupted import leftovers are cleared on next start`() {
        File(dir, "staging/abc").mkdirs()
        File(dir, "staging/abc/data").writeBytes(byteArrayOf(1, 2, 3))
        newVault()
        assertFalse(File(dir, "staging").exists())
    }

    @Test
    fun `deleted item cannot be read even if its ciphertext is restored`() {
        val v = newVault()
        v.create(pin("482915"))
        val id = v.importItem(Aead.randomBytes(5000).inputStream(), photo).item.id
        val data = File(dir, "items/$id/data").readBytes()
        v.delete(id)
        assertTrue(v.list().isEmpty())
        File(dir, "items/$id").mkdirs()
        File(dir, "items/$id/data").writeBytes(data)
        assertTrue(v.list().isEmpty())
        assertFailsWith<Exception> { readAll(v, id) }
    }

    @Test
    fun `video chunks can be read one at a time`() {
        val v = newVault()
        v.create(pin("482915"))
        val video = Aead.randomBytes(4096 * 3 + 100)
        val id = v.importItem(video.inputStream(), ItemMeta(ItemKind.VIDEO, "video/mp4", 1)).item.id
        assertContentEquals(video.copyOfRange(4096, 8192), v.readChunk(id, 1))
    }

    @Test
    fun `wrong PINs never erase the photos, they only make the next try wait`() {
        val v = newVault()
        v.create(pin("482915"))
        val content = Aead.randomBytes(100)
        val id = v.importItem(content.inputStream(), photo).item.id
        v.lock()
        repeat(6) {
            v.lockedForMs().let { w -> if (w > 0) clock.advance(w) }
            assertFailsWith<WrongPinException> { v.unlock(pin("00000$it")) }
        }
        assertFailsWith<LockedOutException> { v.unlock(pin("482915")) }
        assertTrue(File(dir, "items/$id").exists())
        clock.advance(v.lockedForMs())
        v.unlock(pin("482915"))
        assertContentEquals(content, readAll(v, id))
    }

    @Test
    fun `destroy removes keys and files`() {
        val v = newVault()
        v.create(pin("482915"))
        v.importItem(Aead.randomBytes(100).inputStream(), photo)
        v.destroy()
        assertFalse(v.isUnlocked)
        assertFalse(File(dir, "items").exists())
        assertFailsWith<VaultDestroyedException> { v.unlock(pin("482915")) }
    }

    @Test
    fun `import without an independent hash never allows deleting the original`() {
        val v = newVault()
        v.create(pin("482915"))
        assertFalse(v.importItem(Aead.randomBytes(100).inputStream(), photo).safeToDeleteOriginal)
    }

    @Test
    fun `source cut short is caught by the caller's hash and nothing is registered`() {
        val v = newVault()
        v.create(pin("482915"))
        val original = Aead.randomBytes(10_000)
        // The source stream ends early without an error (e.g. a cloud photo not fully downloaded).
        val truncated = original.copyOf(6_000).inputStream()
        assertFailsWith<ImportVerificationException> { v.importItem(truncated, photo, expectedSha256 = sha256(original)) }
        assertTrue(v.list().isEmpty())
        assertTrue(File(dir, "staging").listFiles().isNullOrEmpty())
    }

    @Test
    fun `creating over an existing vault fails and keeps its photos`() {
        val v = newVault()
        v.create(pin("482915"))
        v.importItem(Aead.randomBytes(100).inputStream(), photo)
        assertFailsWith<VaultStateException> { v.create(pin("592016")) }
        assertEquals(1, v.list().size)
    }

    @Test
    fun `missing chip key keeps the photos on disk`() {
        val v = newVault()
        v.create(pin("482915"))
        v.importItem(Aead.randomBytes(100).inputStream(), photo)
        v.lock()
        val gone =
            object : HardwareKey by hw {
                override fun exists() = false
            }
        val glitched = Vault(dir, gone, TEST_PARAMS, chunkSize = 4096)
        assertFailsWith<KeysUnavailableException> { glitched.unlock(pin("482915")) }
        assertTrue(File(dir, "items").listFiles()!!.isNotEmpty())
        v.unlock(pin("482915"))
        assertEquals(1, v.list().size)
    }

    @Test
    fun `wrong PINs during PIN change never erase the photos`() {
        val v = newVault()
        v.create(pin("482915"))
        v.importItem(Aead.randomBytes(100).inputStream(), photo)
        repeat(3) { assertFailsWith<WrongPinException> { v.changePin(pin("00000$it"), pin("73920184")) } }
        assertFailsWith<LockedOutException> { v.changePin(pin("000009"), pin("73920184")) }
        assertEquals(1, File(dir, "items").listFiles()!!.size)
    }

    @Test
    fun `junk folders and half-deleted items are ignored or cleaned up`() {
        val v = newVault()
        v.create(pin("482915"))
        v.importItem(Aead.randomBytes(100).inputStream(), photo)
        File(dir, "items/not-an-id").mkdirs()
        File(dir, "items/not-an-id/key").writeBytes(byteArrayOf(1))
        val orphan = File(dir, "items/" + "ab".repeat(16)).apply { mkdirs() }
        File(orphan, "data").writeBytes(byteArrayOf(1, 2, 3))
        val noMeta = File(dir, "items/" + "cd".repeat(16)).apply { mkdirs() }
        File(noMeta, "key").writeBytes(Aead.randomBytes(60))
        assertEquals(1, v.list().size)
        newVault()
        // Never removed automatically (AC-50): hidden, but kept on disk.
        assertTrue(orphan.exists())
        assertEquals(1, v.list().size)
    }

    @Test
    fun `locking during an import does not corrupt the stored item`() {
        val v = newVault()
        v.create(pin("482915"))
        val content = Aead.randomBytes(20_000)
        val slow =
            object : InputStream() {
                val inner = content.inputStream()
                var locked = false

                override fun read(): Int {
                    if (!locked) {
                        v.lock()
                        locked = true
                    }
                    return inner.read()
                }
            }
        val id = v.importItem(slow, photo).item.id
        v.unlock(pin("482915"))
        assertContentEquals(content, readAll(v, id))
    }

    @Test
    fun `fresh install wipes leftover chip keys when the folder is empty`() {
        val v = newVault()
        hw.create() // left in the security chip by an earlier install
        assertTrue(v.wipeLeftoversForFreshInstall())
        assertFalse(hw.exists())
    }

    @Test
    fun `a lost install marker never wipes a vault that is still here`() {
        val v = newVault()
        v.create(pin("482915"))
        val content = Aead.randomBytes(100)
        val id = v.importItem(content.inputStream(), photo).item.id
        v.lock()
        assertFalse(v.wipeLeftoversForFreshInstall())
        assertTrue(hw.exists())
        v.unlock(pin("482915"))
        assertContentEquals(content, readAll(v, id))
        // Photos without key files (keys lost) are kept too: only the owner may remove them.
        File(dir, "vault.key").delete()
        File(dir, "vault.key.bak").delete()
        File(dir, "vault.key.check").delete()
        assertFalse(v.wipeLeftoversForFreshInstall())
        assertTrue(File(dir, "items/$id").exists())
    }

    @Test
    fun `temp files left by a crash are shredded on start`() {
        val v = newVault()
        v.create(pin("482915"))
        val tmp = File(dir, "vault.key.crash.tmp").apply { writeBytes(byteArrayOf(1, 2, 3)) }
        newVault()
        assertFalse(tmp.exists())
    }

    @Test
    fun `lock during the PIN check keeps the vault locked`() {
        lateinit var v: Vault
        val locking =
            object : HardwareKey by hw {
                var armed = false

                override fun mix(data: ByteArray): ByteArray {
                    if (armed) v.lock()
                    return hw.mix(data)
                }
            }
        v = Vault(dir, locking, TEST_PARAMS, chunkSize = 4096)
        v.create(pin("482915"))
        v.lock()
        locking.armed = true
        assertFailsWith<VaultStateException> { v.unlock(pin("482915")) }
        assertFalse(v.isUnlocked)
        locking.armed = false
        v.unlock(pin("482915"))
        assertTrue(v.isUnlocked)
    }

    @Test
    fun `import through a stale object after another one destroyed the vault is refused`() {
        val a = newVault()
        a.create(pin("482915"))
        newVault().destroy()
        val content = Aead.randomBytes(1000)
        assertFailsWith<VaultDestroyedException> { a.importItem(content.inputStream(), photo, expectedSha256 = sha256(content)) }
    }

    @Test
    fun `import through a stale object after the vault was recreated is refused`() {
        val a = newVault()
        a.create(pin("482915"))
        newVault().apply {
            destroy()
            create(pin("592016"))
        }
        val content = Aead.randomBytes(1000)
        assertFailsWith<VaultDestroyedException> { a.importItem(content.inputStream(), photo, expectedSha256 = sha256(content)) }
        assertTrue(File(dir, "items").listFiles().isNullOrEmpty())
    }

    @Test
    fun `item ids cannot escape the vault folder`() {
        val v = newVault()
        v.create(pin("482915"))
        assertFailsWith<IllegalArgumentException> { v.delete("../../etc") }
    }

    @Test
    fun `search note is sealed, kept per item and removed with the item`() {
        val v = newVault()
        v.create(pin("482915"))
        val content = Aead.randomBytes(3000)
        val id = v.importItem(content.inputStream(), photo).item.id
        assertEquals(null, v.readSearchNote(id))
        val note = """{"text":"UNIQUE-RECEIPT-WORD americano"}""".toByteArray()
        v.writeSearchNote(id, note)
        // Never stored in the clear.
        dir.walk().filter { it.isFile }.forEach { file ->
            assertFalse(String(file.readBytes(), Charsets.ISO_8859_1).contains("UNIQUE-RECEIPT"), "plaintext note in ${file.name}")
        }
        v.lock()
        assertFailsWith<VaultStateException> { v.readSearchNote(id) }
        v.unlock(pin("482915"))
        assertContentEquals(note, v.readSearchNote(id))
        // The photo itself is untouched.
        assertContentEquals(content, readAll(v, id))
        // A damaged note is treated as missing (the photo is just read again).
        val file = File(File(File(dir, "items"), id), "search")
        file.writeBytes(file.readBytes().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 1).toByte() })
        assertEquals(null, v.readSearchNote(id))
        assertContentEquals(content, readAll(v, id))
        v.writeSearchNote(id, note)
        v.delete(id)
        assertFalse(File(File(dir, "items"), id).exists())
        assertFailsWith<Exception> { v.writeSearchNote(id, note) }
    }
}
