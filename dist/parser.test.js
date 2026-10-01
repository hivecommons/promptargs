import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseVars, expand } from './parser.js';
describe('parseVars', () => {
    it('finds simple variables', () => {
        const vars = parseVars('Hello {{name}}, welcome to {{place}}');
        assert.strictEqual(vars.length, 2);
        assert.strictEqual(vars[0].name, 'name');
        assert.strictEqual(vars[1].name, 'place');
    });
    it('finds variables with defaults', () => {
        const vars = parseVars('Be {{tone=concise}} please');
        assert.strictEqual(vars.length, 1);
        assert.strictEqual(vars[0].name, 'tone');
        assert.strictEqual(vars[0].defaultValue, 'concise');
    });
    it('deduplicates variables', () => {
        const vars = parseVars('{{name}} said hi to {{name}}');
        assert.strictEqual(vars.length, 1);
    });
    it('returns empty for no variables', () => {
        const vars = parseVars('No variables here');
        assert.strictEqual(vars.length, 0);
    });
    it('accepts whitespace padding inside the delimiters, as Mustache does', () => {
        const vars = parseVars('Review {{ file }} for {{ focus=bugs }} in {{\tbranch }}');
        assert.deepStrictEqual(vars.map(v => [v.name, v.defaultValue]), [
            ['file', undefined],
            ['focus', 'bugs'],
            ['branch', undefined],
        ]);
        assert.strictEqual(vars[0].raw, '{{ file }}');
    });
    it('treats padded and unpadded spellings as the same variable', () => {
        const vars = parseVars('{{name}} and {{ name }}');
        assert.strictEqual(vars.length, 1);
    });
    it('keeps interior whitespace in defaults', () => {
        const vars = parseVars('{{ audience=junior developer }}');
        assert.strictEqual(vars[0].defaultValue, 'junior developer');
    });
});
describe('expand', () => {
    it('substitutes values', () => {
        const result = expand('Hello {{name}}!', { name: 'World' });
        assert.strictEqual(result, 'Hello World!');
    });
    it('uses defaults when no value provided', () => {
        const result = expand('Be {{tone=concise}}', {});
        assert.strictEqual(result, 'Be concise');
    });
    it('overrides defaults with provided values', () => {
        const result = expand('Be {{tone=concise}}', { tone: 'verbose' });
        assert.strictEqual(result, 'Be verbose');
    });
    it('leaves unfilled vars as-is', () => {
        const result = expand('Hello {{name}}', {});
        assert.strictEqual(result, 'Hello {{name}}');
    });
    it('handles multiple vars', () => {
        const result = expand('Review {{file}} for {{focus=correctness}}. Be {{tone=concise}}.', { file: 'main.go' });
        assert.strictEqual(result, 'Review main.go for correctness. Be concise.');
    });
    it('handles arrays in comma-separated values', () => {
        const result = expand('Check {{file}}', { file: 'a.go' });
        assert.strictEqual(result, 'Check a.go');
    });
    it('does not HTML-escape values', () => {
        const result = expand('{{code}}', { code: '<div class="test">' });
        assert.strictEqual(result, '<div class="test">');
    });
    it('fills padded tags from values and defaults', () => {
        const result = expand('Review {{ file }} for {{ focus=bugs }}', { file: 'a.ts' });
        assert.strictEqual(result, 'Review a.ts for bugs');
    });
    it('preserves unfilled padded tags instead of erasing them', () => {
        // Before padding was recognised, Mustache rendered {{ name }} as "".
        const result = expand('Hello {{ name }}, see {{file}}', { file: 'x' });
        assert.strictEqual(result, 'Hello {{name}}, see x');
    });
});
//# sourceMappingURL=parser.test.js.map