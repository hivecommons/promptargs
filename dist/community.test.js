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
// CONTRIBUTING.md is linked from GitHub's new-issue and new-PR pages, so it
// must also tell newcomers what to work on and where to ask (#469).
const CONTRIBUTING_LINKS = [
    'https://github.com/hivecommons/promptargs/labels/good%20first%20issue',
    'https://github.com/hivecommons/promptargs/labels/help%20wanted',
    'https://github.com/hivecommons/promptargs/issues/new?template=integration_request.yml',
    'https://hivecommons.dev/discord',
    'https://docs.hivecommons.dev/docs/community/meetings',
];
test('CONTRIBUTING.md points newcomers at starter labels, the integration form, Discord and the community meeting', () => {
    const contributing = readFileSync(join(ROOT, 'CONTRIBUTING.md'), 'utf-8');
    for (const url of CONTRIBUTING_LINKS)
        assert.ok(contributing.includes(`(${url})`), `CONTRIBUTING.md is missing ${url}`);
});
test('CONTRIBUTING.md integration request link names an existing issue form', () => {
    const template = new URL(CONTRIBUTING_LINKS[2]).searchParams.get('template');
    assert.ok(template);
    assert.doesNotThrow(() => readFileSync(join(ROOT, '.github', 'ISSUE_TEMPLATE', template), 'utf-8'));
});
test('issue chooser config lists Discord, Twitch and community meeting contact links', () => {
    const config = readFileSync(join(ROOT, '.github', 'ISSUE_TEMPLATE', 'config.yml'), 'utf-8');
    for (const url of LINKS)
        assert.match(config, new RegExp(`^\\s+url: ${url.replace(/[.]/g, '\\.')}$`, 'm'), `config.yml is missing ${url}`);
});
//# sourceMappingURL=community.test.js.map