import Foundation
import ImageIO
import UIKit
import Vision

/// Reads a decrypted photo on the device itself (Apple Vision, no network): the text in it and
/// a few words for what it shows. The result is a small JSON "search note" that the vault seals
/// next to the photo. The photo is only read, never changed.
///
/// Same note format as android/.../PhotoReader.kt:
///   {"v":1,"engine":"…","w":…,"h":…,"text":"…","lines":[{"t":"…","b":[x,y,w,h]}],"labels":["…"]}
/// Boxes are fractions of the upright image, origin top-left.
enum PhotoReader {
  /// Bump when reading improves, so older notes are read again.
  static let engine = "ios-vision-1"

  /// Longest side the reader works on. Large enough for small receipt text, small enough to
  /// keep memory in check with 48 MP photos.
  private static let maxSide: CGFloat = 4096
  private static let maxLines = 600

  static func isCurrent(_ note: [UInt8]) -> Bool {
    guard let obj = try? JSONSerialization.jsonObject(with: Data(note)) as? [String: Any] else { return false }
    return obj["engine"] as? String == engine
  }

  static func read(_ data: Data) throws -> [UInt8] {
    guard let image = upright(data) else { throw NSError(domain: "PhotoReader", code: 1) }
    let lines = recognizeText(image)
    var labels = classify(image)
    if looksLikeDocument(image) { labels.insert("document", at: 0) }
    let text = lines.map { $0.text }.joined(separator: "\n")
    let note: [String: Any] = [
      "v": 1,
      "engine": engine,
      "w": image.width,
      "h": image.height,
      "text": text,
      "lines": lines.prefix(maxLines).map { l in
        ["t": l.text, "b": [l.box.minX, l.box.minY, l.box.width, l.box.height].map { (Double($0) * 10000).rounded() / 10000 }] as [String: Any]
      },
      "labels": labels,
    ]
    return [UInt8](try JSONSerialization.data(withJSONObject: note))
  }

  // MARK: - Image

  /// Decodes with the photo's own orientation applied, scaled down to [maxSide].
  private static func upright(_ data: Data) -> CGImage? {
    guard let src = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
    let opts: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: maxSide,
      kCGImageSourceShouldCacheImmediately: true,
    ]
    return CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary)
  }

  // MARK: - Text

  private struct Line {
    let text: String
    /// Top-left origin, fractions of the image.
    let box: CGRect
  }

  /// Most accurate Vision mode with language correction, the user's own languages first.
  /// Tall images (long screenshots, documents) are read in overlapping slices, because Vision
  /// shrinks a whole tall page so far that small text is lost.
  private static func recognizeText(_ image: CGImage) -> [Line] {
    let ratio = CGFloat(image.height) / CGFloat(max(image.width, 1))
    var regions: [CGRect] = [CGRect(x: 0, y: 0, width: 1, height: 1)]
    if ratio > 2.2 {
      // Slices about 1.6 widths tall, overlapping by 15% so no line is cut in two.
      let slice = min(1, 1.6 / ratio)
      let step = slice * 0.85
      regions = []
      var top: CGFloat = 0
      while top < 1 {
        let h = min(slice, 1 - top)
        // Vision regions use a bottom-left origin.
        regions.append(CGRect(x: 0, y: 1 - top - h, width: 1, height: h))
        if top + h >= 1 { break }
        top += step
      }
    }
    var out: [Line] = []
    for region in regions {
      for line in recognize(image, region: region) where !overlapsSame(line, out) {
        out.append(line)
      }
    }
    return readingOrder(out)
  }

  /// Top to bottom; lines on the same row (centres within half a line) left to right.
  private static func readingOrder(_ lines: [Line]) -> [Line] {
    var rows: [[Line]] = []
    for line in lines.sorted(by: { $0.box.midY < $1.box.midY }) {
      if let first = rows.last?.first, abs(first.box.midY - line.box.midY) < min(first.box.height, line.box.height) * 0.5 {
        rows[rows.count - 1].append(line)
      } else {
        rows.append([line])
      }
    }
    return rows.flatMap { $0.sorted { $0.box.minX < $1.box.minX } }
  }

  private static func recognize(_ image: CGImage, region: CGRect) -> [Line] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.automaticallyDetectsLanguage = true
    request.recognitionLanguages = languages(for: request)
    request.regionOfInterest = region
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    do { try handler.perform([request]) } catch { return [] }
    return (request.results ?? []).compactMap { obs -> Line? in
      guard let best = obs.topCandidates(1).first else { return nil }
      let text = best.string.trimmingCharacters(in: .whitespacesAndNewlines)
      if text.isEmpty { return nil }
      // boundingBox is relative to the region of interest, bottom-left origin.
      let b = obs.boundingBox
      let x = region.minX + b.minX * region.width
      let y = region.minY + b.minY * region.height
      let w = b.width * region.width
      let h = b.height * region.height
      return Line(text: text, box: CGRect(x: x, y: 1 - y - h, width: w, height: h))
    }
  }

  /// A line already found in an overlapping slice.
  private static func overlapsSame(_ line: Line, _ found: [Line]) -> Bool {
    found.contains { other in
      guard other.text == line.text else { return false }
      let i = other.box.intersection(line.box)
      return !i.isNull && i.width * i.height > 0.5 * min(other.box.width * other.box.height, line.box.width * line.box.height)
    }
  }

  /// The phone's languages that Vision can read, in the user's order, then English.
  private static func languages(for request: VNRecognizeTextRequest) -> [String] {
    guard let supported = try? request.supportedRecognitionLanguages() else { return ["en-US"] }
    var out: [String] = []
    func add(_ code: String) {
      if !out.contains(code) { out.append(code) }
    }
    for pref in Locale.preferredLanguages {
      let base = pref.split(separator: "-").first.map(String.init) ?? pref
      if supported.contains(pref) {
        add(pref)
      } else if let match = supported.first(where: { $0 == base || $0.hasPrefix(base + "-") }) {
        add(match)
      }
    }
    if supported.contains("en-US") { add("en-US") }
    return out.isEmpty ? ["en-US"] : out
  }

  // MARK: - What the photo shows

  private static func classify(_ image: CGImage) -> [String] {
    let request = VNClassifyImageRequest()
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    do { try handler.perform([request]) } catch { return [] }
    return (request.results ?? [])
      .filter { $0.confidence >= 0.3 }
      .sorted { $0.confidence > $1.confidence }
      .prefix(15)
      .map { $0.identifier.lowercased() }
  }

  /// A page, receipt or card filling a good part of the photo.
  private static func looksLikeDocument(_ image: CGImage) -> Bool {
    let request = VNDetectDocumentSegmentationRequest()
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    do { try handler.perform([request]) } catch { return false }
    guard let doc = request.results?.first, doc.confidence >= 0.8 else { return false }
    return doc.boundingBox.width * doc.boundingBox.height >= 0.2
  }
}
