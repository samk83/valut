package com.jellydock.privatevault.core

import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class VaultKeyManagerTest {
    @TempDir
    lateinit var dir: File

    private val hw = FakeHardwareKey()

    private fun manager(
        counter: AttemptCounter = FileAttemptCounter(File(dir, "attempts")),
        key: HardwareKey = hw,
    ) = VaultKeyManager(File(dir, "vault.key"), counter, key, TEST_PARAMS)

    @Test
    fun `correct PIN returns the same master key`() {
        val m = manager()
        val mk = m.create(pin("482915"))
        assertContentEquals(mk, m.unlock(pin("482915")))
    }

    @Test
    fun `wrong PIN reports remaining attempts and correct PIN resets the count`() {
        val m = manager()
        m.create(pin("482915"))
        assertEquals(2, assertFailsWith<WrongPinException> { m.unlock(pin("000001")) }.remainingAttempts)
        assertEquals(1, assertFailsWith<WrongPinException> { m.unlock(pin("000002")) }.remainingAttempts)
        m.unlock(pin("482915"))
        assertEquals(3, m.remainingAttempts())
    }

    @Test
    fun `third wrong PIN destroys the keys and the correct PIN no longer works`() {
        val m = manager()
        m.create(pin("482915"))
        assertFailsWith<WrongPinException> { m.unlock(pin("000001")) }
        assertFailsWith<WrongPinException> { m.unlock(pin("000002")) }
        assertFailsWith<VaultDestroyedException> { m.unlock(pin("000003")) }
        assertFalse(hw.exists())
        assertFalse(File(dir, "vault.key").exists())
        assertFailsWith<VaultDestroyedException> { m.unlock(pin("482915")) }
    }

    @Test
    fun `restoring an old copy of the envelope does not bring the vault back`() {
        val m = manager()
        m.create(pin("482915"))
        val snapshot = File(dir, "vault.key").readBytes()
        repeat(3) { runCatching { m.unlock(pin("00000$it")) } }
        File(dir, "vault.key").writeBytes(snapshot)
        File(dir, "attempts").delete()
        File(dir, "attempts.bak").delete()
        // The hardware key is gone (on Android, rollback resistance guarantees it stays gone).
        assertFailsWith<KeysUnavailableException> { m.unlock(pin("482915")) }
        assertFailsWith<KeysUnavailableException> { m.unlock(pin("482915")) }
    }

    @Test
    fun `incomplete entries are not counted`() {
        val m = manager()
        m.create(pin("482915"))
        repeat(10) { assertFailsWith<IncompleteEntryException> { m.unlock(pin("12")) } }
        assertEquals(3, m.remainingAttempts())
    }

    @Test
    fun `attempt is recorded before the PIN is checked`() {
        // If the app is killed inside the check, this is what stays on disk.
        val counter = FileAttemptCounter(File(dir, "attempts"))
        val seen = mutableListOf<Int>()
        val spying =
            object : HardwareKey by hw {
                override fun mix(data: ByteArray): ByteArray {
                    seen += counter.read()
                    return hw.mix(data)
                }
            }
        val m = manager(counter = counter, key = spying)
        m.create(pin("482915"))
        seen.clear()
        runCatching { m.unlock(pin("000001")) }
        runCatching { m.unlock(pin("000002")) }
        assertEquals(listOf(1, 2), seen)
    }

    @Test
    fun `final attempt interrupted by a kill destroys the vault on next start`() {
        val m = manager()
        m.create(pin("482915"))
        // State left on disk when the process dies during the 3rd check.
        FileAttemptCounter(File(dir, "attempts")).write(3)
        assertFailsWith<VaultDestroyedException> { m.unlock(pin("482915")) }
        assertFalse(hw.exists())
    }

    @Test
    fun `destruction interrupted after the chip key is gone is finished on next start`() {
        val m = manager()
        m.create(pin("482915"))
        // Killed inside destroy: count set and chip key gone, envelope not yet shredded.
        FileAttemptCounter(File(dir, "attempts")).write(3)
        hw.destroy()
        assertFailsWith<VaultDestroyedException> { m.unlock(pin("482915")) }
        assertFalse(File(dir, "vault.key").exists())
        m.create(pin("592016"))
        assertTrue(m.exists())
    }

    @Test
    fun `leftover envelope temp copy is shredded on destruction`() {
        val m = manager()
        m.create(pin("482915"))
        val tmp = File(dir, "vault.key.crash.tmp").apply { writeBytes(File(dir, "vault.key").readBytes()) }
        repeat(3) { runCatching { m.unlock(pin("00000$it")) } }
        assertFalse(tmp.exists())
    }

    @Test
    fun `security chip error during the check is not counted and never destroys`() {
        val flaky =
            object : HardwareKey by hw {
                var fail = false

                override fun mix(data: ByteArray): ByteArray {
                    if (fail) throw IllegalStateException("keystore busy")
                    return hw.mix(data)
                }
            }
        val m = manager(key = flaky)
        m.create(pin("482915"))
        assertFailsWith<WrongPinException> { m.unlock(pin("000001")) }
        assertFailsWith<WrongPinException> { m.unlock(pin("000002")) }
        flaky.fail = true
        repeat(5) { assertFailsWith<IllegalStateException> { m.unlock(pin("482915")) } }
        assertEquals(1, m.remainingAttempts())
        assertTrue(hw.exists())
        flaky.fail = false
        m.unlock(pin("482915"))
        assertEquals(3, m.remainingAttempts())
    }

    @Test
    fun `parallel guesses cannot get more than three checks`() {
        val m = manager()
        m.create(pin("482915"))
        val before = hw.mixCalls
        val wrong = AtomicInteger()
        val destroyed = AtomicInteger()
        val threads =
            (1..12).map { i ->
                Thread {
                    try {
                        m.unlock(pin("90000$i".takeLast(6)))
                    } catch (e: WrongPinException) {
                        wrong.incrementAndGet()
                    } catch (e: VaultDestroyedException) {
                        destroyed.incrementAndGet()
                    }
                }
            }
        threads.forEach { it.start() }
        threads.forEach { it.join() }
        assertEquals(3, hw.mixCalls - before)
        assertEquals(2, wrong.get())
        assertEquals(10, destroyed.get())
        assertFalse(hw.exists())
    }

    @Test
    fun `two managers on the same files share one count`() {
        val a = manager()
        a.create(pin("482915"))
        val b = manager()
        assertFailsWith<WrongPinException> { a.unlock(pin("000001")) }
        assertEquals(1, assertFailsWith<WrongPinException> { b.unlock(pin("000002")) }.remainingAttempts)
    }

    @Test
    fun `missing security chip key is reported without destroying anything`() {
        val m = manager()
        m.create(pin("482915"))
        val gone =
            object : HardwareKey by hw {
                override fun exists() = false
            }
        val glitched = manager(key = gone)
        repeat(4) { assertFailsWith<KeysUnavailableException> { glitched.unlock(pin("000001")) } }
        assertTrue(File(dir, "vault.key").exists())
        assertEquals(3, m.remainingAttempts())
        m.unlock(pin("482915"))
    }

    @Test
    fun `failed counter write at creation leaves no vault`() {
        val broken =
            object : AttemptCounter {
                override fun read() = 0

                override fun write(value: Int) = throw java.io.IOException("disk full")
            }
        assertFailsWith<java.io.IOException> { manager(counter = broken).create(pin("482915")) }
        assertFalse(File(dir, "vault.key").exists())
    }

    @Test
    fun `out of range counter values leave only one attempt`() {
        val m = manager()
        m.create(pin("482915"))
        for (bad in listOf(-1, 4, Int.MAX_VALUE)) {
            FileAttemptCounter(File(dir, "attempts")).write(bad)
            assertEquals(1, m.remainingAttempts())
        }
    }

    @Test
    fun `malformed entries are refused without using an attempt`() {
        val m = manager()
        m.create(pin("482915"))
        for (bad in listOf("48a9xx", "4829 ", "1".repeat(PinPolicy.MAX_LENGTH + 1))) {
            assertFailsWith<IncompleteEntryException> { m.unlock(pin(bad)) }
        }
        assertEquals(3, m.remainingAttempts())
    }

    @Test
    fun `third wrong current PIN during PIN change destroys the keys`() {
        val m = manager()
        m.create(pin("482915"))
        assertFailsWith<WrongPinException> { m.changePin(pin("000001"), pin("73920184")) }
        assertFailsWith<WrongPinException> { m.changePin(pin("000002"), pin("73920184")) }
        assertFailsWith<VaultDestroyedException> { m.changePin(pin("000003"), pin("73920184")) }
        assertFalse(hw.exists())
    }

    @Test
    fun `oversized Argon2 settings are rejected`() {
        assertFailsWith<IllegalArgumentException> { Argon2Params(Argon2Params.MAX_MEMORY_KIB + 1, 3, 1) }
        assertFailsWith<IllegalArgumentException> { Argon2Params(1024, Argon2Params.MAX_ITERATIONS + 1, 1) }
    }

    @Test
    fun `envelope header edited to huge memory is refused before any allocation`() {
        val m = manager()
        m.create(pin("482915"))
        val file = File(dir, "vault.key")
        val bytes = file.readBytes()
        // memory cost field (bytes 5..8) set to 0x7FFFFFFF KiB, in both envelope copies
        bytes[5] = 0x7F
        bytes[6] = -1
        bytes[7] = -1
        bytes[8] = -1
        file.writeBytes(bytes)
        File(dir, "vault.key.bak").writeBytes(bytes)
        // Unreadable envelopes are storage damage, not a guess: refused and not counted.
        assertFailsWith<KeysUnavailableException> { m.unlock(pin("482915")) }
        assertEquals(3, m.remainingAttempts())
    }

    @Test
    fun `PIN alone is not enough without the device key`() {
        val m = manager()
        m.create(pin("482915"))
        // Same files, different device: a fresh chip key.
        val otherDevice = FakeHardwareKey().apply { create() }
        val copy = VaultKeyManager(File(dir, "vault.key"), FileAttemptCounter(File(dir, "copy-attempts")), otherDevice, TEST_PARAMS)
        File(dir, "copy-attempts").let { FileAttemptCounter(it).write(0) }
        assertFailsWith<WrongPinException> { copy.unlock(pin("482915")) }
    }

    @Test
    fun `device key alone is not enough without the PIN`() {
        val m = manager()
        m.create(pin("482915"))
        val cloned = FakeHardwareKey().apply { copyFrom(hw) }
        val copy = VaultKeyManager(File(dir, "vault.key"), FileAttemptCounter(File(dir, "c")), cloned, TEST_PARAMS)
        FileAttemptCounter(File(dir, "c")).write(0)
        assertFailsWith<WrongPinException> { copy.unlock(pin("482916")) }
    }

    @Test
    fun `tampering with the envelope header is detected`() {
        val m = manager()
        m.create(pin("482915"))
        val file = File(dir, "vault.key")
        val bytes = file.readBytes()
        bytes[8] = (bytes[8] + 1).toByte() // memory cost field
        file.writeBytes(bytes)
        File(dir, "vault.key.bak").writeBytes(bytes)
        assertFailsWith<WrongPinException> { m.unlock(pin("482915")) }
    }

    @Test
    fun `missing counter file leaves only one attempt`() {
        val m = manager()
        m.create(pin("482915"))
        File(dir, "attempts").delete()
        File(dir, "attempts.bak").delete()
        assertEquals(1, m.remainingAttempts())
        m.unlock(pin("482915"))
        assertEquals(3, m.remainingAttempts())
    }

    @Test
    fun `change PIN needs the current PIN and keeps the master key`() {
        val m = manager()
        val mk = m.create(pin("482915"))
        assertFailsWith<WrongPinException> { m.changePin(pin("111119"), pin("73920184")) }
        m.changePin(pin("482915"), pin("73920184"))
        assertContentEquals(mk, m.unlock(pin("73920184")))
        assertFailsWith<WrongPinException> { m.unlock(pin("482915")) }
    }

    @Test
    fun `weak PINs are refused at creation`() {
        val m = manager()
        assertFailsWith<WeakPinException> { m.create(pin("123")) }
        assertFailsWith<WeakPinException> { m.create(pin("1234")) }
        assertFalse(File(dir, "vault.key").exists())
    }

    @Test
    fun `fresh install wipes leftover keys`() {
        val m = manager()
        m.create(pin("482915"))
        m.wipeLeftoversForFreshInstall()
        assertFalse(hw.exists())
        assertFalse(m.exists())
        assertFailsWith<VaultDestroyedException> { m.unlock(pin("482915")) }
        m.create(pin("592016"))
        assertTrue(m.exists())
    }

    @Test
    fun `device key is used for every guess`() {
        val m = manager()
        m.create(pin("482915"))
        val before = hw.mixCalls
        runCatching { m.unlock(pin("000001")) }
        assertEquals(before + 1, hw.mixCalls)
    }
}
