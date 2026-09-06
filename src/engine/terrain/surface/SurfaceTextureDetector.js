// Match map labels in the basename, not parent folders. Underscores are word
// characters in regexes, so normalize separators before using word boundaries.
const SLOT_PATTERNS = [
  { slot: 'displacement', re: /\b(displacement|disp|height\s*map|height)\b/i },
  { slot: 'normalDX', re: /\b(normal\s*(?:dx|directx)|nor\s*dx|normal|nrm|norm)\b/i },
  { slot: 'roughness', re: /\b(roughness|rough)\b/i },
  { slot: 'ao', re: /\b(ambient\s*occlusion|occlusion|ao)\b/i },
  { slot: 'diffuse', re: /\b(base\s*colou?r|albedo|diffuse|diff|colou?r|col)\b/i },
];

export function describeTextureFilename(filename) {
  const basename = String(filename).replace(/\\/g, '/').split('/').pop();
  const name = basename.replace(/\.[^.]+$/, '')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_.-]+/g, ' ').toLowerCase();
  // The normal slot is DirectX. Do not silently interpret GL normals as DX.
  if (/\b(?:normal|nor)\s*(?:gl|opengl)\b/.test(name)) return null;
  for (const { slot, re } of SLOT_PATTERNS) {
    if (!re.test(name)) continue;
    const setName = name.replace(re, ' ')
      .replace(/\b(?:\d+k|\d{3,5}(?:x\d{3,5})?)\b/g, ' ')
      .trim().replace(/\s+/g, ' ');
    return { slot, setName };
  }
  return null;
}

export function detectSlotFromFilename(filename) {
  return describeTextureFilename(filename)?.slot ?? null;
}
