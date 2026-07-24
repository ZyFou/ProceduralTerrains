import test from 'node:test';
import assert from 'node:assert/strict';
import { createShareCode, normalizeShareCode, validateProjectCreate, validateProjectUpdate } from '../src/project-utils.js';

test('share codes avoid ambiguous characters and normalize separators', () => {
  const code = createShareCode();
  assert.match(code, /^[A-HJ-NP-Z2-9]{10}$/);
  assert.equal(normalizeShareCode(`${code.slice(0, 5)}-${code.slice(5).toLowerCase()}`), code);
  assert.equal(normalizeShareCode('bad code'), null);
});

test('project creation uses project metadata and the account default visibility', () => {
  const result = validateProjectCreate({ project: { metadata: { name: 'Cloud mountain', description: 'A test' }, terrain: {} } }, 'unlisted');
  assert.equal(result.ok, true);
  assert.equal(result.value.name, 'Cloud mountain');
  assert.equal(result.value.description, 'A test');
  assert.equal(result.value.visibility, 'unlisted');
});

test('project creation preserves geographic source settings as ordinary project JSON', () => {
  const realWorldSource = {
    version: 1,
    id: 'custom',
    name: 'Custom terrain',
    bbox: { minLat: 45.8, maxLat: 46, minLon: 6.7, maxLon: 7 },
    zoom: 12,
    imageryStyle: 'satellite',
    heightSettings: { mode: 'replace', blend: 1, invert: false, normalize: false, heightStrength: 1, heightOffset: 0 },
    imagerySettings: { mode: 'blend', blend: 0.7 },
  };
  const result = validateProjectCreate({
    project: { metadata: { name: 'Cloud terrain' }, terrain: { realWorldSource } },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(result.value.projectData).terrain.realWorldSource, realWorldSource);
});

test('project updates validate visibility and require a field', () => {
  assert.equal(validateProjectUpdate({}).ok, false);
  assert.equal(validateProjectUpdate({ visibility: 'friends' }).ok, false);
  assert.equal(validateProjectUpdate({ name: 'Renamed', visibility: 'public' }).ok, true);
});

test('project document updates validate an optimistic content revision', () => {
  const protectedUpdate = validateProjectUpdate({ project: { terrain: {} }, expectedContentRevision: 4 });
  assert.equal(protectedUpdate.ok, true);
  assert.equal(protectedUpdate.expectedContentRevision, 4);
  assert.equal(validateProjectUpdate({ project: { terrain: {} }, expectedContentRevision: 0 }).ok, false);
  assert.equal(validateProjectUpdate({ name: 'Renamed', expectedContentRevision: 2 }).ok, false);
});
