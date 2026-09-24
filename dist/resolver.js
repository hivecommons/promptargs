/**
 * Resolve variable values: flags → auto-detect → defaults → ask.
 * Handles array expansion (comma-separated, globs, @file, stdin).
 */
import { createInterface } from 'node:readline';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { autodetect } from './autodetect.js';
function expandArrayValue(raw) {
    // @file — read lines from file
    if (raw.startsWith('@') && existsSync(raw.slice(1))) {
        return readFileSync(raw.slice(1), 'utf8')
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
    }
    // - (stdin) handled at CLI level before this
    if (raw === '-')
        return [raw];
    // Glob pattern — expanded in-process (never via a shell) to avoid
    // command injection through crafted values.
    if (raw.includes('*') || raw.includes('?')) {
        const files = expandGlob(raw);
        if (files.length > 0)
            return files;
        // Not a valid glob, treat as literal
    }
    // Comma-separated
    if (raw.includes(',')) {
        return raw.split(',').map(s => s.trim()).filter(Boolean);
    }
    return [raw];
}
function segmentToRegExp(segment) {
    const escaped = segment
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`);
}
function expandGlob(pattern) {
    const absolute = pattern.startsWith('/');
    const segments = pattern.split('/').filter(Boolean);
    let bases = [absolute ? '/' : ''];
    for (const segment of segments) {
        const next = [];
        if (!segment.includes('*') && !segment.includes('?')) {
            for (const base of bases) {
                const p = base === '' ? segment : join(base, segment);
                if (existsSync(p))
                    next.push(p);
            }
        }
        else {
            const re = segmentToRegExp(segment);
            const matchHidden = segment.startsWith('.');
            for (const base of bases) {
                let entries;
                try {
                    entries = readdirSync(base === '' ? '.' : base);
                }
                catch {
                    continue;
                }
                for (const entry of entries) {
                    if (!matchHidden && entry.startsWith('.'))
                        continue;
                    if (re.test(entry))
                        next.push(base === '' ? entry : join(base, entry));
                }
            }
        }
        bases = next;
        if (bases.length === 0)
            break;
    }
    return bases.sort();
}
function cartesian(arrays) {
    if (arrays.length === 0)
        return [[]];
    const [first, ...rest] = arrays;
    const restCombos = cartesian(rest);
    const result = [];
    for (const val of first) {
        for (const combo of restCombos) {
            result.push([val, ...combo]);
        }
    }
    return result;
}
export async function resolve(vars, flags, interactive, cross = false) {
    const values = {};
    const arrayVars = {};
    let hasArrays = false;
    for (const v of vars) {
        // 1. Check flags
        if (v.name in flags) {
            const expanded = expandArrayValue(flags[v.name]);
            if (expanded.length > 1) {
                arrayVars[v.name] = expanded;
                hasArrays = true;
            }
            else {
                values[v.name] = expanded[0];
            }
            continue;
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
            continue;
        }
        // 4. Ask interactively
        if (interactive) {
            const answer = await ask(`  ${v.name}: `);
            const expanded = expandArrayValue(answer);
            if (expanded.length > 1) {
                arrayVars[v.name] = expanded;
                hasArrays = true;
            }
            else {
                values[v.name] = expanded[0];
            }
        }
    }
    // Build iterations
    if (!hasArrays) {
        return { values, iterations: [values] };
    }
    const arrayNames = Object.keys(arrayVars);
    const iterations = [];
    if (cross) {
        const arrays = arrayNames.map(n => arrayVars[n]);
        const combos = cartesian(arrays);
        for (const combo of combos) {
            const iter = { ...values };
            for (let j = 0; j < arrayNames.length; j++) {
                iter[arrayNames[j]] = combo[j];
            }
            iterations.push(iter);
        }
    }
    else {
        const maxLen = Math.max(...arrayNames.map(n => arrayVars[n].length));
        for (let i = 0; i < maxLen; i++) {
            const iter = { ...values };
            for (const name of arrayNames) {
                const arr = arrayVars[name];
                iter[name] = arr[i % arr.length];
            }
            iterations.push(iter);
        }
    }
    return { values, iterations };
}
function ask(prompt) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    return new Promise(resolve => {
        rl.question(prompt, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}
//# sourceMappingURL=resolver.js.map