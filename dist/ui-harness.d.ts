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
export declare const SCRATCH_DIR: string;
export declare function compileInlineScript<T>(label: string, params: readonly string[], body: string): (...args: unknown[]) => T;
