import { describe, expect, it } from 'vitest';
import {
  EDITABLE_PROJECT_FORMAT,
  createEditableProjectDocument,
  readEditableProjectDocument,
  suggestedProjectFilename,
} from '../src/project/ProjectDocument.js';

const terrain = { params: { seed: 42, chunkCount: 16, chunkSize: 128 } };

describe('desktop editable project documents', () => {
  it('writes the complete project envelope under the desktop document format', () => {
    const document = createEditableProjectDocument({ metadata: { name: 'Alpine Study' }, terrain });
    expect(document.format).toBe(EDITABLE_PROJECT_FORMAT);
    expect(document.metadata.name).toBe('Alpine Study');
    expect(document.terrain.params.seed).toBe(42);
  });

  it('loads editable documents and preserves legacy JSON imports', () => {
    const document = createEditableProjectDocument({ metadata: { name: 'Lake' }, terrain });
    expect(readEditableProjectDocument(document).metadata.name).toBe('Lake');
    expect(readEditableProjectDocument(terrain, { legacy: true }).terrain.params.seed).toBe(42);
  });

  it('rejects runtime ptrterrain files so they cannot be mistaken for editable projects', () => {
    expect(() => readEditableProjectDocument({ format: 'procedural-terrains-runtime', project: { seed: 42 } }))
      .toThrow(/runtime export/i);
  });

  it('uses safe ptrterrain filenames', () => {
    expect(suggestedProjectFilename('  Alpine / Lake  ')).toBe('alpine-lake.ptrterrain');
  });
});
