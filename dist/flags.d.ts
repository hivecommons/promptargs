export declare class UsageError extends Error {
    constructor(message: string);
}
export declare const SWITCHES: Set<string>;
declare const SUBCOMMAND_NAMES: readonly ["help", "env", "ui", "init", "list", "show"];
export type Subcommand = (typeof SUBCOMMAND_NAMES)[number];
export declare const SUBCOMMANDS: Set<string>;
export declare function subcommandCollision(name: string): string | undefined;
export declare function assertNoReservedVars(vars: {
    name: string;
}[]): void;
export declare function wantsHelp(args: string[]): boolean;
export declare function assertNoArgs(args: string[]): void;
export declare function parseFlags(args: string[]): Record<string, string>;
export declare function parsePort(flags: Record<string, string>): number | undefined;
export {};
