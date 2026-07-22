const DB_NAME = 'procedural-terrains-projects';
const STORE_NAME = 'projects';
const FALLBACK_KEY = 'procedural-terrains-projects-v1';
const now = () => new Date().toISOString();
const id = () => globalThis.crypto?.randomUUID?.() ?? `project-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function emitChange() {
  window.dispatchEvent(new Event('terrain-projects:changed'));
}

function openDatabase() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is unavailable'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const request = action(tx.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error);
  });
}

function fallbackRead() {
  try { return JSON.parse(localStorage.getItem(FALLBACK_KEY) ?? '[]'); } catch { return []; }
}
function fallbackWrite(projects) { localStorage.setItem(FALLBACK_KEY, JSON.stringify(projects)); }

export function normalizeProject(input = {}) {
  const legacyTerrain = input.terrain ?? input;
  const editorMode = legacyTerrain?.editorMode === 'nodes'
    ? 'nodes'
    : legacyTerrain?.editorMode === 'procedural'
      ? 'procedural'
      : legacyTerrain?.generationSource === 'graph' ? 'nodes' : 'procedural';
  const terrain = {
    ...legacyTerrain,
    editorMode,
    generationSource: editorMode === 'nodes' ? 'graph' : 'classic',
    graph: legacyTerrain?.graph ?? null,
    graphView: legacyTerrain?.graphView && typeof legacyTerrain.graphView === 'object'
      ? { x: Number(legacyTerrain.graphView.x) || 0, y: Number(legacyTerrain.graphView.y) || 0, zoom: Number(legacyTerrain.graphView.zoom) || 1 }
      : { x: 0, y: 0, zoom: 1 },
  };
  const metadata = input.metadata ?? {};
  const created = metadata.created ?? input.created ?? now();
  return {
    schemaVersion: 2,
    id: input.id ?? id(),
    metadata: {
      name: String(metadata.name ?? input.name ?? 'Untitled terrain').trim() || 'Untitled terrain',
      author: String(metadata.author ?? ''),
      description: String(metadata.description ?? ''),
      tags: Array.isArray(metadata.tags) ? metadata.tags.map(String).slice(0, 12) : [],
      created,
      modified: metadata.modified ?? input.modified ?? now(),
      thumbnail: metadata.thumbnail ?? null,
      dependencies: Array.isArray(metadata.dependencies) ? metadata.dependencies : [],
    },
    terrain,
    exportHistory: Array.isArray(input.exportHistory) ? input.exportHistory : [],
  };
}

export const projectStore = {
  async list() {
    try {
      const projects = await withStore('readonly', (store) => store.getAll());
      return projects.map(normalizeProject).sort((a, b) => b.metadata.modified.localeCompare(a.metadata.modified));
    } catch {
      return fallbackRead().map(normalizeProject).sort((a, b) => b.metadata.modified.localeCompare(a.metadata.modified));
    }
  },

  async save(project) {
    const normalized = normalizeProject(project);
    normalized.metadata.modified = now();
    try { await withStore('readwrite', (store) => store.put(normalized)); }
    catch {
      const projects = fallbackRead();
      const index = projects.findIndex((item) => item.id === normalized.id);
      if (index >= 0) projects[index] = normalized;
      else projects.push(normalized);
      fallbackWrite(projects);
    }
    emitChange();
    return normalized;
  },

  async remove(projectId) {
    try { await withStore('readwrite', (store) => store.delete(projectId)); }
    catch { fallbackWrite(fallbackRead().filter((project) => project.id !== projectId)); }
    emitChange();
  },

  async rename(project, name) {
    const nextName = String(name ?? '').trim();
    if (!nextName) throw new Error('A project name is required');
    return this.save({ ...project, metadata: { ...project.metadata, name: nextName } });
  },

  async duplicate(project) {
    const copy = normalizeProject({ ...project, id: id(), metadata: { ...project.metadata, name: `${project.metadata.name} copy`, created: now() } });
    return this.save(copy);
  },

  async importCopy(project, { name } = {}) {
    const imported = normalizeProject({
      ...project,
      id: id(),
      metadata: {
        ...project?.metadata,
        name: String(name ?? project?.metadata?.name ?? 'Shared terrain'),
        created: now(),
      },
    });
    return this.save(imported);
  },
};

export function projectStats(project) {
  const params = project?.terrain?.params ?? {};
  const tiles = project?.terrain?.tiles?.length ?? 1;
  const worldSize = Number(params.chunkCount) * Number(params.chunkSize);
  return { tiles, worldSize: Number.isFinite(worldSize) ? worldSize : 0, seed: params.seed };
}
