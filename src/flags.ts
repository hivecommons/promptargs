export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export const SWITCHES = new Set(['no-interactive', 'cross', 'json', 'status']);
const SUBCOMMAND_NAMES = ['help', 'env', 'ui', 'init', 'list', 'show'] as const;
export type Subcommand = (typeof SUBCOMMAND_NAMES)[number];
export const SUBCOMMANDS = new Set<string>(SUBCOMMAND_NAMES);

export function subcommandCollision(name: string): string | undefined {
  return SUBCOMMANDS.has(name)
    ? `(unreachable: name collides with the "${name}" subcommand; rename the file)`
    : undefined;
}

export function assertNoReservedVars(vars: { name: string }[]): void {
  for (const v of vars) {
    if (v.name === 'help') {
      throw new UsageError(
        'Unsupported variable name "help": it is reserved for the --help flag; rename the blank',
      );
    }
    if (SWITCHES.has(v.name)) {
      throw new UsageError(
        `Unsupported variable name "${v.name}": it is reserved for the --${v.name} switch; rename the blank`,
      );
    }
  }
}

// -h/--help anywhere requests usage, except as the value of a preceding bare --flag (as parseFlags consumes it).
export function wantsHelp(args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') return true;
    if (arg.startsWith('--') && !arg.includes('=') && !SWITCHES.has(arg.slice(2)) && i + 1 < args.length && !args[i + 1].startsWith('--')) {
      i++;
    }
  }
  return false;
}

export function assertNoArgs(args: string[]): void {
  if (args.length > 0) {
    throw new UsageError(`Unexpected argument: ${args[0]}`);
  }
}

export function assertKnownFlags(flags: Record<string, string>, vars: { name: string }[], templateName: string): void {
  const known = new Set(vars.map((v) => v.name));
  for (const key of Object.keys(flags)) {
    if (!SWITCHES.has(key) && !known.has(key)) {
      // An inline template cannot be re-shown by name, so the hint only applies to file templates.
      const hint = templateName === 'inline' ? '' : ` Run "promptargs show ${templateName}" to see its variables.`;
      throw new UsageError(`Unknown flag --${key}: template "${templateName}" has no {{${key}}} blank.${hint}`);
    }
  }
}

export function assertOnlyFlags(flags: Record<string, string>, allowed: readonly string[], command: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(flags)) {
    if (!allowedSet.has(key)) {
      throw new UsageError(`Unknown flag --${key}: ${command} only accepts ${allowed.map((a) => `--${a}=<value>`).join(', ')}`);
    }
  }
}

export function parseFlags(args: string[]): Record<string, string> {
  // Null prototype so a key like __proto__ is stored as an own property instead of silently vanishing.
  const flags: Record<string, string> = Object.create(null);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      throw new UsageError(`Unexpected argument: ${arg}`);
    }
    const eq = arg.indexOf('=');
    if (eq > 0) {
      const key = arg.slice(2, eq);
      if (SWITCHES.has(key)) {
        throw new UsageError(`Invalid --${key}: --${key} takes no value`);
      }
      flags[key] = arg.slice(eq + 1);
      continue;
    }
    const name = arg.slice(2);
    if (SWITCHES.has(name)) {
      flags[name] = 'true';
    } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
      flags[name] = args[++i];
    } else {
      throw new UsageError(`Invalid --${name}: --${name} requires a value: --${name}=<value>`);
    }
  }
  // Spread copies own keys (including __proto__) onto an ordinary object for callers and deepStrictEqual.
  return { ...flags };
}

export function parsePort(flags: Record<string, string>): number | undefined {
  if (!('port' in flags)) return undefined;
  // Number('') is 0, so an empty --port= must be rejected before the range check.
  const port = Number(flags['port']);
  if (flags['port'] === '' || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new UsageError('Invalid --port: expected an integer from 0 to 65535. Usage: promptargs ui --port=3700');
  }
  return port;
}
