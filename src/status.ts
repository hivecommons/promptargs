/**
 * Status line rendering for Claude Code's status area.
 * Shows current template state: filled vars, unfilled vars, progress.
 */

import type { TemplateVar } from './parser.js';
import { sanitizeForTerminal } from './sanitize.js';

export function renderStatus(
  templateName: string,
  vars: TemplateVar[],
  values: Record<string, string>,
  iteration?: { current: number; total: number },
): string {
  const parts: string[] = [];

  for (const v of vars) {
    const val = values[v.name];
    if (val !== undefined) {
      const source = v.defaultValue === val ? '(default)' : '';
      parts.push(`${v.name}=${val}${source}`);
    } else {
      parts.push(`${v.name}=___`);
    }
  }

  const allFilled = vars.every(v => v.name in values);
  const icon = allFilled ? '✅' : '📋';
  const progress = iteration ? ` [${iteration.current}/${iteration.total}]` : '';

  // Values may come from repo-controlled sources (templates, git diff);
  // never let them inject escape sequences into the status line.
  return sanitizeForTerminal(`${icon} ${templateName}${progress}: ${parts.join('  ')}`);
}
