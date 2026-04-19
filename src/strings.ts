/**
 * Returns a copy with empty strings removed, or `undefined` if the result is empty.
 */
export function compactNonEmptyStrings(
  sources: string[] | undefined,
): string[] | undefined {
  if (!sources?.length) return undefined;
  const out = sources.filter((s) => s.length > 0);
  return out.length > 0 ? out : undefined;
}
