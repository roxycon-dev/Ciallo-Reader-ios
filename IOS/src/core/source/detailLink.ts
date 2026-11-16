/** Public links are normalized before handing them to the system share sheet. */
export function validDetailLink(raw: string | null | undefined): string | null {
  const text = raw?.trim(); if (!text || /\p{Cc}/u.test(text)) return null;
  try { const url = new URL(text); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : null; }
  catch { return null; }
}
export function resolveDetailLink(raw: string | null | undefined, base: string): string | null {
  const direct = validDetailLink(raw); if (direct) return direct;
  const path = raw?.trim(); if (!path || /\p{Cc}/u.test(path) || !validDetailLink(base)) return null;
  try { return validDetailLink(new URL(path, base).toString()); } catch { return null; }
}

export { validDetailLink as detailLinkValid, resolveDetailLink as detailLinkResolve };
