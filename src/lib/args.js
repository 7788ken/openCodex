export function parseArgs(args) {
  const flags = {};
  const positionals = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const name = token.slice(2);
    const next = args[index + 1];

    if (!next || next.startsWith('--')) {
      flags[name] = true;
      continue;
    }

    flags[name] = next;
    index += 1;
  }

  return { flags, positionals };
}

export function parseOptions(args, spec) {
  const { flags, positionals } = parseArgs(args);
  const options = {};

  for (const [name, value] of Object.entries(flags)) {
    const definition = spec[name];
    if (!definition) {
      throw new Error(`Unknown option: --${name}`);
    }
    if (definition.type === 'boolean') {
      options[name] = Boolean(value);
      continue;
    }
    if (typeof value !== 'string') {
      throw new Error(`Option --${name} requires a value`);
    }
    options[name] = value;
  }

  return { options, positionals };
}

