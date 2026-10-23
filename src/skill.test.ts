import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUBCOMMANDS as CLI_SUBCOMMANDS } from './flags.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CLI = join(__dirname, 'cli.js');
const SKILL_DIR = join(ROOT, 'skills', 'promptargs');
const SKILL_FILE = join(SKILL_DIR, 'SKILL.md');
const README = join(ROOT, 'README.md');

// skills/promptargs/SKILL.md is what `gh skill install hivecommons/promptargs
// promptargs` hands to Copilot and Claude Code. Agents follow its commands
// verbatim, so a subcommand or flag the CLI no longer accepts, or a template
// run that waits for a TTY, breaks every agent session that loads the skill.
// Nothing compiles or runs this file, so pin it from both sides: the
// frontmatter follows the agentskills.io spec, and every `promptargs ...`
// command it documents actually runs against dist/cli.js.

// agentskills.io/specification: name is lowercase letters, digits and
// hyphens (no leading/trailing/double hyphen), at most 64 chars, and must
// match the directory name; description is required and at most 1024 chars.
const SPEC_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SPEC_FIELDS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);

// Switches cli.ts accepts; every other --flag must be a template variable.
const CLI_SWITCHES = new Set(['no-interactive', 'cross', 'json', 'status']);
// The CLI's subcommand set is shared with the dispatch implementation.
// Templates `promptargs init` writes, so `promptargs <name>` resolves.
const INIT_TEMPLATES = new Set(['review', 'explain', 'fix']);

interface Frontmatter {
  fields: Record<string, string>;
  body: string;
}

function parseFrontmatter(markdown: string): Frontmatter {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(markdown);
  assert.ok(m, 'SKILL.md must start with a --- YAML frontmatter block');
  const fields: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    if (line.trim() === '') continue;
    const kv = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    assert.ok(kv, `frontmatter line is not a top-level "key: value": ${JSON.stringify(line)}`);
    fields[kv[1]] = kv[2];
  }
  return { fields, body: m[2] };
}

function bashFences(markdown: string): string[] {
  const fences: string[] = [];
  const re = /```bash\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) fences.push(m[1]);
  return fences;
}

// Lines in bash fences that invoke the CLI, without shell comments.
function promptargsCommands(markdown: string): string[] {
  return bashFences(markdown)
    .flatMap((f) => f.split('\n'))
    .map((l) => l.replace(/\s+#.*$/, '').trim())
    .filter((l) => l.startsWith('promptargs '));
}

// Minimal POSIX-ish word splitting: honours "..." and '...' so the glob and
// pipe examples split the way a shell would.
function splitWords(line: string): string[] {
  const words: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) words.push(m[1] ?? m[2] ?? m[3]);
  return words;
}

function flagNames(words: string[]): string[] {
  return words
    .filter((w) => w.startsWith('--'))
    .map((w) => w.slice(2).split('=')[0]);
}

function templateVarNames(template: string): Set<string> {
  const names = new Set<string>();
  for (const m of template.matchAll(/\{\{\s*([A-Za-z_]\w*)/g)) names.add(m[1]);
  return names;
}

// Variables a documented run may set: the inline template's own, or those of
// the init template (examples/ is the byte-identical copy init writes).
function varsForTarget(target: string): Set<string> {
  if (target.includes('{{')) return templateVarNames(target);
  if (INIT_TEMPLATES.has(target)) {
    return templateVarNames(readFileSync(join(ROOT, 'examples', `${target}.md`), 'utf-8'));
  }
  return new Set();
}

const skill = readFileSync(SKILL_FILE, 'utf-8');
const { fields, body } = parseFrontmatter(skill);
const commands = promptargsCommands(skill);

test('SKILL.md frontmatter follows the agentskills.io spec', () => {
  assert.ok(fields.name, 'name is required');
  assert.ok(fields.description, 'description is required');
  assert.match(fields.name, SPEC_NAME, 'name must be lowercase letters, digits and single hyphens');
  assert.ok(fields.name.length <= 64, 'name must be at most 64 characters');
  assert.strictEqual(fields.name, basename(SKILL_DIR), 'name must match the skill directory name');
  assert.ok(fields.description.length <= 1024, 'description must be at most 1024 characters');
  for (const key of Object.keys(fields)) {
    assert.ok(SPEC_FIELDS.has(key), `unknown frontmatter field ${JSON.stringify(key)}`);
  }
  assert.ok(body.trim().length > 0, 'SKILL.md needs instructions after the frontmatter');
});

test('SKILL.md description names the triggers agents match on', () => {
  // The description is the only text an agent sees before deciding to load
  // the skill, so it has to mention the core verbs and the template syntax.
  for (const needle of ['template', '{{', 'promptargs']) {
    assert.ok(fields.description.includes(needle), `description should mention ${JSON.stringify(needle)}`);
  }
});

test('SKILL.md documents at least one command for every CLI subcommand agents need', () => {
  const seen = new Set(commands.map((c) => splitWords(c)[1]));
  for (const sub of ['list', 'show', 'init', 'env']) {
    assert.ok(seen.has(sub), `SKILL.md should show \`promptargs ${sub}\``);
  }
  assert.ok(
    commands.some((c) => c.includes('{{')),
    'SKILL.md should show an inline template run',
  );
});

test('every promptargs command in SKILL.md uses a real subcommand or template and real flags', () => {
  assert.ok(commands.length > 0, 'SKILL.md should contain promptargs commands in bash fences');
  for (const cmd of commands) {
    const words = splitWords(cmd.split(/\s\|\s/)[0]);
    const target = words[1];
    assert.ok(target, `${cmd}: missing subcommand or template`);
    if (!target.includes('{{') && !CLI_SUBCOMMANDS.has(target)) {
      assert.ok(INIT_TEMPLATES.has(target), `${cmd}: "${target}" is neither a CLI subcommand nor a template init ships`);
    }
    const vars = varsForTarget(target);
    for (const flag of flagNames(words)) {
      assert.ok(
        CLI_SWITCHES.has(flag) || vars.has(flag),
        `${cmd}: --${flag} is not a CLI switch or a variable of the template`,
      );
    }
  }
});

test('every template run in SKILL.md passes --no-interactive', () => {
  // An agent cannot answer a TTY prompt; a documented run without the switch
  // hangs the session on the first unfilled variable.
  for (const cmd of commands) {
    const target = splitWords(cmd)[1];
    if (CLI_SUBCOMMANDS.has(target)) continue;
    assert.ok(cmd.includes('--no-interactive'), `${cmd}: template runs must pass --no-interactive`);
  }
});

test('every promptargs command in SKILL.md runs successfully against dist/cli.js', () => {
  const dir = mkdtempSync(join(tmpdir(), 'promptargs-skill-'));
  try {
    // Fixtures the documented examples refer to.
    mkdirSync(join(dir, 'src'));
    for (const f of ['src/main.ts', 'src/a.go', 'src/b.go', 'api.go', 'auth.go', 'db.go']) {
      writeFileSync(join(dir, f), '');
    }
    writeFileSync(join(dir, 'list.txt'), 'api.go\nauth.go\n');

    const run = (words: string[]) =>
      spawnSync(process.execPath, [CLI, ...words.slice(1)], { cwd: dir, encoding: 'utf-8', env: process.env, timeout: 30_000 });

    // init first so `promptargs review` and friends resolve.
    const init = run(['promptargs', 'init']);
    assert.strictEqual(init.status, 0, `init failed:\n${init.stderr}`);

    for (const cmd of commands) {
      const words = splitWords(cmd.split(/\s\|\s/)[0]);
      if (words[1] === 'init') continue; // already ran; init refuses to overwrite
      const res = run(words);
      assert.strictEqual(res.status, 0, `${cmd}\nexit ${res.status}\n${res.stderr}`);
      assert.ok(res.stdout.trim().length > 0, `${cmd}: produced no output`);
      if (!CLI_SUBCOMMANDS.has(words[1])) {
        assert.ok(!res.stdout.includes('{{'), `${cmd}: left an unfilled {{...}} blank:\n${res.stdout}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SKILL.md pitfalls match CLI behaviour: an unfilled blank is a usage error and --status is one line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'promptargs-skill-'));
  try {
    const run = (args: string[]) =>
      spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf-8', env: process.env, timeout: 30_000 });

    const unfilled = run(['Explain {{concept}} now', '--no-interactive']);
    assert.strictEqual(unfilled.status, 1);
    assert.strictEqual(unfilled.stdout, '');
    assert.ok(unfilled.stderr.includes('Missing value for {{concept}}'), unfilled.stderr);

    const status = run(['Explain {{concept}} to a {{audience=beginner}}', '--concept=recursion', '--no-interactive', '--status']);
    assert.strictEqual(status.status, 0);
    const lines = status.stdout.trim().split('\n');
    assert.strictEqual(lines.length, 1, `--status should print one line:\n${status.stdout}`);
    assert.ok(lines[0].includes('concept=recursion'));
    assert.ok(lines[0].includes('audience=beginner(default)'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('README install snippets point at skill files that exist in the repository', () => {
  const readme = readFileSync(README, 'utf-8');
  assert.ok(readme.includes('skills/promptargs/SKILL.md'), 'README should link the Agent Skill');
  assert.ok(existsSync(SKILL_FILE));

  // `cp -r skills/promptargs ...` copies the directory; it must contain
  // nothing but the skill so no stray file lands in ~/.copilot/skills.
  const copied = /cp -r (skills\/promptargs)\b/.exec(readme);
  assert.ok(copied, 'README should document copying skills/promptargs');
  assert.ok(existsSync(join(ROOT, copied[1], 'SKILL.md')));

  const rawUrls = [...readme.matchAll(/https:\/\/raw\.githubusercontent\.com\/hivecommons\/promptargs\/main\/(\S+)/g)]
    .map((m) => m[1]);
  assert.ok(rawUrls.length > 0, 'README should reference raw.githubusercontent.com skill files');
  for (const rel of rawUrls) {
    assert.ok(existsSync(join(ROOT, rel)), `README curls ${rel}, which does not exist in the repository`);
  }
});

test('the slash-command skill files agree with SKILL.md on the always-on switch', () => {
  // Each tool-specific copy under .claude/, .goose/ and .bob/ is hand
  // maintained; all of them must still tell the agent to pass
  // --no-interactive so none of them documents a hanging command.
  const readme = readFileSync(README, 'utf-8');
  const files = [...readme.matchAll(/https:\/\/raw\.githubusercontent\.com\/hivecommons\/promptargs\/main\/(\S+)/g)]
    .map((m) => join(ROOT, m[1]));
  for (const f of [SKILL_FILE, ...files]) {
    const content = readFileSync(f, 'utf-8');
    assert.ok(content.includes('--no-interactive'), `${f} should tell agents to pass --no-interactive`);
    const { fields: fm } = parseFrontmatter(content);
    assert.strictEqual(fm.name, 'promptargs', `${f}: frontmatter name should be promptargs`);
  }
});

test('README.md and SKILL.md list exactly the reserved subcommand names', () => {
  // Both docs enumerate the template names the CLI reserves for its
  // subcommands; a subcommand added to SUBCOMMANDS must be documented there.
  const expected = [...CLI_SUBCOMMANDS].sort();
  for (const file of [README, SKILL_FILE]) {
    const m = /template file names (.*?) are reserved for the subcommands/.exec(readFileSync(file, 'utf-8'));
    assert.ok(m, `${file} should list the template names reserved for subcommands`);
    const names = [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]);
    assert.deepStrictEqual([...new Set(names)].sort(), expected, `${file}: reserved subcommand names drifted from SUBCOMMANDS`);
  }
});
