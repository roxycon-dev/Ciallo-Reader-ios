package parity

import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * Exact port of Android `PrivacyManager` hashPin / derivePin / newSaltHex.
 *
 * Android source:
 *   novel-reader/app/src/main/java/com/example/data/PrivacyManager.kt
 *
 * - hashPin:  SHA-256(saltBytes + pinBytes) hex
 * - derivePin: PBEKeySpec + SecretKeyFactory PBKDF2WithHmacSHA1, 120_000 iters, 256 bits
 * - newSaltHex: SecureRandom 16 bytes hex
 */
object PinKdf {
    const val PIN_LENGTH = 6
    const val PBKDF2_ALGORITHM = "PBKDF2WithHmacSHA1"
    const val PBKDF2_ITERATIONS = 120_000
    const val PBKDF2_BITS = 256
    const val SALT_BYTES = 16

    /** SHA-256(盐 + PIN) 十六进制 — Android legacy path (`hashPin`). */
    fun hashPin(pin: String, saltHex: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val salt = hexToBytes(saltHex)
        digest.update(salt)
        digest.update(pin.toByteArray(Charsets.UTF_8))
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    /** PBEKeySpec + SecretKeyFactory — Android modern path (`derivePin`). */
    fun derivePin(pin: String, saltHex: String): String {
        val bytes = hexToBytes(saltHex)
        val spec = PBEKeySpec(pin.toCharArray(), bytes, PBKDF2_ITERATIONS, PBKDF2_BITS)
        return try {
            SecretKeyFactory.getInstance(PBKDF2_ALGORITHM).generateSecret(spec).encoded
                .joinToString("") { "%02x".format(it) }
        } finally {
            spec.clearPassword()
        }
    }

    /** SecureRandom 16 bytes hex — Android `newSaltHex`. */
    fun newSaltHex(): String {
        val bytes = ByteArray(SALT_BYTES)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    fun isValidPin(pin: String): Boolean =
        pin.length == PIN_LENGTH && pin.all { it in '0'..'9' }

    private fun hexToBytes(hex: String): ByteArray =
        hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
}
