// Test-only command line peer: lets the Kotlin core tests transfer to and from the Swift core
// over a real socket, proving the two implementations speak the same protocol.
//   TransferPeer receive <dir>         prints "CODE <qr text>", then the received items
//   TransferPeer send <dir> <code>     fills a vault, prints its items, sends them
// Items are printed as: ITEM <createdAt> <kind> <mime> <sha256 of content> <thumb hex or ->
import Foundation
@testable import VaultCoreKit

final class FakeChip: HardwareKey {
  var key: [UInt8]?
  func exists() -> Bool { key != nil }
  func create() throws { key = Primitives.randomBytes(32) }
  func mix(_ data: [UInt8]) throws -> [UInt8] { Primitives.hmacSha256(key: key!, data: data) }
  func destroy() throws { key = nil }
}

final class Bytes: ByteSource {
  let data: [UInt8]
  var pos = 0
  init(_ d: [UInt8]) { data = d }
  func read(into buffer: inout [UInt8], offset: Int, max: Int) throws -> Int {
    let n = min(max, data.count - pos)
    for i in 0..<n { buffer[offset + i] = data[pos + i] }
    pos += n
    return n
  }
}

func hex(_ b: [UInt8]) -> String { b.map { String(format: "%02x", $0) }.joined() }

func printItems(_ v: Vault) throws {
  for item in try v.list().sorted(by: { $0.meta.createdAtEpochMs < $1.meta.createdAtEpochMs }) {
    let sink = DigestSink()
    try v.read(id: item.id, output: sink)
    let thumb = try v.thumbnail(id: item.id).map(hex) ?? "-"
    print("ITEM \(item.meta.createdAtEpochMs) \(item.meta.kind.rawValue) \(item.meta.mimeType) \(hex(sink.hasher.finish())) \(thumb)")
  }
}

let args = CommandLine.arguments
setvbuf(stdout, nil, _IOLBF, 0)
do {
  let params = try Argon2Params(memoryKiB: 64, iterations: 1, parallelism: 1)
  let vault = try Vault(root: URL(fileURLWithPath: args[2]), hardwareKey: FakeChip(), params: params, chunkSize: 4096)
  try vault.create(pin: Array("731904".utf8))
  if args[1] == "receive" {
    let secret = Primitives.randomBytes(32)
    let listener = try TransferListener(host: "127.0.0.1")
    print("CODE " + TransferCode(host: "127.0.0.1", port: listener.port, secret: secret).encode())
    let channel = try SecureChannel.server(try listener.accept(timeoutSeconds: 30), secret: secret)
    let p = try TransferReceiver(vault: vault).run(channel)
    channel.close()
    try printItems(vault)
    print("DONE \(p.itemsDone)")
  } else {
    for (i, size) in [0, 1, 4096, 20_000, 300_000].enumerated() {
      _ = try vault.importItem(content: Bytes(Primitives.randomBytes(size)),
                               meta: ItemMeta(kind: i % 2 == 0 ? .PHOTO : .VIDEO, mimeType: i % 2 == 0 ? "image/heic" : "video/quicktime",
                                              createdAtEpochMs: 1_800_000_000_000 + Int64(i)),
                               thumbnail: i == 3 ? nil : [UInt8(i), 7, 7])
    }
    try printItems(vault)
    let code = try TransferCode.parse(args[3])
    let channel = try SecureChannel.client(try SocketStream.connect(host: code.host, port: code.port), secret: code.secret)
    let p = try TransferSender(vault: vault).run(channel)
    channel.close()
    print("DONE \(p.itemsDone)")
  }
} catch {
  print("ERROR \(error)")
  exit(1)
}
