/**
 * Dependency-free value truncation shared by ui, commands and status.
 * Kept separate from ui.ts so importing it never pulls in the HTTP server.
 */

export const PREVIEW_MAX_CHARS = 60;

// Counts and slices by Unicode code point so a surrogate pair is never split.
export function truncateValue(val: string, max: number): string {
  const chars = Array.from(val);
  return chars.length > max ? chars.slice(0, max).join('') + '...' : val;
}
