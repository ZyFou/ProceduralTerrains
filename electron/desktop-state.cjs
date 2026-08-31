const fs = require('node:fs/promises');
const path = require('node:path');

const STATE_FILE = 'desktop-state.json';
const RECENT_LIMIT = 12;

async function readState(userDataPath) {
  try {
    const value = JSON.parse(await fs.readFile(path.join(userDataPath, STATE_FILE), 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

async function writeState(userDataPath, state) {
  const target = path.join(userDataPath, STATE_FILE);
  const temporary = `${target}.tmp`;
  await fs.mkdir(userDataPath, { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, target);
}

function normalizeRecent(entries) {
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  return entries.filter((entry) => {
    const filePath = typeof entry?.path === 'string' ? entry.path : '';
    if (!filePath || seen.has(filePath)) return false;
    seen.add(filePath);
    return true;
  }).slice(0, RECENT_LIMIT);
}

module.exports = {
  async getSettings(userDataPath) {
    const state = await readState(userDataPath);
    return state.backend && typeof state.backend === 'object' ? state.backend : null;
  },

  async setSettings(userDataPath, backend) {
    const state = await readState(userDataPath);
    state.backend = backend;
    await writeState(userDataPath, state);
    return backend;
  },

  async listRecent(userDataPath) {
    const state = await readState(userDataPath);
    return normalizeRecent(state.recentDocuments);
  },

  async rememberRecent(userDataPath, entry) {
    const state = await readState(userDataPath);
    const next = normalizeRecent([entry, ...(state.recentDocuments || [])]);
    state.recentDocuments = next;
    await writeState(userDataPath, state);
    return next;
  },

  async forgetRecent(userDataPath, documentPath) {
    const state = await readState(userDataPath);
    state.recentDocuments = normalizeRecent((state.recentDocuments || []).filter((entry) => entry.path !== documentPath));
    await writeState(userDataPath, state);
    return state.recentDocuments;
  },
};
