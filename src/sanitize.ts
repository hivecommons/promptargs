/**
 * Strip terminal escape sequences and control characters from text that is
 * displayed in the user's terminal but originates from untrusted sources
 * (repo-checked-in .prompts/ templates, git diff output, env values).
 *
 * Without this, a cloned repository's template could embed OSC/CSI sequences
 * that retitle the window, write to the clipboard (OSC 52), or overwrite
 * previously printed lines when the user runs `promptargs list` or `show`.
 */

// ESC-initiated sequences: CSI, OSC (BEL- or ST-terminated), DCS/SOS/PM/APC,
// and single-character escapes.
const ANSI_SEQ =
  // eslint-disable-next-line no-control-regex
  /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[PX^_][^\x1b]*(?:\x1b\\)?|[0-~])/g;

// Remaining C0 controls (except \t and \n), DEL, and the C1 CSI byte.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0b-\x1f\x7f\u0080-\u009f]/g;

export function sanitizeForTerminal(text: string): string {
  return text.replace(ANSI_SEQ, '').replace(CONTROL_CHARS, '');
}
