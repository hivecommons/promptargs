/**
 * Parse {{variables}} and {{variables=defaults}} from template strings.
 * Uses Mustache for expansion, with a promptargs extension for defaults.
 */
export interface TemplateVar {
    name: string;
    defaultValue?: string;
    raw: string;
}
export declare const VAR_PATTERN: RegExp;
export declare function parseVars(template: string): TemplateVar[];
export declare function expand(template: string, values: Record<string, string>): string;
