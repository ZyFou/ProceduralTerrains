Original prompt: In square mode the add-tile overlay must be square; circle mode must crop the terrain correctly without a circular add overlay; move tile information into the World tab.

- Diagnosed the circular assembly regression from commit 960991f.
- Planned fixes: restore square ghost geometry, disable tile-add hover interaction in circle mode, discard terrain fragments outside the circular mask, and merge Tiles controls into World.
- Implemented the geometry/shader/UI fixes. Verification pending.
- Fixed a live runtime error caused by the moved Tiles content missing its ControlSection import.
- Live verification: World contains Tiles, circle mode crops the square mesh cleanly and has no add preview, square mode shows a square add-tile preview.
- Removed an ANGLE shader warning by making assemblyFalloff assign both branches before mixing.
- Final production build passes and a clean browser startup reports no console warnings or errors.
- Follow-up requested: complete missing circle cells when switching from Square, support circular ring expansion, and make Mountains add edge noise instead of behaving like Island.
- Circle radius is now explicit and persisted in saves/undo. Each radius includes every square backing chunk intersected by the rendered disk, eliminating diagonal wedge gaps.
- Verified partial Square layout (2 tiles) becomes a complete radius-1 Circle (9 backing tiles), then expands through an all-around ring to radius 2 (25 backing tiles).
- Mountains now preserves the base terrain and adds deterministic ridged noise toward the outer boundary; CPU sampling matches the shader.
- Production build passes and the tested browser flow reports no console warnings or errors.
- Follow-up: remove the circular plinth's black top cap beneath water and suppress circular-mode chunk skirts that appear as dark tile seams.
- Implemented an open-top circular plinth (outer wall + bottom only), so lakes show the water material instead of a black cap.
- Disabled square chunk skirts in Circle mode; the circular plinth owns the perimeter wall and internal tile boundaries remain continuous.
- Verified top-down and close angled views after circle expansion: water renders normally, internal black seams are gone, and browser console is clean.
