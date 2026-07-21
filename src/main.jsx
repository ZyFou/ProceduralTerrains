import React from 'react';
import { createRoot } from 'react-dom/client';
import Root from './Root.jsx';
import { LoadingProvider } from './state/loading.jsx';
import './cursors.css';
import './styles.css';

// No StrictMode on purpose: its dev double-mount would create (and tear down)
// a second WebGL context + full terrain board on every load.
createRoot(document.getElementById('root')).render(
  <LoadingProvider>
    <Root />
  </LoadingProvider>,
);

// Fade out the instant first-paint splash (index.html) once React has mounted.
// The engine's `boot` blocking overlay is already painted underneath, so the
// handoff is seamless.
const splash = document.getElementById('boot-splash');
if (splash) {
  const fade = () => {
    if (splash.classList.contains('hide')) return;   // already fading
    splash.classList.add('hide');
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
    // safety: remove even if transitionend never fires (reduced motion / no transition)
    setTimeout(() => splash.remove(), 600);
  };
  // rAF lets the first React commit land before fading, but rAF is throttled
  // when the tab is occluded — race it against a timeout so the splash always
  // clears.
  requestAnimationFrame(fade);
  setTimeout(fade, 100);
}
