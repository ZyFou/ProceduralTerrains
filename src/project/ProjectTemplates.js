export const PROJECT_TEMPLATES = [
  { id: 'blank', name: 'Blank terrain', description: 'A clean terrain canvas.', preset: 'highlands' },
  { id: 'island', name: 'Island', description: 'Ocean, beaches, and a dramatic core.', preset: 'archipelago' },
  { id: 'mountain', name: 'Mountain range', description: 'Sharp peaks, snow, and valleys.', preset: 'alpine' },
  { id: 'desert', name: 'Desert', description: 'Dunes, dry basins, and warm light.', preset: 'dunes' },
  { id: 'fantasy', name: 'Fantasy world', description: 'A stylized terrain starting point.', preset: 'cartoon' },
];

export function getProjectTemplate(id) {
  return PROJECT_TEMPLATES.find((template) => template.id === id) ?? PROJECT_TEMPLATES[0];
}

// Preview images are render artifacts rather than project data. Version their
// cache independently so a shader/transition fix cannot keep serving an older
// flat render for a procedural template.
export function projectTemplatePreviewCacheKey(id) {
  return `terrain-template-preview:procedural-v2:${id}`;
}
