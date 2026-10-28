import Foundation
import CryptoKit
import zlib
import Darwin

struct TransferZipEntry {
    let path: String
    let size: UInt64
    let sha256: String
}

/// Bounded ZIP I/O for portable libraries. Android ZipOutputStream's raw
/// DEFLATE/data-descriptor files are supported. Export uses STORED entries with
/// known CRC/sizes, which Android ZipInputStream can read without buffering.
/// Format: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
enum TransferZip {
    static let maximum: UInt64 = 4294967296
    static let entryMaximum: UInt64 = 536870912
    private struct Entry {
        let path: String
        let flags: UInt16
        let method: UInt16
        let crc: UInt32
        let compressed: UInt64
        let expanded: UInt64
        let offset: UInt64
    }
    static func validPath(_ path: String) throws {
        let pieces = path.split(separator: "/", omittingEmptySubsequences: false)
        guard !path.isEmpty, path.utf16.count <= 1024, !path.contains("\\"), !path.contains(":"),
              !path.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }),
              pieces.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }),
              ["manifest.json", "database.rows", "settings.json"].contains(path) || path.hasPrefix("files/") else { throw TransferNativeError.invalid("归档资源路径无效或越界") }
    }
    private static func read(_ handle: FileHandle, at offset: UInt64, count: Int) throws -> Data {
        guard count >= 0 && count <= 262144 else { throw TransferNativeError.invalid("归档读取范围无效") }
        try handle.seek(toOffset: offset)
        let data = try handle.read(upToCount: count) ?? Data()
        guard data.count == count else { throw TransferNativeError.invalid("归档已截断") }; return data
    }
    private static func u16(_ data: Data, _ offset: Int) -> UInt16 { UInt16(data[offset]) | UInt16(data[offset + 1]) << 8 }
    private static func u32(_ data: Data, _ offset: Int) -> UInt32 { UInt32(u16(data, offset)) | UInt32(u16(data, offset + 2)) << 16 }
    private static func put16(_ value: UInt16, into data: inout Data) { data.append(UInt8(value & 255)); data.append(UInt8(value >> 8)) }
    private static func put32(_ value: UInt32, into data: inout Data) { put16(UInt16(value & 65535), into: &data); put16(UInt16(value >> 16), into: &data) }
    private static func crc(_ initial: UInt32, _ data: Data) -> UInt32 {
        data.withUnsafeBytes { UInt32(crc32(uLong(initial), $0.bindMemory(to: Bytef.self).baseAddress, uInt(data.count))) }
    }
    private static func newFile(_ url: URL) throws -> FileHandle {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let descriptor = url.path.withCString { Darwin.open($0, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, S_IRUSR | S_IWUSR) }
        guard descriptor >= 0 else { throw TransferNativeError.invalid("归档文件已存在、路径冲突或无法写入") }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        do { try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path) }
        catch { try? handle.close(); throw error }
        return handle
    }
    private static func directory(_ handle: FileHandle, size: UInt64) throws -> ([Entry], UInt64) {
        guard size >= 22, size <= maximum else { throw TransferNativeError.invalid("归档为空、已截断或超过 4GiB") }
        let count = Int(min(size, 65557)), tail = try read(handle, at: size - UInt64(count), count: count)
        var end: Int?
        for offset in stride(from: count - 22, through: 0, by: -1) {
            if u32(tail, offset) == 0x06054b50 && offset + 22 + Int(u16(tail, offset + 20)) == count { end = offset; break }
        }
        guard let end = end, u16(tail, end + 4) == 0, u16(tail, end + 6) == 0,
              u16(tail, end + 8) == u16(tail, end + 10) else { throw TransferNativeError.invalid("归档目录缺失或使用了分卷格式") }
        let entries = Int(u16(tail, end + 10)), length = UInt64(u32(tail, end + 12)), start = UInt64(u32(tail, end + 16))
        guard entries > 0, entries <= 50000, start + length == size - UInt64(count) + UInt64(end), length >= UInt64(entries * 46) else { throw TransferNativeError.invalid("归档目录或文件数量无效") }
        var position = start, result = [Entry](), seen = Set<String>(), expanded: UInt64 = 0
        for _ in 0..<entries {
            let header = try read(handle, at: position, count: 46)
            guard u32(header, 0) == 0x02014b50 else { throw TransferNativeError.invalid("归档中央目录损坏") }
            let flags = u16(header, 8), method = u16(header, 10), nameLength = Int(u16(header, 28)), extra = Int(u16(header, 30)), comment = Int(u16(header, 32))
            let compressed = UInt64(u32(header, 20)), size = UInt64(u32(header, 24)), offset = UInt64(u32(header, 42))
            let end = position + 46 + UInt64(nameLength + extra + comment)
            guard nameLength > 0, nameLength <= 4096, end <= start + length,
                  flags & ~UInt16(0x080e) == 0, method == 0 || method == 8, u16(header, 34) == 0,
                  (u32(header, 38) >> 16) & 0xf000 != 0xa000,
                  size <= entryMaximum, offset + 30 < start else { throw TransferNativeError.invalid("归档含加密、链接、不支持格式或超大资源") }
            let rawName = try read(handle, at: position + 46, count: nameLength)
            guard let path = String(data: rawName, encoding: .utf8) else { throw TransferNativeError.invalid("归档文件名不是 UTF-8") }
            try validPath(path)
            let canonical = path.precomposedStringWithCanonicalMapping.lowercased()
            guard seen.insert(canonical).inserted else { throw TransferNativeError.invalid("归档资源路径重复或冲突") }
            expanded += size; guard expanded <= maximum else { throw TransferNativeError.invalid("展开数据超过 4GiB") }
            if method == 0 && (size != compressed || flags & 8 != 0) { throw TransferNativeError.invalid("未压缩条目描述无效") }
            result.append(Entry(path: path, flags: flags, method: method, crc: u32(header, 16), compressed: compressed, expanded: size, offset: offset))
            position = end
        }
        guard position == start + length else { throw TransferNativeError.invalid("归档目录包含未识别数据") }
        return (result, start)
    }
    static func extract(_ archive: URL, to destination: URL, cancelled: () -> Bool = { false }) throws -> [TransferZipEntry] {
        let input = try FileHandle(forReadingFrom: archive); defer { try? input.close() }
        let size = try input.seekToEnd(), (entries, directoryOffset) = try directory(input, size: size)
        let root = destination.standardizedFileURL.resolvingSymlinksInPath()
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        var metadata = [TransferZipEntry](), ranges = [(UInt64, UInt64)](), expanded: UInt64 = 0, nextSpaceCheck: UInt64 = 0
        for entry in entries {
            guard !cancelled() else { throw TransferNativeError.invalid("归档操作已取消") }
            let header = try read(input, at: entry.offset, count: 30), nameLength = Int(u16(header, 26)), extra = Int(u16(header, 28))
            guard u32(header, 0) == 0x04034b50, u16(header, 6) == entry.flags, u16(header, 8) == entry.method,
                  nameLength > 0, nameLength <= 4096 else { throw TransferNativeError.invalid("归档本地条目与清单不符") }
            let rawName = try read(input, at: entry.offset + 30, count: nameLength)
            guard String(data: rawName, encoding: .utf8) == entry.path else { throw TransferNativeError.invalid("归档文件名不一致") }
            let start = entry.offset + 30 + UInt64(nameLength + extra), end = start + entry.compressed
            guard start <= directoryOffset, end <= directoryOffset else { throw TransferNativeError.invalid("归档分块越界") }
            var rangeEnd = end
            if entry.flags & 8 != 0 {
                let first = try read(input, at: end, count: 4), signature = u32(first, 0) == 0x08074b50
                let descriptor = try read(input, at: end + (signature ? 4 : 0), count: 12)
                guard u32(descriptor, 0) == entry.crc, UInt64(u32(descriptor, 4)) == entry.compressed,
                      UInt64(u32(descriptor, 8)) == entry.expanded else { throw TransferNativeError.invalid("归档数据描述符校验失败") }
                rangeEnd += signature ? 16 : 12
            } else {
                guard u32(header, 14) == entry.crc, UInt64(u32(header, 18)) == entry.compressed, UInt64(u32(header, 22)) == entry.expanded else { throw TransferNativeError.invalid("归档条目大小或 CRC 不一致") }
            }
            guard rangeEnd <= directoryOffset else { throw TransferNativeError.invalid("归档描述符越界") }
            ranges.append((entry.offset, rangeEnd))
            let target = root.appendingPathComponent(entry.path).standardizedFileURL.resolvingSymlinksInPath()
            guard target.path.hasPrefix(root.path + "/") else { throw TransferNativeError.invalid("归档路径越界") }
            let output = try newFile(target); defer { try? output.close() }
            var written: UInt64 = 0, checksum: UInt32 = 0, hash = SHA256()
            let consume: (Data) throws -> Void = { bytes in
                guard !cancelled() else { throw TransferNativeError.invalid("归档操作已取消") }
                written += UInt64(bytes.count); expanded += UInt64(bytes.count)
                guard written <= entry.expanded, written <= entryMaximum, expanded <= maximum else { throw TransferNativeError.invalid("归档展开数据超出声明容量") }
                if expanded >= nextSpaceCheck {
                    let available = try root.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage ?? 0
                    guard available > 16 * 1024 * 1024 else { throw TransferNativeError.invalid("存储空间不足") }
                    nextSpaceCheck = expanded + 8 * 1024 * 1024
                }
                checksum = crc(checksum, bytes); hash.update(data: bytes); try output.write(contentsOf: bytes)
            }
            if entry.method == 0 {
                var offset: UInt64 = 0
                while offset < entry.compressed {
                    let bytes = try read(input, at: start + offset, count: Int(min(65536, entry.compressed - offset)))
                    try consume(bytes); offset += UInt64(bytes.count)
                }
            } else { try inflateEntry(input, start: start, compressed: entry.compressed, consume: consume) }
            guard written == entry.expanded, checksum == entry.crc else { throw TransferNativeError.invalid("归档展开长度或 CRC 校验失败") }
            try output.synchronize(); try output.close()
            metadata.append(TransferZipEntry(path: entry.path, size: written, sha256: hash.finalize().map { String(format: "%02x", $0) }.joined()))
        }
        let sorted = ranges.sorted { $0.0 < $1.0 }
        guard sorted.first?.0 == 0 else { throw TransferNativeError.invalid("归档包含前置数据") }
        for index in sorted.indices.dropFirst() { guard sorted[index - 1].1 <= sorted[index].0 else { throw TransferNativeError.invalid("归档分块重叠") } }
        return metadata
    }
    private static func inflateEntry(_ input: FileHandle, start: UInt64, compressed: UInt64, consume: (Data) throws -> Void) throws {
        var stream = z_stream()
        guard inflateInit2_(&stream, -MAX_WBITS, zlibVersion(), Int32(MemoryLayout<z_stream>.size)) == Z_OK else { throw TransferNativeError.invalid("无法初始化归档解压器") }
        defer { inflateEnd(&stream) }
        var offset: UInt64 = 0, ended = false, output = [UInt8](repeating: 0, count: 65536)
        while offset < compressed {
            let bytes = try read(input, at: start + offset, count: Int(min(65536, compressed - offset))); offset += UInt64(bytes.count)
            try bytes.withUnsafeBytes { raw in
                stream.next_in = UnsafeMutablePointer(mutating: raw.bindMemory(to: Bytef.self).baseAddress); stream.avail_in = uInt(bytes.count)
                repeat {
                    let before = stream.avail_in
                    let status = output.withUnsafeMutableBufferPointer { buffer -> Int32 in
                        stream.next_out = buffer.baseAddress; stream.avail_out = uInt(buffer.count)
                        return inflate(&stream, Z_NO_FLUSH)
                    }
                    let count = output.count - Int(stream.avail_out)
                    if count > 0 { try consume(Data(output.prefix(count))) }
                    if status == Z_STREAM_END {
                        guard stream.avail_in == 0, offset == compressed else { throw TransferNativeError.invalid("压缩分块包含尾随数据") }
                        ended = true; break
                    }
                    guard status == Z_OK || status == Z_BUF_ERROR else { throw TransferNativeError.invalid("压缩分块已损坏") }
                    if count == 0 && stream.avail_in == before {
                        guard stream.avail_in == 0 else { throw TransferNativeError.invalid("解压器未能消费数据") }; break
                    }
                } while stream.avail_in > 0 || stream.avail_out == 0
            }
        }
        guard ended else { throw TransferNativeError.invalid("压缩分块已截断") }
    }
    static func hashFile(_ url: URL) throws -> TransferZipEntry {
        let input = try FileHandle(forReadingFrom: url); defer { try? input.close() }; var hash = SHA256(), size: UInt64 = 0
        while true {
            let bytes = try input.read(upToCount: 65536) ?? Data(); if bytes.isEmpty { break }
            size += UInt64(bytes.count); guard size <= entryMaximum else { throw TransferNativeError.invalid("单个归档资源超过 512MiB") }; hash.update(data: bytes)
        }
        return TransferZipEntry(path: url.lastPathComponent, size: size, sha256: hash.finalize().map { String(format: "%02x", $0) }.joined())
    }
    static func pack(_ entries: [(path: String, source: URL)], to target: URL, expectedHashes: [String: String] = [:], cancelled: () -> Bool = { false }) throws {
        guard !entries.isEmpty, entries.count <= 50000 else { throw TransferNativeError.invalid("归档文件过多或为空") }
        let output = try newFile(target); defer { try? output.close() }
        var central = Data(), offset: UInt64 = 0, expanded: UInt64 = 0, seen = Set<String>()
        for entry in entries {
            try validPath(entry.path)
            guard !cancelled(), seen.insert(entry.path.precomposedStringWithCanonicalMapping.lowercased()).inserted else { throw TransferNativeError.invalid("归档操作取消或路径重复") }
            let name = Data(entry.path.utf8), input = try FileHandle(forReadingFrom: entry.source); defer { try? input.close() }
            var size: UInt64 = 0, checksum: UInt32 = 0, hash = SHA256()
            while true {
                guard !cancelled() else { throw TransferNativeError.invalid("归档操作已取消") }
                let bytes = try input.read(upToCount: 65536) ?? Data(); if bytes.isEmpty { break }
                size += UInt64(bytes.count); guard size <= entryMaximum else { throw TransferNativeError.invalid("单个归档资源超过 512MiB") }
                checksum = crc(checksum, bytes); hash.update(data: bytes)
            }
            expanded += size
            guard expanded <= maximum, offset + 30 + UInt64(name.count) + size < UInt64(UInt32.max) else { throw TransferNativeError.invalid("归档超过 4GiB") }
            let expectedHash = hash.finalize()
            if let expected = expectedHashes[entry.path] {
                guard expectedHash.map({ String(format: "%02x", $0) }).joined() == expected else { throw TransferNativeError.invalid("归档资源与完整性清单不一致") }
            }
            var header = Data(); put32(0x04034b50, into: &header)
            for value in [UInt16(20), 0x0800, 0, 0, 0x21] { put16(value, into: &header) }
            put32(checksum, into: &header); put32(UInt32(size), into: &header); put32(UInt32(size), into: &header)
            put16(UInt16(name.count), into: &header); put16(0, into: &header); header.append(name)
            try output.write(contentsOf: header); try input.seek(toOffset: 0)
            var copied: UInt64 = 0, copiedHash = SHA256()
            while copied < size {
                guard !cancelled() else { throw TransferNativeError.invalid("归档操作已取消") }
                let bytes = try input.read(upToCount: Int(min(65536, size - copied))) ?? Data()
                guard !bytes.isEmpty else { throw TransferNativeError.invalid("归档原资源已改变") }
                copied += UInt64(bytes.count); copiedHash.update(data: bytes); try output.write(contentsOf: bytes)
            }
            guard copiedHash.finalize() == expectedHash, (try input.read(upToCount: 1) ?? Data()).isEmpty else { throw TransferNativeError.invalid("归档原资源已改变") }
            put32(0x02014b50, into: &central)
            for value in [UInt16(20), 20, 0x0800, 0, 0, 0x21] { put16(value, into: &central) }
            put32(checksum, into: &central); put32(UInt32(size), into: &central); put32(UInt32(size), into: &central)
            put16(UInt16(name.count), into: &central)
            for _ in 0..<4 { put16(0, into: &central) }
            put32(0, into: &central); put32(UInt32(offset), into: &central); central.append(name)
            offset += UInt64(header.count) + size
        }
        guard offset + UInt64(central.count) + 22 <= maximum else { throw TransferNativeError.invalid("归档超过 4GiB") }
        try output.write(contentsOf: central)
        var end = Data(); put32(0x06054b50, into: &end); put16(0, into: &end); put16(0, into: &end)
        put16(UInt16(entries.count), into: &end); put16(UInt16(entries.count), into: &end)
        put32(UInt32(central.count), into: &end); put32(UInt32(offset), into: &end); put16(0, into: &end)
        try output.write(contentsOf: end); try output.synchronize()
    }
}
