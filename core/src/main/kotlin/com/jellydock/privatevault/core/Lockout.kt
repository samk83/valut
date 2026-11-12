package com.jellydock.privatevault.core

import java.io.File
import java.nio.ByteBuffer
import kotlin.math.abs

/**
 * Time source for the wait after wrong attempts. [elapsedMs] must keep counting while the
 * phone sleeps and must not follow changes to the wall clock (Android: elapsedRealtime;
 * iPhone: CLOCK_MONOTONIC). [wallMs] is only used to tell one boot from the next.
 */
interface MonotonicClock {
    fun elapsedMs(): Long

    fun wallMs(): Long
}

/** JVM default. nanoTime starts again with every process, so each start counts as a new boot. */
object SystemMonotonicClock : MonotonicClock {
    override fun elapsedMs(): Long = System.nanoTime() / 1_000_000

    override fun wallMs(): Long = System.currentTimeMillis()
}

/**
 * Wrong attempts never erase anything (owner decision 2026-11-12, SPEC AC-04). After
 * [FREE_ATTEMPTS] wrong attempts in a row each further attempt has to wait, longer every time.
 * The PIN still only works on this phone (security chip), so the wait is the only limit an
 * attacker meets: at one guess an hour a 4-digit PIN takes over a year to try out.
 */
object LockoutPolicy {
    const val FREE_ATTEMPTS = 3

    /** Highest count stored; far above anything that changes the wait. */
    const val MAX_COUNT = 100_000

    fun delayMs(failures: Int): Long =
        when {
            failures < FREE_ATTEMPTS -> 0L
            failures == FREE_ATTEMPTS -> 60_000L
            failures == FREE_ATTEMPTS + 1 -> 5 * 60_000L
            failures == FREE_ATTEMPTS + 2 -> 15 * 60_000L
            else -> 60 * 60_000L
        }
}

/**
 * When the last attempt was made, as (boot, time since boot). Two copies like the counter.
 *
 * The wait is measured with the clock since boot, so changing the phone's date or time
 * cannot shorten it. After a reboot (or a clock change, which looks the same) the time
 * since boot cannot be compared any more, so the full wait starts again from that moment:
 * restarting the phone never helps an attacker.
 */
internal class LockoutRecord(
    private val file: File,
    private val clock: MonotonicClock,
) {
    private val backup = File(file.absoluteFile.parentFile, file.name + ".bak")

    /** Records "an attempt was made now". */
    fun markNow() {
        val bytes = encode(now())
        SecureFiles.writeAtomic(file, bytes)
        runCatching { SecureFiles.writeAtomic(backup, bytes) }
    }

    /** Milliseconds still to wait before an attempt is allowed after [failures] wrong ones. */
    fun remainingMs(failures: Int): Long {
        val delay = LockoutPolicy.delayMs(failures)
        if (delay == 0L) return 0L
        val current = now()
        // The latest copy wins: a stale backup must never shorten the wait.
        val stored = listOf(file, backup).mapNotNull { decode(it) }.filter { sameBoot(it, current) }.maxByOrNull { it.second }
        if (stored == null) {
            // Unknown, damaged or from an earlier boot: the full wait starts now.
            runCatching { markNow() }
            return delay
        }
        val passed = current.second - stored.second
        return (delay - passed).coerceIn(0L, delay)
    }

    fun clear() {
        SecureFiles.shred(file)
        SecureFiles.shred(backup)
    }

    private fun sameBoot(
        a: Pair<Long, Long>,
        b: Pair<Long, Long>,
    ) = abs(a.first - b.first) <= BOOT_TOLERANCE_MS && b.second >= a.second

    private fun now(): Pair<Long, Long> {
        val elapsed = clock.elapsedMs()
        return Pair(clock.wallMs() - elapsed, elapsed)
    }

    private fun encode(v: Pair<Long, Long>): ByteArray = ByteBuffer.allocate(16).putLong(v.first).putLong(v.second).array()

    private fun decode(f: File): Pair<Long, Long>? {
        val bytes = runCatching { f.readBytes() }.getOrNull() ?: return null
        if (bytes.size != 16) return null
        val buf = ByteBuffer.wrap(bytes)
        return Pair(buf.getLong(), buf.getLong())
    }

    private companion object {
        // Boot moment = wall clock minus time since boot. Small automatic time corrections
        // move it by seconds and are ignored; a reboot or a larger clock change restarts the
        // full wait (it never shortens it, since the wait itself uses time since boot).
        const val BOOT_TOLERANCE_MS = 120_000L
    }
}
