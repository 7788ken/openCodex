export function parseOptions(args, spec) {
  const options = {};
  const positionals = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const name = token.slice(2);
    const definition = spec[name];

    if (!definition) {
      throw new Error(`Unknown option: --${name}`);
    }

    if (definition.type === 'boolean') {
      options[name] = true;
      continue;
    }

    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Option --${name} requires a value`);
    }

    options[name] = value;
    index += 1;
  }

  return { options, positionals };
}
