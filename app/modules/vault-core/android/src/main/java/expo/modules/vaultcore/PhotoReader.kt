package expo.modules.vaultcore

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.label.ImageLabeling
import com.google.mlkit.vision.label.defaults.ImageLabelerOptions
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import com.google.mlkit.vision.text.devanagari.DevanagariTextRecognizerOptions
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Reads a decrypted photo on the device itself (Google ML Kit with the models built into the
 * app, so nothing is downloaded and nothing leaves the phone): the text in it and a few words
 * for what it shows. Same note format as ios/PhotoReader.swift. The photo is only read.
 *
 * Call from a background thread: it blocks while ML Kit works.
 */
object PhotoReader {
  /** Bump when reading improves, so older notes are read again. */
  const val ENGINE = "android-mlkit-1"

  private const val MAX_SIDE = 4096
  private const val MAX_LINES = 600

  fun isCurrent(note: ByteArray): Boolean =
    try {
      JSONObject(String(note, Charsets.UTF_8)).optString("engine") == ENGINE
    } catch (e: Exception) {
      false
    }

  fun read(data: ByteArray): ByteArray {
    val bitmap = upright(data) ?: throw IllegalArgumentException("Not an image")
    try {
      val image = InputImage.fromBitmap(bitmap, 0)
      val lines = recognizeText(image, bitmap.width, bitmap.height)
      val labels = classify(image)
      val note =
        JSONObject()
          .put("v", 1)
          .put("engine", ENGINE)
          .put("w", bitmap.width)
          .put("h", bitmap.height)
          .put("text", lines.joinToString("\n") { it.text })
          .put(
            "lines",
            JSONArray().also { arr ->
              lines.take(MAX_LINES).forEach { l ->
                arr.put(JSONObject().put("t", l.text).put("b", JSONArray(listOf(l.x, l.y, l.w, l.h).map { round4(it) })))
              }
            },
          ).put("labels", JSONArray(labels))
      return note.toString().toByteArray(Charsets.UTF_8)
    } finally {
      bitmap.recycle()
    }
  }

  private data class Line(
    val text: String,
    val x: Double,
    val y: Double,
    val w: Double,
    val h: Double,
  )

  private fun round4(v: Double) = (v * 10000).roundToInt() / 10000.0

  /** Decodes at most [MAX_SIDE] on the long side, turned upright from the photo's EXIF. */
  private fun upright(data: ByteArray): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    // Long side at most MAX_SIDE after sampling (a 48 MP photo decodes at about 4000 px, ~48 MB).
    while (max(bounds.outWidth, bounds.outHeight) / sample > MAX_SIDE) sample *= 2
    val decoded =
      BitmapFactory.decodeByteArray(data, 0, data.size, BitmapFactory.Options().apply { inSampleSize = sample })
        ?: return null
    val rotation =
      try {
        when (ExifInterface(ByteArrayInputStream(data)).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
          ExifInterface.ORIENTATION_ROTATE_90 -> 90f
          ExifInterface.ORIENTATION_ROTATE_180 -> 180f
          ExifInterface.ORIENTATION_ROTATE_270 -> 270f
          else -> 0f
        }
      } catch (e: Exception) {
        0f
      }
    if (rotation == 0f) return decoded
    val turned = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, Matrix().apply { postRotate(rotation) }, true)
    if (turned !== decoded) decoded.recycle()
    return turned
  }

  /**
   * One recognizer for the phone's language script. The Korean, Japanese and Chinese models
   * also read Latin letters; the Devanagari one is paired with the Latin one.
   */
  private fun recognizers(): List<TextRecognizer> {
    val lang = Locale.getDefault().language
    return when (lang) {
      "ko" -> listOf(TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build()))
      "ja" -> listOf(TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build()))
      "zh" -> listOf(TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build()))
      "hi" ->
        listOf(
          TextRecognition.getClient(DevanagariTextRecognizerOptions.Builder().build()),
          TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS),
        )
      else -> listOf(TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS))
    }
  }

  private fun recognizeText(
    image: InputImage,
    width: Int,
    height: Int,
  ): List<Line> {
    val found = mutableListOf<Line>()
    for (recognizer in recognizers()) {
      try {
        val result = Tasks.await(recognizer.process(image))
        for (block in result.textBlocks) {
          for (line in block.lines) {
            val text = line.text.trim()
            val box = line.boundingBox ?: continue
            if (text.isEmpty()) continue
            val l =
              Line(
                text,
                box.left.toDouble() / width,
                box.top.toDouble() / height,
                box.width().toDouble() / width,
                box.height().toDouble() / height,
              )
            if (found.none { it.text == l.text && overlap(it, l) }) found.add(l)
          }
        }
      } catch (e: Exception) {
        // One model failing leaves the others' text; the photo is read again next version.
      } finally {
        recognizer.close()
      }
    }
    return readingOrder(found)
  }

  private fun overlap(
    a: Line,
    b: Line,
  ): Boolean {
    val w = min(a.x + a.w, b.x + b.w) - max(a.x, b.x)
    val h = min(a.y + a.h, b.y + b.h) - max(a.y, b.y)
    return w > 0 && h > 0 && w * h > 0.5 * min(a.w * a.h, b.w * b.h)
  }

  /** Top to bottom; lines on the same row (centres within half a line) left to right. */
  private fun readingOrder(lines: List<Line>): List<Line> {
    val rows = mutableListOf<MutableList<Line>>()
    for (line in lines.sortedBy { it.y + it.h / 2 }) {
      val first = rows.lastOrNull()?.first()
      if (first != null && abs((first.y + first.h / 2) - (line.y + line.h / 2)) < min(first.h, line.h) * 0.5) {
        rows.last().add(line)
      } else {
        rows.add(mutableListOf(line))
      }
    }
    return rows.flatMap { row -> row.sortedBy { it.x } }
  }

  private fun classify(image: InputImage): List<String> {
    val labeler = ImageLabeling.getClient(ImageLabelerOptions.Builder().setConfidenceThreshold(0.55f).build())
    return try {
      Tasks
        .await(labeler.process(image))
        .sortedByDescending { it.confidence }
        .take(15)
        .map { it.text.lowercase(Locale.ROOT) }
    } catch (e: Exception) {
      emptyList()
    } finally {
      labeler.close()
    }
  }
}
