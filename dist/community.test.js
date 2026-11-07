import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The Hive Commons community links (hivecommons/promptargs#414, #450) must
// stay reachable from both places newcomers land: the README npm renders and
// the GitHub "New issue" chooser.
const LINKS = [
    'https://hivecommons.dev/discord',
    'https://www.twitch.tv/hivecommons',
    'https://docs.hivecommons.dev/docs/community/meetings',
];
test('README Contributing & Community section links Discord, Twitch and the community meeting', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf-8');
    const start = readme.indexOf('## Contributing & Community');
    assert.notStrictEqual(start, -1, 'README lost its "Contributing & Community" section');
    const end = readme.indexOf('\n## ', start + 1);
    const section = readme.slice(start, end === -1 ? undefined : end);
    for (const url of LINKS)
        assert.ok(section.includes(`(${url})`), `README community section is missing ${url}`);
});
test('issue chooser config lists Discord, Twitch and community meeting contact links', () => {
    const config = readFileSync(join(ROOT, '.github', 'ISSUE_TEMPLATE', 'config.yml'), 'utf-8');
    for (const url of LINKS)
        assert.match(config, new RegExp(`^\\s+url: ${url.replace(/[.]/g, '\\.')}$`, 'm'), `config.yml is missing ${url}`);
});
//# sourceMappingURL=community.test.js.map