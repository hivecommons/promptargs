export declare class UsageError extends Error {
    constructor(message: string);
}
export declare const SWITCHES: Set<string>;
export declare function parseFlags(args: string[]): Record<string, string>;
export declare function parsePort(flags: Record<string, string>): number | undefined;
