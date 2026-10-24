import { describe, it } from 'node:test';
import assert from 'node:assert';
import Mustache from 'mustache';
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
    it('does not mutate the shared Mustache.escape global', () => {
        // `expand` must disable escaping for its own render only, via the
        // per-call config, not by assigning Mustache.escape — that would leak
        // into any other code in the process that also imports `mustache` and
        // relies on its default HTML-escaping behavior.
        const before = Mustache.escape;
        expand('{{code}}', { code: '<b>' });
        assert.strictEqual(Mustache.escape, before);
        assert.strictEqual(Mustache.escape('<b>'), '&lt;b&gt;');
    });
});
describe('expand with prototype-named variables', () => {
    for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
        it(`preserves unresolved {{${name}}}`, () => {
            assert.strictEqual(expand(`x {{${name}}} y`, {}), `x {{${name}}} y`);
        });
        it(`applies the default for {{${name}=dflt}}`, () => {
            assert.strictEqual(expand(`x {{${name}=dflt}} y`, {}), 'x dflt y');
        });
        it(`uses an explicit value for {{${name}}}`, () => {
            const values = JSON.parse(`{"${name}":"given"}`);
            assert.strictEqual(expand(`x {{${name}=dflt}} y`, values), 'x given y');
        });
    }
});
describe('variable name grammar and repeated blanks', () => {
    it('accepts hyphenated names and preserves or fills them', () => {
        assert.deepStrictEqual(parseVars('{{file-name}}').map((v) => v.name), ['file-name']);
        assert.strictEqual(expand('x {{file-name}}', {}), 'x {{file-name}}');
        assert.strictEqual(expand('x {{file-name}}', { 'file-name': 'a.ts' }), 'x a.ts');
    });
    it('rejects dotted names with a UsageError', () => {
        assert.throws(() => parseVars('{{repo.owner}}'), (err) => err.name === 'UsageError' && /repo\.owner/.test(err.message) && /repo_owner/.test(err.message));
    });
    it('does not echo the default text of a dotted tag in the error', () => {
        assert.throws(() => parseVars('x {{a.b=\x1b]0;hi\x07\x1b[31mRED}} y'), (err) => err.name === 'UsageError' && !err.message.includes('\x1b') && /a\.b/.test(err.message));
    });
    it('does not flag Mustache sigil tags', () => {
        assert.doesNotThrow(() => parseVars('{{!a.b}} {{{x}}} {{name=a.b}}'));
    });
    it('recognises ampersand tags as blanks', () => {
        for (const tpl of ['{{&name}}', '{{& name }}']) {
            const vars = parseVars(tpl);
            assert.strictEqual(vars.length, 1);
            assert.strictEqual(vars[0].name, 'name');
            assert.strictEqual(expand(tpl, { name: 'hi' }), 'hi');
        }
        const vars = parseVars('{{name}} {{&name=dflt}}');
        assert.strictEqual(vars.length, 1);
        assert.strictEqual(vars[0].defaultValue, 'dflt');
        assert.strictEqual(expand('{{&name=dflt}}', {}), 'dflt');
        assert.strictEqual(expand('{{&name}}', {}), '{{name}}');
    });
    it('rejects dotted ampersand tags', () => {
        assert.throws(() => parseVars('{{&a.b}}'), (err) => err.name === 'UsageError' && /a\.b/.test(err.message));
    });
    it('adopts a default from a later occurrence', () => {
        const vars = parseVars('{{name}} and {{name=dflt}}');
        assert.strictEqual(vars.length, 1);
        assert.strictEqual(vars[0].defaultValue, 'dflt');
        assert.strictEqual(expand('{{name}} and {{name=dflt}}', {}), 'dflt and dflt');
    });
    it('keeps the first default when later occurrences differ', () => {
        const vars = parseVars('{{n=a}} {{n=b}}');
        assert.equal(vars.length, 1);
        assert.equal(vars[0].defaultValue, 'a');
        assert.equal(expand('{{n=a}} {{n=b}}', {}), 'a a');
    });
});
//# sourceMappingURL=parser.test.js.map