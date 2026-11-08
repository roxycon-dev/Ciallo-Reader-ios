/**
 * `psl` ships its types at `types/index.d.ts` but its `exports` map only declares
 * `import`/`require` conditions, so TypeScript's `bundler`/`node16` resolution cannot
 * find them (`TS7016: Could not find a declaration file for module 'psl'`).
 *
 * This re-declares the *upstream* `types/index.d.ts` verbatim rather than papering over
 * it with `any` (project rule: no `any`, no `@ts-expect-error`, no `eslint-disable`).
 * If `psl` ever fixes its `exports.types`, delete this file.
 *
 * Upstream source: node_modules/psl/types/index.d.ts
 */
declare module 'psl' {
  export type ParsedDomain = {
    input: string;
    tld: string | null;
    sld: string | null;
    domain: string | null;
    subdomain: string | null;
    listed: boolean;
  };

  export type ErrorResult<T extends string> = {
    input: string;
    error: {
      code: T;
      message: string;
    };
  };

  /** Parse a domain name and return its components. */
  export function parse(input: string): ParsedDomain | ErrorResult<string>;

  /** Get the base domain (eTLD+1) for a full domain name. */
  export function get(domain: string): string | null;

  /** Whether the given domain belongs to a known public suffix. */
  export function isValid(domain: string): boolean;
}