import { describe, it } from 'node:test';
import assert from 'node:assert';
import { renderStatus } from './status.js';
import type { TemplateVar } from './parser.js';

function v(name: string, defaultValue?: string): TemplateVar {
  return { name, defaultValue, raw: `{{${name}}}` };
}

describe('renderStatus', () => {
  it('shows ✅ and values when all vars are filled', () => {
    const out = renderStatus('review', [v('file')], { file: 'a.go' });
    assert.strictEqual(out, '✅ review: file=a.go');
  });

  it('shows 📋 and ___ placeholders for unfilled vars', () => {
    const out = renderStatus('review', [v('file'), v('focus')], { file: 'a.go' });
    assert.strictEqual(out, '📋 review: file=a.go  focus=___');
  });

  it('marks values that equal the default with (default)', () => {
    const out = renderStatus('t', [v('tone', 'concise')], { tone: 'concise' });
    assert.strictEqual(out, '✅ t: tone=concise(default)');
  });

  it('does not mark overridden defaults', () => {
    const out = renderStatus('t', [v('tone', 'concise')], { tone: 'verbose' });
    assert.strictEqual(out, '✅ t: tone=verbose');
  });

  it('renders iteration progress', () => {
    const out = renderStatus('t', [v('f')], { f: 'x' }, { current: 2, total: 5 });
    assert.strictEqual(out, '✅ t [2/5]: f=x');
  });

  it('handles templates with no vars', () => {
    const out = renderStatus('plain', [], {});
    assert.strictEqual(out, '✅ plain: ');
  });
});
