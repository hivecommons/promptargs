/**
 * Find and load prompt templates from .prompts/ directories.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { homedir } from 'node:os';
import { UsageError } from './flags.js';
const PROJECT_DIR = '.prompts';
const USER_DIR = join(homedir(), '.prompts');
function loadFromDir(dir, source) {
    if (!existsSync(dir))
        return [];
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const templates = [];
    for (const entry of entries) {
        const f = entry.name;
        if (!f.endsWith('.md'))
            continue;
        const path = join(dir, f);
        try {
            const isFile = entry.isSymbolicLink() ? statSync(path).isFile() : entry.isFile();
            if (!isFile)
                continue;
        }
        catch {
            continue; // dangling symlink
        }
        const template = { name: basename(f, extname(f)), content: '', path, source };
        try {
            template.content = readFileSync(path, 'utf8');
        }
        catch (err) {
            template.error = err instanceof Error ? err.message : String(err);
        }
        templates.push(template);
    }
    return templates;
}
export function loadTemplates(cwd) {
    const projectDir = join(cwd || process.cwd(), PROJECT_DIR);
    const projectTemplates = loadFromDir(projectDir, 'project');
    const userTemplates = loadFromDir(USER_DIR, 'user');
    // Project templates override user templates with same name
    const byName = new Map();
    for (const t of userTemplates)
        byName.set(t.name, t);
    for (const t of projectTemplates)
        byName.set(t.name, t);
    return Array.from(byName.values());
}
export function findTemplate(name, cwd) {
    const tpl = loadTemplates(cwd).find(t => t.name === name);
    if (tpl?.error) {
        throw new UsageError(`Template "${tpl.name}" at ${tpl.path} could not be read: ${tpl.error}`);
    }
    return tpl;
}
//# sourceMappingURL=loader.js.map