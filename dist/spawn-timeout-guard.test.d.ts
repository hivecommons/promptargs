export declare function testSourceFiles(root: string): string[];
/** The full `name(...)` call starting at `start`, found by balancing parens. */
export declare function callExpressionAt(source: string, start: number): string;
export interface SyncSpawnCall {
    line: number;
    call: string;
    hasTimeout: boolean;
}
export declare function findSyncSpawnCalls(source: string): SyncSpawnCall[];
