Original prompt: In square mode the add-tile overlay must be square; circle mode must crop the terrain correctly without a circular add overlay; move tile information into the World tab.

- Diagnosed the circular assembly regression from commit 960991f.
- Planned fixes: restore square ghost geometry, disable tile-add hover interaction in circle mode, discard terrain fragments outside the circular mask, and merge Tiles controls into World.
- Implemented the geometry/shader/UI fixes. Verification pending.
- Fixed a live runtime error caused by the moved Tiles content missing its ControlSection import.
- Live verification: World contains Tiles, circle mode crops the square mesh cleanly and has no add preview, square mode shows a square add-tile preview.
- Removed an ANGLE shader warning by making assemblyFalloff assign both branches before mixing.
- Final production build passes and a clean browser startup reports no console warnings or errors.
