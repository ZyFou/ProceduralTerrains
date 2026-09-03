const VALID_TARGETS = new Set(['terrain', 'water', 'cloud', 'post', 'scene', 'all']);

function argumentValue(argv, name) {
  const prefix = `${name}=`;
  const argument = argv.find((value) => String(value).startsWith(prefix));
  return argument ? String(argument).slice(prefix.length) : '';
}

function sanitizeToken(value) {
  return String(value || '')
    .trim()
    .slice(0, 64)
    .replace(/[^A-Za-z0-9._:-]/g, '-');
}

function parseShaderBenchmarkArgv(argv = []) {
  const family = argumentValue(argv, '--shader-benchmark').trim().toLowerCase();
  if (!VALID_TARGETS.has(family)) return null;
  const token = sanitizeToken(argumentValue(argv, '--shader-benchmark-token'));
  return { family, token: token || null };
}

function addShaderBenchmarkQuery(baseUrl, options) {
  if (!options) return baseUrl;
  const url = new URL(baseUrl);
  url.searchParams.set('shaderBenchmark', options.family);
  if (options.token) url.searchParams.set('shaderBenchmarkToken', options.token);
  return url.toString();
}

module.exports = { addShaderBenchmarkQuery, parseShaderBenchmarkArgv };
