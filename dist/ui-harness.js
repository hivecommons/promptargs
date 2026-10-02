import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
/**
 * Test helper: compile a fragment of ui.html's inline script so the test
 * runner's coverage reporter can see it.
 *
 * The ui-*.test.ts suites extract functions out of ui.html and run them
 * against a stub DOM. Doing that with `new Function` hides the code from
 * `--experimental-test-coverage`: V8 reports such scripts with an empty URL
 * and the reporter drops them, so the thresholds in scripts/run-tests.mjs
 * could never gate ui.html. Writing the assembled source to a scratch file
 * and compiling it with `vm.Script` under that file's URL makes it show up
 * in the report like any other source file.
 *
 * Scratch files live in `.test-scratch/ui-inline/` at the repository root —
 * gitignored, and outside `dist/` so `npm publish` never ships them. The
 * file name is `<label>-<content hash>.js`: suites that assemble identical
 * source share one entry in the report, and editing ui.html simply produces
 * a new file instead of clashing with a stale one.
 */
export const SCRATCH_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.test-scratch', 'ui-inline');
export function compileInlineScript(label, params, body) {
    const source = `(function (${params.join(', ')}) {\n${body}\n})`;
    const hash = createHash('sha256').update(source).digest('hex').slice(0, 8);
    const file = join(SCRATCH_DIR, `${label}-${hash}.js`);
    if (!existsSync(file)) {
        mkdirSync(SCRATCH_DIR, { recursive: true });
        // Suites run in parallel processes; write-then-rename keeps a reader
        // in another process from seeing a half-written file.
        const tmp = `${file}.${process.pid}.tmp`;
        writeFileSync(tmp, source);
        renameSync(tmp, file);
    }
    const script = new Script(source, { filename: pathToFileURL(file).href });
    return script.runInThisContext();
}
//# sourceMappingURL=ui-harness.js.map