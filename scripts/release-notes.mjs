import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CATEGORIES = [
  ['added', 'Added'],
  ['changed', 'Changed'],
  ['fixed', 'Fixed'],
];

export function renderReleaseNotes(dir) {
  const groups = new Map(CATEGORIES.map(([key]) => [key, []]));
  for (const name of readdirSync(dir).sort()) {
    const match = /^([a-z]+)-.+\.md$/.exec(name);
    if (!match || !groups.has(match[1])) continue;
    const text = readFileSync(join(dir, name), 'utf8').trim().replace(/^[-*]\s+/, '');
    if (text) groups.get(match[1]).push(`- ${text}`);
  }
  const sections = CATEGORIES.filter(([key]) => groups.get(key).length > 0).map(
    ([key, title]) => `### ${title}\n\n${groups.get(key).join('\n')}`,
  );
  return sections.length ? `${sections.join('\n\n')}\n` : '';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(renderReleaseNotes(process.argv[2] ?? 'changelog.d'));
}
