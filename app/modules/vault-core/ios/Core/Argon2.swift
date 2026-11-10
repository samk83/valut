import Foundation

/// Argon2id, version 1.3 (RFC 9106), written out in Swift so the iPhone app needs no C
/// library. Checked against the RFC 9106 test vector and against the BouncyCastle output
/// the Android app uses (Tests/VaultCoreKitTests/Argon2Tests.swift).
enum Argon2 {
  private static let version: UInt32 = 0x13
  private static let typeId: UInt32 = 2
  private static let blockWords = 128
  private static let syncPoints = 4

  static func hash(
    password: [UInt8],
    salt: [UInt8],
    memoryKiB: Int,
    iterations: Int,
    parallelism: Int,
    length: Int,
    secret: [UInt8] = [],
    associatedData: [UInt8] = []
  ) -> [UInt8] {
    let lanes = parallelism
    // Memory is rounded down to a multiple of 4 * lanes blocks.
    let memoryBlocks = max(memoryKiB, 2 * syncPoints * lanes) / (syncPoints * lanes) * (syncPoints * lanes)
    let laneLength = memoryBlocks / lanes
    let segmentLength = laneLength / syncPoints

    var h0Input: [UInt8] = []
    for v in [UInt32(lanes), UInt32(length), UInt32(memoryKiB), UInt32(iterations), version, typeId] { h0Input += le32(v) }
    h0Input += le32(UInt32(password.count)) + password
    h0Input += le32(UInt32(salt.count)) + salt
    h0Input += le32(UInt32(secret.count)) + secret
    h0Input += le32(UInt32(associatedData.count)) + associatedData
    var h0 = Blake2b.hash(h0Input, outLength: 64)
    h0Input.wipe()

    let memory = UnsafeMutablePointer<UInt64>.allocate(capacity: memoryBlocks * blockWords)
    defer {
      memory.update(repeating: 0, count: memoryBlocks * blockWords)
      memory.deallocate()
    }

    for lane in 0..<lanes {
      for i in 0..<2 {
        var block = hPrime(h0 + le32(UInt32(i)) + le32(UInt32(lane)), length: 1024)
        let dst = memory + (lane * laneLength + i) * blockWords
        for w in 0..<blockWords { dst[w] = readLE64(block, w * 8) }
        block.wipe()
      }
    }
    h0.wipe()

    let scratch = Scratch()
    for pass in 0..<iterations {
      for slice in 0..<syncPoints {
        for lane in 0..<lanes {
          fillSegment(memory: memory, scratch: scratch, pass: pass, lane: lane, slice: slice, lanes: lanes,
                      laneLength: laneLength, segmentLength: segmentLength, memoryBlocks: memoryBlocks, iterations: iterations)
        }
      }
    }

    var final = [UInt64](repeating: 0, count: blockWords)
    for lane in 0..<lanes {
      let last = memory + (lane * laneLength + laneLength - 1) * blockWords
      for w in 0..<blockWords { final[w] ^= last[w] }
    }
    var finalBytes = [UInt8](repeating: 0, count: 1024)
    for w in 0..<blockWords { writeLE64(&finalBytes, w * 8, final[w]) }
    let tag = hPrime(finalBytes, length: length)
    finalBytes.wipe()
    return tag
  }

  /// Working blocks reused across the whole run.
  private final class Scratch {
    let r = UnsafeMutablePointer<UInt64>.allocate(capacity: 128)
    let tmp = UnsafeMutablePointer<UInt64>.allocate(capacity: 128)
    let zero = UnsafeMutablePointer<UInt64>.allocate(capacity: 128)
    let input = UnsafeMutablePointer<UInt64>.allocate(capacity: 128)
    let address = UnsafeMutablePointer<UInt64>.allocate(capacity: 128)

    init() {
      for p in [r, tmp, zero, input, address] { p.initialize(repeating: 0, count: 128) }
    }

    deinit {
      for p in [r, tmp, zero, input, address] {
        p.update(repeating: 0, count: 128)
        p.deallocate()
      }
    }
  }

  private static func fillSegment(
    memory: UnsafeMutablePointer<UInt64>, scratch: Scratch, pass: Int, lane: Int, slice: Int, lanes: Int,
    laneLength: Int, segmentLength: Int, memoryBlocks: Int, iterations: Int
  ) {
    let dataIndependent = pass == 0 && slice < syncPoints / 2
    if dataIndependent {
      scratch.zero.update(repeating: 0, count: 128)
      scratch.input.update(repeating: 0, count: 128)
      scratch.input[0] = UInt64(pass)
      scratch.input[1] = UInt64(lane)
      scratch.input[2] = UInt64(slice)
      scratch.input[3] = UInt64(memoryBlocks)
      scratch.input[4] = UInt64(iterations)
      scratch.input[5] = UInt64(typeId)
    }
    var start = 0
    if pass == 0 && slice == 0 {
      start = 2
      if dataIndependent { nextAddresses(scratch) }
    }
    var currOffset = lane * laneLength + slice * segmentLength + start
    var prevOffset = currOffset % laneLength == 0 ? currOffset + laneLength - 1 : currOffset - 1

    var i = start
    while i < segmentLength {
      if currOffset % laneLength == 1 { prevOffset = currOffset - 1 }
      let pseudoRand: UInt64
      if dataIndependent {
        if i % blockWords == 0 { nextAddresses(scratch) }
        pseudoRand = scratch.address[i % blockWords]
      } else {
        pseudoRand = memory[prevOffset * blockWords]
      }
      var refLane = Int((pseudoRand >> 32) % UInt64(lanes))
      if pass == 0 && slice == 0 { refLane = lane }
      let refIndex = indexAlpha(pass: pass, slice: slice, index: i, pseudoRand: pseudoRand & 0xFFFF_FFFF,
                                sameLane: refLane == lane, laneLength: laneLength, segmentLength: segmentLength)
      fillBlock(prev: memory + prevOffset * blockWords,
                ref: memory + (laneLength * refLane + refIndex) * blockWords,
                next: memory + currOffset * blockWords,
                withXor: pass != 0, scratch: scratch)
      i += 1
      currOffset += 1
      prevOffset += 1
    }
  }

  private static func indexAlpha(pass: Int, slice: Int, index: Int, pseudoRand: UInt64, sameLane: Bool,
                                 laneLength: Int, segmentLength: Int) -> Int {
    let area: Int
    if pass == 0 {
      if slice == 0 {
        area = index - 1
      } else if sameLane {
        area = slice * segmentLength + index - 1
      } else {
        area = slice * segmentLength + (index == 0 ? -1 : 0)
      }
    } else {
      if sameLane {
        area = laneLength - segmentLength + index - 1
      } else {
        area = laneLength - segmentLength + (index == 0 ? -1 : 0)
      }
    }
    var relative = pseudoRand
    relative = (relative &* relative) >> 32
    relative = UInt64(area) &- 1 &- ((UInt64(area) &* relative) >> 32)
    let startPosition = pass != 0 ? (slice == syncPoints - 1 ? 0 : (slice + 1) * segmentLength) : 0
    return Int((UInt64(startPosition) &+ relative) % UInt64(laneLength))
  }

  private static func nextAddresses(_ s: Scratch) {
    s.input[6] &+= 1
    fillBlock(prev: s.zero, ref: s.input, next: s.address, withXor: false, scratch: s)
    fillBlock(prev: s.zero, ref: s.address, next: s.address, withXor: false, scratch: s)
  }

  /// next = G(prev, ref) (XORed into next on later passes).
  private static func fillBlock(prev: UnsafeMutablePointer<UInt64>, ref: UnsafeMutablePointer<UInt64>,
                                next: UnsafeMutablePointer<UInt64>, withXor: Bool, scratch: Scratch) {
    let r = scratch.r
    let tmp = scratch.tmp
    for w in 0..<128 {
      r[w] = ref[w] ^ prev[w]
      tmp[w] = withXor ? r[w] ^ next[w] : r[w]
    }
    for i in 0..<8 {
      let b = 16 * i
      round(r, b, b + 1, b + 2, b + 3, b + 4, b + 5, b + 6, b + 7, b + 8, b + 9, b + 10, b + 11, b + 12, b + 13, b + 14, b + 15)
    }
    for i in 0..<8 {
      let b = 2 * i
      round(r, b, b + 1, b + 16, b + 17, b + 32, b + 33, b + 48, b + 49, b + 64, b + 65, b + 80, b + 81, b + 96, b + 97, b + 112, b + 113)
    }
    for w in 0..<128 { next[w] = tmp[w] ^ r[w] }
  }

  @inline(__always)
  private static func round(_ v: UnsafeMutablePointer<UInt64>, _ i0: Int, _ i1: Int, _ i2: Int, _ i3: Int, _ i4: Int, _ i5: Int,
                            _ i6: Int, _ i7: Int, _ i8: Int, _ i9: Int, _ i10: Int, _ i11: Int, _ i12: Int, _ i13: Int,
                            _ i14: Int, _ i15: Int) {
    g(v, i0, i4, i8, i12); g(v, i1, i5, i9, i13); g(v, i2, i6, i10, i14); g(v, i3, i7, i11, i15)
    g(v, i0, i5, i10, i15); g(v, i1, i6, i11, i12); g(v, i2, i7, i8, i13); g(v, i3, i4, i9, i14)
  }

  @inline(__always)
  private static func g(_ v: UnsafeMutablePointer<UInt64>, _ a: Int, _ b: Int, _ c: Int, _ d: Int) {
    v[a] = blaMka(v[a], v[b]); v[d] = rotr(v[d] ^ v[a], 32)
    v[c] = blaMka(v[c], v[d]); v[b] = rotr(v[b] ^ v[c], 24)
    v[a] = blaMka(v[a], v[b]); v[d] = rotr(v[d] ^ v[a], 16)
    v[c] = blaMka(v[c], v[d]); v[b] = rotr(v[b] ^ v[c], 63)
  }

  @inline(__always)
  private static func blaMka(_ x: UInt64, _ y: UInt64) -> UInt64 {
    x &+ y &+ 2 &* ((x & 0xFFFF_FFFF) &* (y & 0xFFFF_FFFF))
  }

  @inline(__always)
  private static func rotr(_ x: UInt64, _ n: UInt64) -> UInt64 { (x >> n) | (x << (64 - n)) }

  /// Variable-length hash H' from RFC 9106 section 3.3.
  static func hPrime(_ input: [UInt8], length: Int) -> [UInt8] {
    let prefixed = le32(UInt32(length)) + input
    if length <= 64 { return Blake2b.hash(prefixed, outLength: length) }
    let r = (length + 31) / 32 - 2
    var out: [UInt8] = []
    out.reserveCapacity(length)
    var v = Blake2b.hash(prefixed, outLength: 64)
    out += v[0..<32]
    for _ in 1..<r {
      v = Blake2b.hash(v, outLength: 64)
      out += v[0..<32]
    }
    out += Blake2b.hash(v, outLength: length - 32 * r)
    return out
  }

  private static func le32(_ v: UInt32) -> [UInt8] {
    [UInt8(v & 0xFF), UInt8((v >> 8) & 0xFF), UInt8((v >> 16) & 0xFF), UInt8((v >> 24) & 0xFF)]
  }
}

/// BLAKE2b (RFC 7693), unkeyed, used only by Argon2.
enum Blake2b {
  private static let iv: [UInt64] = [
    0x6a09e667f3bcc908, 0xbb67ae8584caa73b, 0x3c6ef372fe94f82b, 0xa54ff53a5f1d36f1,
    0x510e527fade682d1, 0x9b05688c2b3e6c1f, 0x1f83d9abfb41bd6b, 0x5be0cd19137e2179,
  ]
  private static let sigma: [[Int]] = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
    [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
    [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
    [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
    [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
    [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
    [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
    [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
    [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
  ]

  static func hash(_ input: [UInt8], outLength: Int) -> [UInt8] {
    precondition(outLength >= 1 && outLength <= 64)
    var h = iv
    h[0] ^= 0x0101_0000 ^ UInt64(outLength)
    var counter: UInt64 = 0
    var offset = 0
    // All full blocks except the last block of input are compressed as non-final.
    while input.count - offset > 128 {
      counter += 128
      compress(&h, input, offset, counter, last: false)
      offset += 128
    }
    var lastBlock = [UInt8](repeating: 0, count: 128)
    let remaining = input.count - offset
    for i in 0..<remaining { lastBlock[i] = input[offset + i] }
    counter += UInt64(remaining)
    compress(&h, lastBlock, 0, counter, last: true)
    lastBlock.wipe()
    var out = [UInt8](repeating: 0, count: 64)
    for i in 0..<8 { writeLE64(&out, i * 8, h[i]) }
    return Array(out[0..<outLength])
  }

  private static func compress(_ h: inout [UInt64], _ block: [UInt8], _ offset: Int, _ counter: UInt64, last: Bool) {
    var m = [UInt64](repeating: 0, count: 16)
    for i in 0..<16 { m[i] = readLE64(block, offset + i * 8) }
    var v = h + iv
    v[12] ^= counter
    if last { v[14] = ~v[14] }
    for r in 0..<12 {
      let s = sigma[r % 10]
      mix(&v, 0, 4, 8, 12, m[s[0]], m[s[1]])
      mix(&v, 1, 5, 9, 13, m[s[2]], m[s[3]])
      mix(&v, 2, 6, 10, 14, m[s[4]], m[s[5]])
      mix(&v, 3, 7, 11, 15, m[s[6]], m[s[7]])
      mix(&v, 0, 5, 10, 15, m[s[8]], m[s[9]])
      mix(&v, 1, 6, 11, 12, m[s[10]], m[s[11]])
      mix(&v, 2, 7, 8, 13, m[s[12]], m[s[13]])
      mix(&v, 3, 4, 9, 14, m[s[14]], m[s[15]])
    }
    for i in 0..<8 { h[i] ^= v[i] ^ v[i + 8] }
  }

  @inline(__always)
  private static func mix(_ v: inout [UInt64], _ a: Int, _ b: Int, _ c: Int, _ d: Int, _ x: UInt64, _ y: UInt64) {
    v[a] = v[a] &+ v[b] &+ x; v[d] = rotr(v[d] ^ v[a], 32)
    v[c] = v[c] &+ v[d]; v[b] = rotr(v[b] ^ v[c], 24)
    v[a] = v[a] &+ v[b] &+ y; v[d] = rotr(v[d] ^ v[a], 16)
    v[c] = v[c] &+ v[d]; v[b] = rotr(v[b] ^ v[c], 63)
  }

  @inline(__always)
  private static func rotr(_ x: UInt64, _ n: UInt64) -> UInt64 { (x >> n) | (x << (64 - n)) }
}

@inline(__always)
func readLE64(_ b: [UInt8], _ o: Int) -> UInt64 {
  var v: UInt64 = 0
  for i in 0..<8 { v |= UInt64(b[o + i]) << (8 * UInt64(i)) }
  return v
}

@inline(__always)
func writeLE64(_ b: inout [UInt8], _ o: Int, _ v: UInt64) {
  for i in 0..<8 { b[o + i] = UInt8((v >> (8 * UInt64(i))) & 0xFF) }
}
