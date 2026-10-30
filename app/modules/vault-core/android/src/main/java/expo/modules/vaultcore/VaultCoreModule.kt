package expo.modules.vaultcore

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.util.Base64
import com.jellydock.privatevault.core.Argon2Params
import com.jellydock.privatevault.core.IncompleteEntryException
import com.jellydock.privatevault.core.ItemKind
import com.jellydock.privatevault.core.ItemMeta
import com.jellydock.privatevault.core.KeysUnavailableException
import com.jellydock.privatevault.core.PinPolicy
import com.jellydock.privatevault.core.SecureFiles
import com.jellydock.privatevault.core.Vault
import com.jellydock.privatevault.core.VaultDestroyedException
import com.jellydock.privatevault.core.VaultStateException
import com.jellydock.privatevault.core.WeakPinException
import com.jellydock.privatevault.core.WrongPinException
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.security.MessageDigest

/**
 * Bridges the shared Kotlin vault core (/core) to the React Native UI.
 *
 * Every call runs on Expo's async-function queue, one at a time, so a PIN check never races
 * an import or a lock. PINs arrive as strings from JS; they are copied into a CharArray and
 * that array is wiped after use (the JS string itself cannot be wiped).
 */
class VaultCoreModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw CodedException("E_NO_CONTEXT", "React context is gone", null)

  private lateinit var hardwareKey: AndroidHardwareKey
  private lateinit var vault: Vault
  private val playbackTicket = java.util.concurrent.atomic.AtomicInteger()

  private val root: File get() = File(context.noBackupFilesDir, "vault")
  private val playDir: File get() = File(context.noBackupFilesDir, "play")

  override fun definition() =
    ModuleDefinition {
      Name("VaultCore")

      OnCreate {
        hardwareKey = AndroidHardwareKey(AndroidHardwareKey.strongBoxFeature(context.packageManager))
        root.mkdirs()
        vault = Vault(root, hardwareKey, PARAMS)
        // allowBackup=false and noBackupFilesDir keep data off backups. The marker below also
        // lives there, so its absence means a fresh install: clear anything left (SPEC AC-20).
        val marker = File(context.noBackupFilesDir, "installed.marker")
        if (!marker.exists()) {
          vault.wipeLeftoversForFreshInstall()
          marker.writeText("1")
        }
        clearPlayback()
        clearPickerCaches()
      }

      AsyncFunction("status") {
        mapOf(
          "exists" to vault.exists(),
          "unlocked" to vault.isUnlocked,
          "remainingAttempts" to vault.remainingAttempts(),
          "hardware" to hardwareKey.describeExisting(),
          "strongBoxAvailable" to AndroidHardwareKey.strongBoxFeature(context.packageManager),
        )
      }

      Function("checkPin") { pin: String ->
        val chars = pin.toCharArray()
        val rejection = PinPolicy.check(chars)
        chars.fill('\u0000')
        mapOf("rejection" to rejection?.name, "strength" to PinPolicy.strength(pin.length).name)
      }

      AsyncFunction("create") { pin: String ->
        withPin(pin) { chars ->
          try {
            vault.create(chars)
            ok()
          } catch (e: WeakPinException) {
            mapOf("ok" to false, "error" to "WEAK_PIN", "reason" to e.reason.name)
          } catch (e: VaultStateException) {
            // Either a vault already exists, or the app was backgrounded while the new vault
            // was being sealed (it is on disk but locked). Both continue at the unlock screen.
            mapOf("ok" to false, "error" to if (vault.exists()) "INTERRUPTED" else "EXISTS")
          } catch (e: Exception) {
            mapOf("ok" to false, "error" to "FAILED")
          }
        }
      }

      AsyncFunction("unlock") { pin: String ->
        withPin(pin) { chars ->
          try {
            vault.unlock(chars)
            ok()
          } catch (e: WrongPinException) {
            mapOf("ok" to false, "error" to "WRONG_PIN", "remaining" to e.remainingAttempts)
          } catch (e: VaultDestroyedException) {
            clearPlayback()
            mapOf("ok" to false, "error" to "DESTROYED")
          } catch (e: IncompleteEntryException) {
            mapOf("ok" to false, "error" to "INCOMPLETE")
          } catch (e: KeysUnavailableException) {
            mapOf("ok" to false, "error" to "KEYS_UNAVAILABLE")
          } catch (e: VaultStateException) {
            mapOf("ok" to false, "error" to "INTERRUPTED")
          } catch (e: OutOfMemoryError) {
            mapOf("ok" to false, "error" to "OUT_OF_MEMORY")
          } catch (e: Exception) {
            // Keystore/provider failures: the core already rolled the attempt back.
            mapOf("ok" to false, "error" to "FAILED")
          }
        }
      }

      Function("lock") {
        vault.lock()
        clearPlayback()
        clearPickerCaches()
      }

      AsyncFunction("list") {
        vault.list().map { item ->
          mapOf(
            "id" to item.id,
            "kind" to item.meta.kind.name,
            "mimeType" to item.meta.mimeType,
            "createdAt" to item.meta.createdAtEpochMs.toDouble(),
            "size" to item.meta.sizeBytes.toDouble(),
          )
        }
      }

      AsyncFunction("thumbnail") { id: String ->
        vault.thumbnail(id)?.let { Base64.encodeToString(it, Base64.NO_WRAP) }
      }

      AsyncFunction("readPhoto") { id: String ->
        val out = ByteArrayOutputStream()
        vault.read(id, out)
        Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
      }

      /**
       * Imports [uri] (content:// from the gallery or file:// from the in-app camera).
       * The SHA-256 is computed in a first, separate read so the core can tell whether the
       * original may be deleted. [deleteSourceFile] removes a camera temp file afterwards.
       */
      AsyncFunction("importUri") { uri: String, kind: String, mimeType: String, deleteSourceFile: Boolean ->
        val parsed = Uri.parse(uri)
        try {
          val itemKind = ItemKind.valueOf(kind)
          val sha = open(parsed).use { sha256(it) }
          val thumb = runCatching { makeThumbnail(parsed, itemKind) }.getOrNull()
          val result =
            open(parsed).use {
              vault.importItem(it, ItemMeta(itemKind, mimeType, System.currentTimeMillis()), thumb, sha)
            }
          mapOf("id" to result.item.id, "safeToDeleteOriginal" to result.safeToDeleteOriginal)
        } finally {
          // Only plaintext copies inside our own cache (picker/camera output) are deleted.
          if (deleteSourceFile && parsed.scheme == "file") {
            parsed.path?.let { File(it) }?.takeIf { it.canonicalPath.startsWith(context.cacheDir.canonicalPath + File.separator) }?.delete()
          }
        }
      }

      /** Decrypts a video to a private temp file for the player. Deleted on close and on lock. */
      AsyncFunction("openVideo") { id: String ->
        clearPlayback()
        val ticket = playbackTicket.get()
        playDir.mkdirs()
        val file = File(playDir, "${java.util.UUID.randomUUID()}.mp4")
        FileOutputStream(file).use { vault.read(id, it) }
        // The viewer was closed (or the app locked) while decrypting: do not leave the file.
        if (playbackTicket.get() != ticket) {
          file.delete()
          throw CodedException("E_CLOSED", "Playback was closed", null)
        }
        Uri.fromFile(file).toString()
      }

      Function("closeVideo") { clearPlayback() }

      AsyncFunction("delete") { id: String -> vault.delete(id) }

      AsyncFunction("destroy") {
        vault.destroy()
        clearPlayback()
      }
    }

  private fun ok() = mapOf<String, Any?>("ok" to true)

  private fun <T> withPin(
    pin: String,
    block: (CharArray) -> T,
  ): T {
    val chars = pin.toCharArray()
    try {
      return block(chars)
    } finally {
      chars.fill('\u0000')
    }
  }

  private fun open(uri: Uri): InputStream =
    context.contentResolver.openInputStream(uri) ?: throw CodedException("E_OPEN", "Cannot open $uri", null)

  private fun sha256(input: InputStream): ByteArray {
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(64 * 1024)
    while (true) {
      val n = input.read(buffer)
      if (n < 0) break
      digest.update(buffer, 0, n)
    }
    return digest.digest()
  }

  private fun makeThumbnail(
    uri: Uri,
    kind: ItemKind,
  ): ByteArray? {
    val bitmap =
      when (kind) {
        ItemKind.PHOTO -> decodeSampled(uri)
        ItemKind.VIDEO ->
          MediaMetadataRetriever().run {
            try {
              setDataSource(context, uri)
              getFrameAtTime(0)
            } finally {
              release()
            }
          }
      } ?: return null
    val scale = THUMB_PX.toFloat() / maxOf(bitmap.width, bitmap.height)
    val scaled = if (scale < 1f) Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt().coerceAtLeast(1), (bitmap.height * scale).toInt().coerceAtLeast(1), true) else bitmap
    val rotated = if (kind == ItemKind.PHOTO) rotateByExif(uri, scaled) else scaled
    return ByteArrayOutputStream().use {
      rotated.compress(Bitmap.CompressFormat.JPEG, 80, it)
      it.toByteArray()
    }
  }

  private fun decodeSampled(uri: Uri): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    open(uri).use { BitmapFactory.decodeStream(it, null, bounds) }
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= THUMB_PX) sample *= 2
    return open(uri).use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
  }

  private fun rotateByExif(
    uri: Uri,
    bitmap: Bitmap,
  ): Bitmap {
    val degrees =
      runCatching {
        open(uri).use {
          when (ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> 0f
          }
        }
      }.getOrDefault(0f)
    if (degrees == 0f) return bitmap
    return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, Matrix().apply { postRotate(degrees) }, true)
  }

  private fun clearPlayback() {
    playbackTicket.incrementAndGet()
    playDir.listFiles()?.forEach { it.delete() }
  }

  /** Plaintext copies made by expo-image-picker and expo-camera before import. */
  private fun clearPickerCaches() {
    listOf("ImagePicker", "Camera").forEach { SecureFiles.deleteTree(File(context.cacheDir, it)) }
  }

  companion object {
    // Lighter than the desktop default (256 MiB) so it fits in a phone app's heap.
    // The real per-device cost is still to be measured on hardware (SPEC AC-14).
    private val PARAMS = Argon2Params(memoryKiB = 64 * 1024, iterations = 3, parallelism = 1)
    private const val THUMB_PX = 360
  }
}
