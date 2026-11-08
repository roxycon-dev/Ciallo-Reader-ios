import { describe, expect, it } from 'vitest';
import {
  TRANSLATION_EMPTY,
  TRANSLATION_FORMAT,
  TRANSLATION_NETWORK,
  TRANSLATION_OCR,
  TRANSLATION_PRIVACY,
  TRANSLATION_TIMEOUT,
  TranslationException,
  translationFailureForHttpStatus,
  translationFailureFrom,
} from '@core/mangatranslate/translationFailure';

/**
 * 期望值按 Kotlin 源码字面量推演。Kotlin 源：
 * mangatranslate/TranslationFailure.kt L4-36。
 */

describe('translationFailure (Kotlin TranslationFailure.kt)', () => {
  describe('preset constants (L8-16)', () => {
    it('carries the exact code / description / retryable triple', () => {
      expect(TRANSLATION_PRIVACY).toEqual({
        code: 'privacy',
        description: '隐私模式禁止在线翻译，请关闭隐私模式后再试',
        retryable: false,
      });
      expect(TRANSLATION_OCR).toEqual({
        code: 'ocr',
        description: '文字识别未成功，请检查清晰度或选择原文语言',
        retryable: true,
      });
      expect(TRANSLATION_EMPTY.retryable).toBe(true);
      expect(TRANSLATION_FORMAT.retryable).toBe(true);
    });
  });

  describe('http(status) (L17-24)', () => {
    it('maps the documented status buckets', () => {
      expect(translationFailureForHttpStatus(401).code).toBe('auth');
      expect(translationFailureForHttpStatus(403).code).toBe('auth');
      expect(translationFailureForHttpStatus(402).code).toBe('quota');
      expect(translationFailureForHttpStatus(404).code).toBe('endpoint');
      expect(translationFailureForHttpStatus(429)).toEqual({
        code: 'limited',
        description: '翻译服务繁忙或限流，请稍后重试',
        retryable: true,
      });
      expect(translationFailureForHttpStatus(500).code).toBe('service');
      expect(translationFailureForHttpStatus(503).retryable).toBe(true);
      expect(translationFailureForHttpStatus(418).code).toBe('request');
    });

    it('embeds the status in the description', () => {
      expect(translationFailureForHttpStatus(403).description).toContain('403');
      expect(translationFailureForHttpStatus(502).description).toContain('502');
      expect(translationFailureForHttpStatus(418).description).toContain('418');
    });

    it('treats the 500..599 band inclusively', () => {
      expect(translationFailureForHttpStatus(599).code).toBe('service');
      expect(translationFailureForHttpStatus(600).code).toBe('request');
    });
  });

  describe('from(error) (L25-32)', () => {
    it('unwraps a TranslationException first', () => {
      const failure = TRANSLATION_FORMAT;
      expect(translationFailureFrom(new TranslationException(failure))).toBe(failure);
    });

    it('maps a timeout before the generic network branch', () => {
      const abort = new Error('aborted');
      abort.name = 'AbortError';
      expect(translationFailureFrom(abort)).toBe(TRANSLATION_TIMEOUT);
    });

    it('maps a fetch TypeError to network', () => {
      expect(translationFailureFrom(new TypeError('Failed to fetch'))).toBe(TRANSLATION_NETWORK);
    });

    it('falls back to the retryable internal failure', () => {
      expect(translationFailureFrom(new Error('boom'))).toEqual({
        code: 'internal',
        description: '翻译处理失败，请切换引擎或重新进入阅读器',
        retryable: true,
      });
      expect(translationFailureFrom('not even an error')).toEqual({
        code: 'internal',
        description: '翻译处理失败，请切换引擎或重新进入阅读器',
        retryable: true,
      });
    });
  });
});
