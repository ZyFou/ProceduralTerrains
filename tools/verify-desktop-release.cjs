const fs = require('node:fs');
const path = require('node:path');

function dotenvValue(name) {
  try {
    const source = fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8');
    const line = source.split(/\r?\n/).find((entry) => entry.trim().startsWith(`${name}=`));
    if (!line) return '';
    return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
  } catch {
    return '';
  }
}

const value = String(process.env.VITE_DISTANT_URL || dotenvValue('VITE_DISTANT_URL')).trim();

try {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('The URL must use HTTPS.');
} catch {
  console.error('VITE_DISTANT_URL must be set to the HTTPS remote API URL before packaging the Windows release.');
  process.exitCode = 1;
}
