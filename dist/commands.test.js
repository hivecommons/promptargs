import { describe, it } from 'node:test';
import assert from 'node:assert';
import { doShow } from './commands.js';
import { UsageError } from './flags.js';
describe('doShow', () => {
    it('throws UsageError when no template name is given', () => {
        assert.throws(() => doShow(undefined), {
            name: 'UsageError',
            message: 'Usage: promptargs show <template>',
        });
    });
    it('throws UsageError for an unknown template', () => {
        assert.throws(() => doShow('no-such-template-198'), (e) => {
            assert.ok(e instanceof UsageError);
            assert.strictEqual(e.message, 'Template "no-such-template-198" not found.');
            return true;
        });
    });
});
//# sourceMappingURL=commands.test.js.map