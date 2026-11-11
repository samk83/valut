package com.jellydock.privatevault.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class PinPolicyTest {
    @Test
    fun `accepts ordinary PINs of four digits or more`() {
        assertNull(PinPolicy.check(pin("4829")))
        assertNull(PinPolicy.check(pin("48291573")))
    }

    @Test
    fun `rejects trivial PINs`() {
        assertEquals(PinPolicy.Rejection.TOO_SHORT, PinPolicy.check(pin("482")))
        assertEquals(PinPolicy.Rejection.NOT_DIGITS, PinPolicy.check(pin("48a9")))
        assertEquals(PinPolicy.Rejection.REPEATED, PinPolicy.check(pin("777777")))
        assertEquals(PinPolicy.Rejection.SEQUENTIAL, PinPolicy.check(pin("3456")))
        assertEquals(PinPolicy.Rejection.SEQUENTIAL, PinPolicy.check(pin("9876")))
        assertEquals(PinPolicy.Rejection.COMMON, PinPolicy.check(pin("2580")))
        assertEquals(PinPolicy.Rejection.COMMON, PinPolicy.check(pin("1004")))
    }

    @Test
    fun `strength follows length`() {
        assertEquals(PinPolicy.Strength.WEAK, PinPolicy.strength(4))
        assertEquals(PinPolicy.Strength.FAIR, PinPolicy.strength(6))
        assertEquals(PinPolicy.Strength.STRONG, PinPolicy.strength(8))
        assertEquals(PinPolicy.Strength.FORTRESS, PinPolicy.strength(10))
    }
}
