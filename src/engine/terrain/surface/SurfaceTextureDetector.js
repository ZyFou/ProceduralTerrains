// Guesses which map slot a dropped/imported file belongs to, from its filename.
// Used by drag-and-drop in the Surface Library so a user can drop a batch of
// files from a third-party texture pack without manually picking each slot.
const SLOT_PATTERNS = [
  { slot: 'displacement', re: /(displacement|_disp\b|heightmap|height[_-]?map|\bheight\b)/i },
  { slot: 'normalDX', re: /(normal[_-]?dx|normaldx|nor[_-]?dx|_nor[_-]?dx_|\bnormal\b|\bnrm\b|\bnorm\b)/i },
  { slot: 'roughness', re: /(roughness|_rough_|\brough\b)/i },
  { slot: 'ao', re: /(ambient[_-]?occlusion|\bocclusion\b|_ao_|\bao\b)/i },
  { slot: 'diffuse', re: /(base[_-]?color|albedo|diffuse|_diff_|\bdiff\b|\bcolou?r\b|\bcol\b)/i },
];

// Returns one of the SurfaceLibrary map slot keys, or null if nothing matched.
export function detectSlotFromFilename(filename) {
  const name = filename.toLowerCase();
  for (const { slot, re } of SLOT_PATTERNS) {
    if (re.test(name)) return slot;
  }
  return null;
}
