import { describe, expect, it } from 'vitest';
import {
  PROJECT_TEMPLATES,
  getProjectTemplate,
  projectTemplatePreviewCacheKey,
} from '../src/project/ProjectTemplates.js';

describe('procedural project templates', () => {
  it('falls back to the blank procedural template', () => {
    expect(getProjectTemplate('missing')).toBe(PROJECT_TEMPLATES[0]);
    expect(PROJECT_TEMPLATES[0].id).toBe('blank');
  });

  it('uses a workflow-specific versioned preview cache', () => {
    expect(projectTemplatePreviewCacheKey('mountain')).toBe('terrain-template-preview:procedural-v2:mountain');
    expect(projectTemplatePreviewCacheKey('mountain')).not.toContain('nodes-v2');
  });
});
