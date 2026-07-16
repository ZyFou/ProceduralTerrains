import { createContext } from 'react';

// When true, ControlSection renders collapsible panel-group sections inside the
// side drawer. The legacy right inspector uses the same component with folder
// chrome tuned for the denser inspector layout.
export const FlatPanelContext = createContext(false);

/** Desktop drawer chrome: header drag-to-snap (no grab icon). */
export const DrawerChromeContext = createContext({
  onHeaderPointerDown: null,
});
