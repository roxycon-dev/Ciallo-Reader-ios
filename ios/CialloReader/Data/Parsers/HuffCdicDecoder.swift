import Foundation

// MARK: - HUFF/CDIC 哈夫曼解压（KindleUnpack mobi_uncompress.py HuffcdicReader 逐行移植）
// 与安卓 MobiParser.HuffCdic（移植自 MIT 的 Ephemerality.Unpack）同一算法血统：
// HUFF 记录（dict1 256 项 + mincode/maxcode 64 项）→ CDIC 记录（长度前缀短语表，跨记录累积）→
// 逐比特解码：code 窗口查 dict1[code>>24]，非终结时沿 mincode 爬升 codelen，
// r = (maxcode - code) >> (32 - codelen) 得短语下标；非字面量短语递归解压后缓存。

final class HuffCdicDecoder {
    private struct Dict1Entry {
        let codeLen: Int
        let term: Bool
        let maxCode: UInt64
    }

    private var dict1: [Dict1Entry] = []
    private var minCode: [UInt64] = []   // [0..32]
    private var maxCode: [UInt64] = []   // [0..32]
    private var dictionary: [(bytes: [UInt8], literal: Bool)] = []

    /// records：PDB 记录表；huffRecordIndex：MOBI 头 0x70 处的 HUFF 记录号；
    /// huffRecordCount：0x74 处的 CDIC 记录数。
    init(records: [MobiParser.PdbRecord], bookData: Data, huffRecordIndex: Int, huffRecordCount: Int) throws {
        guard huffRecordIndex > 0, huffRecordIndex < records.count else {
            throw ImportError("HUFF 记录号无效")
        }
        let huff = bookData.subdata(in: records[huffRecordIndex].offset..<(records[huffRecordIndex].offset + records[huffRecordIndex].size))
        // 魔数 "HUFF\0\0\0\x18"
        guard huff.count >= 24,
              huff[0] == 0x48, huff[1] == 0x55, huff[2] == 0x46, huff[3] == 0x46,
              huff[4] == 0, huff[5] == 0, huff[6] == 0, huff[7] == 0x18 else {
            throw ImportError("无效的 HUFF 头")
        }
        let off1 = Int(MobiParser.be32(huff, at: 8))
        let off2 = Int(MobiParser.be32(huff, at: 12))

        // dict1：256 × BE u32；codelen = v & 0x1F，term = v & 0x80，maxcode = ((v>>8)+1) << (32-codelen) - 1
        dict1.reserveCapacity(256)
        for i in 0..<256 {
            let v = MobiParser.be32(huff, at: off1 + i * 4)
            let codeLen = Int(v & 0x1F)
            guard codeLen != 0, codeLen <= 32 else { throw ImportError("HUFF dict1 codelen 非法") }
            let term = (v & 0x80) != 0
            let raw = UInt64(v >> 8)
            let maxCode = ((raw &+ 1) << UInt64(32 - codeLen)) &- 1
            dict1.append(Dict1Entry(codeLen: codeLen, term: term, maxCode: maxCode))
        }

        // dict2：64 × BE u32（偶数位 mincode / 奇数位 maxcode），下标 = codelen
        var dict2: [UInt32] = []
        dict2.reserveCapacity(64)
        for i in 0..<64 {
            dict2.append(MobiParser.be32(huff, at: off2 + i * 4))
        }
        minCode.append(0)                                // codelen 0
        maxCode.append((UInt64(1) << 32) &- 1)           // ((0+1)<<32)-1
        for c in 1...32 {
            let mv = UInt64(dict2[2 * (c - 1)])
            let xv = UInt64(dict2[2 * (c - 1) + 1])
            minCode.append(mv << UInt64(32 - c))
            maxCode.append(((xv &+ 1) << UInt64(32 - c)) &- 1)
        }

        // CDIC 短语表：跨记录累积，n = min(1<<bits, phrases - 已载入)
        guard huffRecordCount >= 1 else { throw ImportError("HUFF 缺少 CDIC 记录") }
        for k in 1...huffRecordCount {
            let idx = huffRecordIndex + k
            guard idx < records.count else { break }
            let cdic = bookData.subdata(in: records[idx].offset..<(records[idx].offset + records[idx].size))
            guard cdic.count >= 16,
                  cdic[0] == 0x43, cdic[1] == 0x44, cdic[2] == 0x49, cdic[3] == 0x43,
                  cdic[4] == 0, cdic[5] == 0, cdic[6] == 0, cdic[7] == 0x10 else {
                throw ImportError("无效的 CDIC 头")
            }
            let phrases = Int(MobiParser.be32(cdic, at: 8))
            let bits = Int(MobiParser.be32(cdic, at: 12))
            let n = min(1 << bits, phrases - dictionary.count)
            guard n > 0 else { continue }
            for j in 0..<n {
                let off = 2 * j
                let blen = Int(MobiParser.be16(cdic, at: 16 + off))
                let len = blen & 0x7FFF
                let start = 18 + off
                guard start + len <= cdic.count else { throw ImportError("CDIC 短语越界") }
                let sliceBytes = [UInt8](cdic.subdata(in: start..<(start + len)))
                dictionary.append((sliceBytes, (blen & 0x8000) != 0))
            }
        }
        guard !dictionary.isEmpty else { throw ImportError("CDIC 短语表为空") }
    }

    /// 单条文本记录解压（位流不跨记录；尾部 8 字节零填充供 64 位窗口滑出）
    func unpack(_ input: [UInt8]) -> Data {
        var data = input
        data.append(contentsOf: [UInt8](repeating: 0, count: 8))
        var bitsLeft = input.count * 8
        var pos = 0
        var x = Self.readU64(data, pos)
        var n = 32
        var s: [UInt8] = []
        s.reserveCapacity(input.count * 3)

        while true {
            if n <= 0 {
                pos += 4
                x = Self.readU64(data, pos)
                n += 32
            }
            let code = (x >> UInt64(n)) & 0xFFFF_FFFF

            var entry = dict1[Int(code >> 24)]
            if !entry.term {
                var cl = entry.codeLen
                while cl < 32 && code < minCode[cl] {
                    cl += 1
                }
                entry.codeLen = cl
                entry.maxCode = maxCode[cl]
            }

            n -= entry.codeLen
            bitsLeft -= entry.codeLen
            if bitsLeft < 0 { break }

            let shift = UInt64(32 - entry.codeLen)
            let diff = Int64(bitPattern: entry.maxCode &- code)
            guard diff >= 0 else { break }
            let r = Int(UInt64(bitPattern: Int64(diff)) >> shift)
            guard r >= 0, r < dictionary.count else { break }

            var (sliceBytes, literal) = dictionary[r]
            if !literal {
                // 递归解压并缓存（先占位防环）
                dictionary[r] = ([], true)
                let resolved = unpack(sliceBytes)
                dictionary[r] = (resolved, true)
                sliceBytes = resolved
            }
            s.append(contentsOf: sliceBytes)
        }
        return Data(s)
    }

    private static func readU64(_ data: [UInt8], _ pos: Int) -> UInt64 {
        guard pos >= 0, pos + 8 <= data.count else { return 0 }
        var v: UInt64 = 0
        for i in 0..<8 {
            v = (v << 8) | UInt64(data[pos + i])
        }
        return v
    }
}
