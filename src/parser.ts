/**
 * Parse {{variables}} and {{variables=defaults}} from template strings.
 * Uses Mustache for expansion, with a promptargs extension for defaults.
 */

import Mustache from 'mustache';

export interface TemplateVar {
  name: string;
  defaultValue?: string;
  raw: string;
}

// Exported so any code that needs to recognize the same {{var}} / {{var=default}}
// grammar (e.g. CLI syntax highlighting) reuses this single definition instead
// of re-declaring the pattern and risking drift.
export const VAR_PATTERN = /\{\{(\w+)(?:=([^}]*))?\}\}/g;

export function parseVars(template: string): TemplateVar[] {
  const seen = new Set<string>();
  const vars: TemplateVar[] = [];

  for (const match of template.matchAll(VAR_PATTERN)) {
    const name = match[1];
    if (seen.has(name)) continue;
    seen.add(name);
    vars.push({
      name,
      defaultValue: match[2],
      raw: match[0],
    });
  }

  return vars;
}

export function expand(template: string, values: Record<string, string>): string {
  const vars = parseVars(template);
  const view: Record<string, string> = { ...values };

  for (const v of vars) {
    if (!(v.name in view) && v.defaultValue !== undefined) {
      view[v.name] = v.defaultValue;
    }
    // Preserve unfilled vars as {{name}} in output
    if (!(v.name in view)) {
      view[v.name] = `{{${v.name}}}`;
    }
  }

  // Convert {{var=default}} to {{var}} so Mustache can handle it
  const normalized = template.replace(VAR_PATTERN, (_match, name: string) => `{{${name}}}`);

  // Disable HTML escaping — we want raw text output
  Mustache.escape = (text: string) => text;

  return Mustache.render(normalized, view);
}
