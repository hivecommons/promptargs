/**
 * Find and load prompt templates from .prompts/ directories.
 */

import { readFileSync, readdirSync, existsSync, statSync, realpathSync } from 'node:fs';
import { join, basename, extname, sep } from 'node:path';
import { homedir } from 'node:os';
import { UsageError } from './flags.js';
import { diag, classifyError } from './log.js';
import { sanitizeForTerminal } from './sanitize.js';

const PROJECT_DIR = '.prompts';
const USER_DIR = join(homedir(), '.prompts');

export interface PromptTemplate {
  name: string;
  content: string;
  path: string;
  source: 'project' | 'user';
  /** Set when the file could not be read; content is then empty. */
  error?: string;
}

function loadFromDir(dir: string, source: 'project' | 'user'): PromptTemplate[] {
  if (!existsSync(dir)) return [];

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    diag('loader_dir_unreadable', { error_class: classifyError(err) }, sanitizeForTerminal(`promptargs: cannot read ${dir}: ${msg}`));
    return [];
  }

  // Symlinked templates must resolve to a file inside this .prompts dir; a
  // cloned repo must not be able to make `promptargs x` read ~/.ssh/id_rsa.
  let realDir: string;
  try {
    realDir = realpathSync(dir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    diag('loader_dir_unreadable', { error_class: classifyError(err) }, sanitizeForTerminal(`promptargs: cannot resolve ${dir}: ${msg}`));
    return [];
  }
  const realDirPrefix = realDir.endsWith(sep) ? realDir : realDir + sep;

  const templates: PromptTemplate[] = [];
  for (const entry of entries) {
    const f = entry.name;
    if (!f.endsWith('.md')) continue;
    const path = join(dir, f);
    const isLink = entry.isSymbolicLink();
    try {
      const isFile = isLink ? statSync(path).isFile() : entry.isFile();
      if (!isFile) continue;
    } catch {
      continue; // dangling symlink
    }
    const template: PromptTemplate = { name: basename(f, extname(f)), content: '', path, source };
    try {
      if (isLink) {
        const target = realpathSync(path);
        if (!target.startsWith(realDirPrefix)) {
          template.error = `symlink target ${target} is outside ${dir}; templates must stay inside the .prompts directory`;
          templates.push(template);
          continue;
        }
      }
      template.content = readFileSync(path, 'utf8');
    } catch (err) {
      template.error = err instanceof Error ? err.message : String(err);
    }
    templates.push(template);
  }
  return templates;
}

export function loadTemplates(cwd?: string): PromptTemplate[] {
  const projectDir = join(cwd || process.cwd(), PROJECT_DIR);
  const projectTemplates = loadFromDir(projectDir, 'project');
  const userTemplates = loadFromDir(USER_DIR, 'user');

  // Project templates override user templates with same name
  const byName = new Map<string, PromptTemplate>();
  for (const t of userTemplates) byName.set(t.name, t);
  for (const t of projectTemplates) byName.set(t.name, t);

  return Array.from(byName.values());
}

export function findTemplate(name: string, cwd?: string): PromptTemplate | undefined {
  const tpl = loadTemplates(cwd).find(t => t.name === name);
  if (tpl?.error) {
    throw new UsageError(`Template "${tpl.name}" at ${tpl.path} could not be read: ${tpl.error}`);
  }
  return tpl;
}
