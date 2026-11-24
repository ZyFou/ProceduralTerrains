import { describe, expect, it } from 'vitest';
import { compileTerrainGraph } from '../src/engine/terrain/graph/GraphCompiler.js';
import { NODE_PROJECT_TEMPLATES, createNodeTemplateGraph } from '../src/project/NodeProjectTemplates.js';
import { graphSurfaceTextureParams } from '../src/engine/terrain/surface/graphSurfaceParams.js';
import { SURFACE_TEXTURE_SOURCE } from '../src/engine/terrain/surface/SurfaceTextureSources.js';

const program = (id) => compileTerrainGraph(createNodeTemplateGraph(id)).program;
const PBR_TEMPLATES = NODE_PROJECT_TEMPLATES.filter((template) => template.id.startsWith('nodes-pbr-')).map((template) => template.id);

describe('graphSurfaceTextureParams', () => {
  it.each(PBR_TEMPLATES.map((id) => [id]))('%s opens a fresh project fully textured', (id) => {
    expect(graphSurfaceTextureParams(program(id), { fresh: true })).toEqual({
      surfaceTextureSource: SURFACE_TEXTURE_SOURCE.PBR,
      surfaceTextureMode: true,
      surfaceTextureAmount: 1,
    });
  });

  it('keeps the user amount when an existing PBR graph is recompiled', () => {
    const canyon = program('nodes-pbr-canyon');
    expect(graphSurfaceTextureParams(canyon, { previousProgram: canyon })).not.toHaveProperty('surfaceTextureAmount');
    expect(graphSurfaceTextureParams(canyon, { previousProgram: program('nodes-alpine') }).surfaceTextureAmount).toBe(1);
  });

  it('leaves graphs without PBR materials alone', () => {
    for (const id of ['nodes-blank', 'nodes-alpine', 'nodes-dry-canyon']) {
      expect(graphSurfaceTextureParams(program(id), { fresh: true })).toBeNull();
    }
    expect(graphSurfaceTextureParams(null, { fresh: true })).toBeNull();
  });
});
