const fs = require('node:fs/promises');
const path = require('node:path');
const pngToIco = require('png-to-ico').default;

async function main() {
  const source = path.resolve(__dirname, '../public/favicon.png');
  const target = path.resolve(__dirname, '../electron/assets/icon.ico');
  await fs.mkdir(path.dirname(target), { recursive: true });
  const ico = await pngToIco(source);
  await fs.writeFile(target, ico);
  process.stdout.write(`${target}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
