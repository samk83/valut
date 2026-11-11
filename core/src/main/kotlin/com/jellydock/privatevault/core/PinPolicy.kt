package com.jellydock.privatevault.core

/** PIN rules from SPEC AC-01 (minimum 4 digits, common and trivial PINs refused). */
object PinPolicy {
    const val MIN_LENGTH = 4
    const val MAX_LENGTH = 32
    const val RECOMMENDED_LENGTH = 10

    enum class Rejection { TOO_SHORT, TOO_LONG, NOT_DIGITS, REPEATED, SEQUENTIAL, COMMON }

    enum class Strength { WEAK, FAIR, STRONG, FORTRESS }

    // Most frequent PINs in published leak studies, plus date-like and keypad patterns.
    private val common =
        setOf(
            "1234", "1111", "0000", "1212", "7777", "1004", "2000", "4444", "2222", "6969",
            "9999", "3333", "5555", "6666", "1122", "1313", "8888", "4321", "2001", "1010",
            "2580", "0852", "1379", "1470", "0258", "123456", "654321", "121212", "123123",
            "111222", "112233", "159753", "147258", "102030", "123321", "520520", "12345678",
            "11223344", "87654321", "1234567890", "0987654321",
        )

    /** Returns null when [pin] is acceptable for a new vault, else the reason. */
    fun check(pin: CharArray): Rejection? {
        if (pin.size < MIN_LENGTH) return Rejection.TOO_SHORT
        if (pin.size > MAX_LENGTH) return Rejection.TOO_LONG
        if (pin.any { it !in '0'..'9' }) return Rejection.NOT_DIGITS
        if (pin.all { it == pin[0] }) return Rejection.REPEATED
        if (isRun(pin, 1) || isRun(pin, -1)) return Rejection.SEQUENTIAL
        if (String(pin) in common) return Rejection.COMMON
        return null
    }

    /**
     * Only well-formed entries (digits, allowed length) are checked and counted. Anything else
     * cannot come from the keypad, so it is refused without using an attempt (SPEC AC-06).
     */
    fun isCompleteEntry(pin: CharArray): Boolean = pin.size in MIN_LENGTH..MAX_LENGTH && pin.all { it in '0'..'9' }

    fun strength(length: Int): Strength =
        when {
            length >= RECOMMENDED_LENGTH -> Strength.FORTRESS
            length >= 8 -> Strength.STRONG
            length >= 6 -> Strength.FAIR
            else -> Strength.WEAK
        }

    private fun isRun(
        pin: CharArray,
        step: Int,
    ): Boolean = (1 until pin.size).all { pin[it] - pin[it - 1] == step }
}
