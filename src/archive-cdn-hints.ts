/**
 * HTTP **Cache-Control** suggestions for archive file downloads behind CDNs / browsers.
 * Operators still configure CDN behavior; these are conservative defaults.
 */

export interface SuggestedCacheControlForArchiveOptions {
  /** `max-age` in seconds (default 3600). */
  maxAgeSeconds?: number;
  /** When true, add `immutable` (only if archive URL is content-addressed / versioned). */
  immutable?: boolean;
}

/**
 * Suggested `Cache-Control` header for a downloaded `.zip` / `.tar` artifact when the URL is not
 * reused for different content without version change.
 */
export function suggestedCacheControlForArchiveDownload(
  options?: SuggestedCacheControlForArchiveOptions,
): string {
  const maxAge = options?.maxAgeSeconds ?? 3600;
  const imm = options?.immutable === true ? ", immutable" : "";
  return `private, max-age=${maxAge}${imm}`;
}
