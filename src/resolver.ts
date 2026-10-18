/**
 * Resolve variable values: flags → auto-detect → defaults → ask.
 * Handles array expansion (comma-separated, globs, @file, stdin).
 */

import { createInterface } from 'node:readline';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { autodetect } from './autodetect.js';
import { UsageError } from './flags.js';
import { cartesian, zip } from './iterate.js';
import type { TemplateVar } from './parser.js';

export interface ResolvedValues {
  values: Record<string, string>;
  iterations: Record<string, string>[];
  /** Names whose value was filled from the template default. */
  defaulted: Set<string>;
}

function expandPiece(piece: string): string[] {
  // Glob pattern — expanded in-process (never via a shell) to avoid
  // command injection through crafted values.
  if (piece.includes('*') || piece.includes('?')) {
    const files = expandGlob(piece);
    if (files.length > 0) return files;
    // Not a valid glob, treat as literal
  }
  return [piece];
}

function expandArrayValue(raw: string, varName?: string): string[] {
  // @file — read lines from file
  if (raw.startsWith('@') && existsSync(raw.slice(1))) {
    const filePath = raw.slice(1);
    try {
      return readFileSync(filePath, 'utf8')
        .split('\n')
        .map((l: string) => l.trim())
        .filter(Boolean)
        .flatMap(expandPiece);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'EISDIR') {
        throw new UsageError(
          `Variable "${varName}": @${filePath} is a directory, not a file; pass @FILE with one value per line`,
        );
      }
      throw new UsageError(
        `Variable "${varName}": could not read @${filePath}: ${e.message}`,
      );
    }
  }

  // - (stdin) handled at CLI level before this
  if (raw === '-') return [raw];

  // Comma-separated: split first so each piece can be a glob
  if (raw.includes(',')) {
    return raw.split(',').map(s => s.trim()).filter(Boolean).flatMap(expandPiece);
  }

  return expandPiece(raw);
}

function segmentToRegExp(segment: string): RegExp {
  const escaped = segment
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

function expandGlob(pattern: string): string[] {
  const absolute = pattern.startsWith('/');
  const segments = pattern.split('/').filter(Boolean);
  let bases: string[] = [absolute ? '/' : ''];

  for (const segment of segments) {
    const next: string[] = [];
    if (!segment.includes('*') && !segment.includes('?')) {
      for (const base of bases) {
        const p = base === '' ? segment : join(base, segment);
        if (existsSync(p)) next.push(p);
      }
    } else {
      const re = segmentToRegExp(segment);
      const matchHidden = segment.startsWith('.');
      for (const base of bases) {
        let entries: string[];
        try {
          entries = readdirSync(base === '' ? '.' : base);
        } catch {
          continue;
        }
        for (const entry of entries) {
          if (!matchHidden && entry.startsWith('.')) continue;
          if (re.test(entry)) next.push(base === '' ? entry : join(base, entry));
        }
      }
    }
    bases = next;
    if (bases.length === 0) break;
  }

  return bases.sort();
}

export async function resolve(
  vars: TemplateVar[],
  flags: Record<string, string>,
  interactive: boolean,
  cross = false,
): Promise<ResolvedValues> {
  const values = Object.create(null) as Record<string, string>;
  const arrayVars = Object.create(null) as Record<string, string[]>;
  const defaulted = new Set<string>();
  let hasArrays = false;

  for (const v of vars) {
    // 1. Check flags
    if (Object.hasOwn(flags, v.name)) {
      const expanded = expandArrayValue(flags[v.name], v.name);
      if (expanded.length > 1) {
        arrayVars[v.name] = expanded;
        hasArrays = true;
        continue;
      }
      // An empty expansion falls through as if the flag were absent
      if (expanded.length === 1) {
        values[v.name] = expanded[0];
        continue;
      }
    }

    // 2. Auto-detect
    const auto = autodetect(v.name);
    if (auto !== undefined) {
      values[v.name] = auto;
      continue;
    }

    // 3. Default
    if (v.defaultValue !== undefined) {
      values[v.name] = v.defaultValue;
      defaulted.add(v.name);
      continue;
    }

    // 4. Ask interactively
    if (interactive) {
      const answer = await ask(`  ${v.name}: `, v.name);
      const expanded = expandArrayValue(answer, v.name);
      if (expanded.length > 1) {
        arrayVars[v.name] = expanded;
        hasArrays = true;
      } else {
        values[v.name] = expanded[0] ?? '';
      }
    }
  }

  // Build iterations
  if (!hasArrays) {
    return { values, iterations: [values], defaulted };
  }

  const arrayNames = Object.keys(arrayVars);
  const iterations: Record<string, string>[] = [];
  const arrays = arrayNames.map(n => arrayVars[n]);
  const combos = cross ? cartesian(arrays) : zip(arrays);

  for (const combo of combos) {
    const iter = Object.assign(Object.create(null) as Record<string, string>, values);
    for (let j = 0; j < arrayNames.length; j++) {
      iter[arrayNames[j]] = combo[j];
    }
    iterations.push(iter);
  }

  return { values, iterations, defaulted };
}

function ask(prompt: string, name: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve, reject) => {
    let settled = false;
    // Fires on stdin EOF before an answer; without it the Promise never settles.
    rl.on('close', () => {
      if (settled) return;
      settled = true;
      reject(
        new UsageError(
          `Variable "${name}" has no value and stdin is closed; pass --${name}=<value> or --no-interactive`,
        ),
      );
    });
    rl.question(prompt, (answer: string) => {
      if (settled) return;
      settled = true;
      rl.close();
      resolve(answer.trim());
    });
  });
}
