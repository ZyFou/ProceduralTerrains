// Dev-only local API so the Surface Library UI can list/create variant folders
// under public/textures/terrain/<material>/. This never ships to a production
// build (apply: 'serve') — it's a convenience for the local editing tool, not
// a hosted API. Everything is validated against materials.json's known folder
// list + a strict slug pattern so it can only touch expected subfolders.
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TERRAIN_ROOT = path.resolve(__dirname, '../public/textures/terrain');
const MANIFEST_PATH = path.join(TERRAIN_ROOT, 'materials.json');
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const API_PATH = '/__surface_api/variants';

async function readManifest() {
  const raw = await fs.readFile(MANIFEST_PATH, 'utf8');
  return JSON.parse(raw);
}

async function listVariantFolders(materialFolder) {
  const dir = path.join(TERRAIN_ROOT, materialFolder);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export default function surfaceMaterialsApiPlugin() {
  return {
    name: 'surface-materials-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname !== API_PATH) return next();

        let manifest;
        try {
          manifest = await readManifest();
        } catch {
          return sendJson(res, 500, { error: 'materials.json unreadable' });
        }

        if (req.method === 'GET') {
          const materialId = url.searchParams.get('material');
          const material = manifest.materials.find((m) => m.id === materialId);
          if (!material) return sendJson(res, 400, { error: 'Unknown material' });
          const variants = await listVariantFolders(material.folder);
          return sendJson(res, 200, { variants });
        }

        if (req.method === 'POST') {
          let body;
          try { body = await readBody(req); } catch { return sendJson(res, 400, { error: 'Invalid JSON body' }); }
          const material = manifest.materials.find((m) => m.id === body.material);
          if (!material) return sendJson(res, 400, { error: 'Unknown material' });
          const name = String(body.name || '').trim();
          if (!SLUG_RE.test(name)) {
            return sendJson(res, 400, { error: 'Variant name must be letters/numbers/underscore/hyphen, starting with a letter or number.' });
          }
          const dir = path.join(TERRAIN_ROOT, material.folder, name);
          if (existsSync(dir)) return sendJson(res, 409, { error: 'A variant with that name already exists.' });

          await fs.mkdir(dir, { recursive: true });
          const fileList = manifest.mapSlots.map((slot) => `- \`${material.maps[slot]}\``).join('\n');
          const readme = `# ${material.name} — ${name}\n\n`
            + `Alternate texture set for the ${material.name} material. Same filenames as any other `
            + `variant, dropped in this folder instead:\n\n${fileList}\n\n`
            + 'Empty for now — add matching files and this variant becomes previewable/selectable from '
            + 'the Surface > Textures panel.\n';
          await fs.writeFile(path.join(dir, 'README.md'), readme);

          const variants = await listVariantFolders(material.folder);
          return sendJson(res, 200, { variants });
        }

        res.statusCode = 405;
        res.end('Method Not Allowed');
        return undefined;
      });
    },
  };
}
