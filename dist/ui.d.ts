import { type Server } from 'node:http';
import { truncateValue } from './truncate.js';
export declare function shouldSkipEnv(key: string): boolean;
export { truncateValue };
export interface EnvData {
    git: Record<string, string>;
    terminal: Record<string, string>;
}
export declare function collectEnvVars(): EnvData;
export interface StartUIOptions {
    openBrowser?: boolean;
}
export declare function buildUIHtml(rawHtml: string, envVars: EnvData): string;
export declare const UI_TOKEN_PARAM = "t";
export declare const PAGE_HEADERS: Readonly<Record<string, string>>;
export declare function buildContentSecurityPolicy(html: string): string;
export declare function buildPageHeaders(html: string): Record<string, string>;
export declare function requestCarriesToken(url: string | undefined, token: string): boolean;
export declare function portInUseHint(port: number): string;
export declare function startUI(port?: number, options?: StartUIOptions): Server;
