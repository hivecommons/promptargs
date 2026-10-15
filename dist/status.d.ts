/**
 * Status line rendering for Claude Code's status area.
 * Shows current template state: filled vars, unfilled vars, progress.
 */
import type { TemplateVar } from './parser.js';
export declare function renderStatus(templateName: string, vars: TemplateVar[], values: Record<string, string>, iteration?: {
    current: number;
    total: number;
}, defaulted?: ReadonlySet<string>): string;
