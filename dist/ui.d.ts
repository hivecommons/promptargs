import { type Server } from 'node:http';
export declare function shouldSkipEnv(key: string): boolean;
export declare function truncateValue(val: string, max: number): string;
export interface EnvData {
    git: Record<string, string>;
    terminal: Record<string, string>;
}
export declare function collectEnvVars(): EnvData;
export interface StartUIOptions {
    openBrowser?: boolean;
}
export declare function buildUIHtml(rawHtml: string, envVars: EnvData): string;
export declare function startUI(port?: number, options?: StartUIOptions): Server;
