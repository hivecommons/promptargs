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
function expandPiece(piece) {
    // Glob pattern — expanded in-process (never via a shell) to avoid
    // command injection through crafted values.
    if (piece.includes('*') || piece.includes('?')) {
        const files = expandGlob(piece);
        if (files.length > 0)
            return files;
        // Not a valid glob, treat as literal
    }
    return [piece];
}
function expandArrayValue(raw) {
    // @file — read lines from file
    if (raw.startsWith('@') && existsSync(raw.slice(1))) {
        return readFileSync(raw.slice(1), 'utf8')
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .flatMap(expandPiece);
    }
    // - (stdin) handled at CLI level before this
    if (raw === '-')
        return [raw];
    // Comma-separated: split first so each piece can be a glob
    if (raw.includes(',')) {
        return raw.split(',').map(s => s.trim()).filter(Boolean).flatMap(expandPiece);
    }
    return expandPiece(raw);
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
export async function resolve(vars, flags, interactive, cross = false) {
    const values = Object.create(null);
    const arrayVars = Object.create(null);
    const defaulted = new Set();
    let hasArrays = false;
    for (const v of vars) {
        // 1. Check flags
        if (Object.hasOwn(flags, v.name)) {
            const expanded = expandArrayValue(flags[v.name]);
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
            const expanded = expandArrayValue(answer);
            if (expanded.length > 1) {
                arrayVars[v.name] = expanded;
                hasArrays = true;
            }
            else {
                values[v.name] = expanded[0] ?? '';
            }
        }
    }
    // Build iterations
    if (!hasArrays) {
        return { values, iterations: [values], defaulted };
    }
    const arrayNames = Object.keys(arrayVars);
    const iterations = [];
    const arrays = arrayNames.map(n => arrayVars[n]);
    const combos = cross ? cartesian(arrays) : zip(arrays);
    for (const combo of combos) {
        const iter = Object.assign(Object.create(null), values);
        for (let j = 0; j < arrayNames.length; j++) {
            iter[arrayNames[j]] = combo[j];
        }
        iterations.push(iter);
    }
    return { values, iterations, defaulted };
}
function ask(prompt, name) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    return new Promise((resolve, reject) => {
        let settled = false;
        // Fires on stdin EOF before an answer; without it the Promise never settles.
        rl.on('close', () => {
            if (settled)
                return;
            settled = true;
            reject(new UsageError(`Variable "${name}" has no value and stdin is closed; pass --${name}=<value> or --no-interactive`));
        });
        rl.question(prompt, (answer) => {
            if (settled)
                return;
            settled = true;
            rl.close();
            resolve(answer.trim());
        });
    });
}
//# sourceMappingURL=resolver.js.map