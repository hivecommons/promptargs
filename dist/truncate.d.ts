/**
 * Dependency-free value truncation shared by ui, commands and status.
 * Kept separate from ui.ts so importing it never pulls in the HTTP server.
 */
export declare const PREVIEW_MAX_CHARS = 60;
export declare function truncateValue(val: string, max: number): string;
