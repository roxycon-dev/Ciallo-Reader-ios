import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { md5, sha1 } from '@noble/hashes/legacy.js';
import { hmac } from '@noble/hashes/hmac.js';
import { aesDecrypt } from '@core/crypto/aes';
import type { CryptoPort } from '@core/source/js/jsPlatform';

export const sourceWorkerCrypto: CryptoPort = {
  digest(algorithm, bytes) {
    const name = algorithm.toUpperCase().replace(/-/g, '');
    if (name === 'MD5') return md5(bytes);
    if (name === 'SHA1') return sha1(bytes);
    if (name === 'SHA256') return sha256(bytes);
    if (name === 'SHA512') return sha512(bytes);
    throw new Error(`不支持的摘要算法：${algorithm}`);
  },
  hmac(algorithm, key, bytes) {
    const name = algorithm.toUpperCase().replace(/[-/]/g, '');
    if (name === 'HMACSHA1' || name === 'SHA1') return hmac(sha1, key, bytes);
    if (name === 'HMACSHA256' || name === 'SHA256') return hmac(sha256, key, bytes);
    if (name === 'HMACSHA512' || name === 'SHA512') return hmac(sha512, key, bytes);
    if (name === 'HMACMD5' || name === 'MD5') return hmac(md5, key, bytes);
    throw new Error(`不支持的 MAC 算法：${algorithm}`);
  },
  aesDecrypt,
  // Android's bridge has no RSA operation; the handler returns null for it.
  rsaDecrypt: () => { throw new Error('书源桥不提供 RSA 解密'); },
  randomUUID: () => crypto.randomUUID(),
  randomInt: (min, max) => min + Math.floor(Math.random() * (max - min)),
  randomDouble: (min, max) => min + Math.random() * (max - min),
};
