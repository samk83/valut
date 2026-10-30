package expo.modules.vaultcore

import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import com.jellydock.privatevault.core.HardwareKey
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey

/**
 * [HardwareKey] backed by an HMAC-SHA256 key in Android Keystore.
 *
 * StrongBox (a separate security chip) is used when the phone has one; otherwise the key
 * lives in the TEE. Either way the key material never leaves secure hardware and is wiped
 * when the app is uninstalled. [level] reports which one was used.
 */
class AndroidHardwareKey(private val hasStrongBoxFeature: Boolean) : HardwareKey {
  private val keyStore: KeyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }

  var level: String = "unknown"
    private set

  override fun exists(): Boolean = keyStore.containsAlias(ALIAS)

  override fun create() {
    if (exists()) keyStore.deleteEntry(ALIAS)
    level =
      if (hasStrongBoxFeature && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        try {
          generate(strongBox = true)
          "StrongBox"
        } catch (e: StrongBoxUnavailableException) {
          generate(strongBox = false)
          "TEE"
        }
      } else {
        generate(strongBox = false)
        "TEE"
      }
  }

  override fun mix(data: ByteArray): ByteArray {
    val key = keyStore.getKey(ALIAS, null) as SecretKey
    return Mac.getInstance(KeyProperties.KEY_ALGORITHM_HMAC_SHA256).run {
      init(key)
      doFinal(data)
    }
  }

  override fun destroy() {
    if (exists()) keyStore.deleteEntry(ALIAS)
  }

  private fun generate(strongBox: Boolean) {
    val spec =
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
        .setDigests(KeyProperties.DIGEST_SHA256)
        .apply { if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) setIsStrongBoxBacked(true) }
        .build()
    KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_HMAC_SHA256, PROVIDER).run {
      init(spec)
      generateKey()
    }
  }

  /** Reads the protection level of the existing key (StrongBox / TEE / software). */
  fun describeExisting(): String {
    if (!exists()) return "none"
    return try {
      val key = keyStore.getKey(ALIAS, null) as SecretKey
      val factory = javax.crypto.SecretKeyFactory.getInstance(key.algorithm, PROVIDER)
      val info = factory.getKeySpec(key, android.security.keystore.KeyInfo::class.java) as android.security.keystore.KeyInfo
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        when (info.securityLevel) {
          KeyProperties.SECURITY_LEVEL_STRONGBOX -> "StrongBox"
          KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "TEE"
          KeyProperties.SECURITY_LEVEL_SOFTWARE -> "Software"
          else -> "Secure hardware"
        }
      } else {
        @Suppress("DEPRECATION")
        if (info.isInsideSecureHardware) "Secure hardware" else "Software"
      }
    } catch (e: Exception) {
      level
    }
  }

  companion object {
    private const val PROVIDER = "AndroidKeyStore"
    private const val ALIAS = "privatevault.device.v1"

    fun strongBoxFeature(pm: PackageManager): Boolean =
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && pm.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)
  }
}
