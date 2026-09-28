/**
 * Strip terminal escape sequences and control characters from text that is
 * displayed in the user's terminal but originates from untrusted sources
 * (repo-checked-in .prompts/ templates, git diff output, env values).
 *
 * Without this, a cloned repository's template could embed OSC/CSI sequences
 * that retitle the window, write to the clipboard (OSC 52), or overwrite
 * previously printed lines when the user runs `promptargs list` or `show`.
 */
export declare function sanitizeForTerminal(text: string): string;
