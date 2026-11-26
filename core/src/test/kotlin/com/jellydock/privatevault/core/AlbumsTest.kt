package com.jellydock.privatevault.core

import org.junit.jupiter.api.io.TempDir
import java.io.File
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Albums are sealed labels: they never touch a photo, and survive a lost main copy. */
class AlbumsTest {
    @TempDir
    lateinit var dir: File

    private val hw = FakeHardwareKey()

    private fun newVault() = Vault(dir, hw, TEST_PARAMS, chunkSize = 4096, clock = FakeClock())

    private val photo = ItemMeta(ItemKind.PHOTO, "image/jpeg", 1_700_000_000_000)

    @Test
    fun `album list is sealed, read back, and kept across lock and unlock`() {
        val v = newVault().apply { create(pin("482915")) }
        assertNull(v.readAlbums())
        val data = """{"v":1,"albums":[{"id":"a1","name":"secret trip","items":[]}]}""".toByteArray()
        v.writeAlbums(data)
        assertContentEquals(data, v.readAlbums())
        assertFalse(String(File(dir, "albums").readBytes(), Charsets.ISO_8859_1).contains("secret trip"))
        v.lock()
        assertFailsWith<VaultStateException> { v.readAlbums() }
        v.unlock(pin("482915"))
        assertContentEquals(data, v.readAlbums())
    }

    @Test
    fun `damaged main copy falls back to the second copy`() {
        val v = newVault().apply { create(pin("482915")) }
        val data = "albums".toByteArray()
        v.writeAlbums(data)
        File(dir, "albums").writeBytes(byteArrayOf(1, 2, 3))
        assertContentEquals(data, v.readAlbums())
        File(dir, "albums").delete()
        assertContentEquals(data, v.readAlbums())
    }

    @Test
    fun `writing albums never changes any item`() {
        val v = newVault().apply { create(pin("482915")) }
        val id = v.importItem(Aead.randomBytes(5000).inputStream(), photo).item.id
        val before = v.list()
        v.writeAlbums("""{"v":1,"albums":[{"id":"a","name":"x","items":["$id"]}]}""".toByteArray())
        v.writeAlbums("""{"v":1,"albums":[]}""".toByteArray())
        assertEquals(before, v.list())
    }

    @Test
    fun `incoming lists wait until cleared, and destroy removes all album data`() {
        val v = newVault().apply { create(pin("482915")) }
        v.addIncomingAlbums(AlbumOrigin.BACKUP, "one".toByteArray())
        v.addIncomingAlbums(AlbumOrigin.TRANSFER, "two".toByteArray())
        val got = v.incomingAlbums()
        assertEquals(listOf(AlbumOrigin.BACKUP, AlbumOrigin.TRANSFER).toSet(), got.map { it.origin }.toSet())
        v.clearIncomingAlbums(listOf("../vault.key", got.first().name))
        assertEquals(1, v.incomingAlbums().size)
        assertTrue(File(dir, "vault.key").exists())
        v.writeAlbums("x".toByteArray())
        v.destroy()
        assertFalse(File(dir, "albums").exists())
        assertFalse(File(dir, "albums.bak").exists())
        assertFalse(File(dir, "albums.in").exists())
    }

    @Test
    fun `too large album list is refused`() {
        val v = newVault().apply { create(pin("482915")) }
        assertFailsWith<IllegalArgumentException> { v.writeAlbums(ByteArray(Vault.MAX_ALBUMS + 1)) }
    }
}
