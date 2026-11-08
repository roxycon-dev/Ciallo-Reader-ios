import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  extractCleanTextFromHtmlLocal,
  isEpubFile,
  parseEpubFromZip,
} from '../../src/core/parser/epubParser';

const CONTAINER_XML = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const OPF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:12345</dc:identifier>
    <dc:title>测试书</dc:title>
    <dc:creator>测试作者</dc:creator>
  </metadata>
  <manifest>
    <item id="chap1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chap1"/>
  </spine>
</package>`;

const CHAPTER1_XHTML = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>第一章</title></head>
<body>
  <h1>第一章</h1>
  <p>你好</p>
</body>
</html>`;

/** Minimal but genuinely decodable JPEG: SOI + SOF0(800x600) + EOI. */
const JPEG_800x600 = new Uint8Array([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0x01, 0x02, 0x03, 0x01, 0x11, 0x00,
  0xff, 0xd9,
]);

function buildEpub(extraFiles: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    'mimetype': strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(CONTAINER_XML),
    'OEBPS/content.opf': strToU8(OPF_XML),
    'OEBPS/chapter1.xhtml': strToU8(CHAPTER1_XHTML),
    ...extraFiles,
  });
}

describe('epubParser', () => {
  it('识别 .epub 扩展名', () => {
    expect(isEpubFile('a.epub')).toBe(true);
    expect(isEpubFile('BOOK.EPUB')).toBe(true);
    expect(isEpubFile('x.mobi')).toBe(false);
  });

  it('解析最小 EPUB：标题 / 作者 / 章节', () => {
    const parsed = parseEpubFromZip(buildEpub());
    expect(parsed.title).toBe('测试书');
    expect(parsed.author).toBe('测试作者');
    expect(parsed.chapters.length).toBe(1);
    expect(parsed.chapters[0]?.title).toContain('第一章');
    expect(parsed.chapters[0]?.content).toContain('你好');
  });

  it('EPUB2 meta name=cover 解析封面 href', () => {
    const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>带封面</dc:title>
    <dc:creator>作者</dc:creator>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="cover-img" href="images/cover.jpg" media-type="image/jpeg"/>
    <item id="chap1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chap1"/>
  </spine>
</package>`;
    const parsed = parseEpubFromZip(
      buildEpub({
        'OEBPS/content.opf': strToU8(opf),
        // Kotlin L186-193 validates the declared cover with `imageBounds` before
        // accepting it, so a real decodable JPEG (with a SOF0 frame header) is
        // required here — a bare SOI/EOI pair yields outWidth=0 on Android and
        // would fall through to the violent fallback.
        'OEBPS/images/cover.jpg': JPEG_800x600,
      }),
    );
    expect(parsed.coverHref).toBe('OEBPS/images/cover.jpg');
  });

  it('封面字节无法解码时回退到暴力兜底（L197-280）', () => {
    const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>坏封面</dc:title><dc:creator>作者</dc:creator>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="cover-img" href="images/cover.jpg" media-type="image/jpeg"/>
    <item id="chap1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="chap1"/></spine>
</package>`;
    const parsed = parseEpubFromZip(
      buildEpub({
        'OEBPS/content.opf': strToU8(opf),
        // SOI + EOI only: probeImageSize (Android BitmapFactory bounds) fails.
        'OEBPS/images/cover.jpg': new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      }),
    );
    // Declared cover rejected → priority 2 (first <img> in first spine doc) finds
    // nothing → priority 3 (largest) also fails to decode → no cover at all.
    expect(parsed.coverHref).toBeNull();
  });

  it('DRM 加密时抛出明确错误', () => {
    const encryption = `<?xml version="1.0"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <EncryptedData>
    <EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
  </EncryptedData>
</encryption>`;
    const ok = parseEpubFromZip(buildEpub({ 'META-INF/encryption.xml': strToU8(encryption) }));
    expect(ok.chapters.length).toBe(1);

    const badEncryption = encryption.replace(
      'http://www.idpf.org/2008/embedding',
      'http://www.w3.org/2001/04/xmlenc#aes256-cbc',
    );
    expect(() =>
      parseEpubFromZip(buildEpub({ 'META-INF/encryption.xml': strToU8(badEncryption) })),
    ).toThrow('EPUB 正文受 DRM 加密，无法导入');
  });

  it('缺少 container.xml 时报错', () => {
    expect(() => parseEpubFromZip(zipSync({ 'mimetype': strToU8('application/epub+zip') }))).toThrow(
      'META-INF/container.xml',
    );
  });

  it('extractCleanTextFromHtmlLocal 去标签并保留正文', () => {
    const text = extractCleanTextFromHtmlLocal(
      '<html><head><style>p{color:red}</style></head><body><h1>标题</h1><p>你好<br/>世界</p><script>var x=1;</script></body></html>',
    );
    expect(text).toContain('标题');
    expect(text).toContain('你好');
    expect(text).toContain('世界');
    expect(text).not.toContain('color');
    expect(text).not.toContain('var x');
  });
});
