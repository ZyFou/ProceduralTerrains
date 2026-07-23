import React, { useCallback, useEffect, useMemo, useState } from 'react';
import App from './App.jsx';
import Landing from './landing/Landing.jsx';
import { LandingProvider } from './landing/landingContext.jsx';
import { randomSessionSeed } from './landing/shared.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import { PopupProvider } from './components/ui/PopupProvider.jsx';
import './landing/landing.css';
import { adminApi } from './admin/adminApi.js';

const EXIT_MS = 720;

export default function Root() {
  const [visible, setVisible] = useState(true);
  const [exiting, setExiting] = useState(false);
  const [bootReady, setBootReady] = useState(false);
  const [sessionSeed] = useState(() => randomSessionSeed());

  const dismiss = useCallback(() => {
    if (!bootReady || exiting) return;
    setExiting(true);
    setTimeout(() => setVisible(false), EXIT_MS);
  }, [bootReady, exiting]);

  useEffect(() => {
    const showProjects = () => {
      setExiting(false);
      setVisible(true);
    };
    window.addEventListener('terrain-project:home', showProjects);
    return () => window.removeEventListener('terrain-project:home', showProjects);
  }, []);

  useEffect(() => {
    const path = `${window.location.pathname}${window.location.hash || ''}`.slice(0, 255);
    adminApi.trackVisit(path).catch(() => {});
  }, []);

  const landing = useMemo(
    () => ({ visible, exiting, bootReady, setBootReady, dismiss, sessionSeed }),
    [visible, exiting, bootReady, dismiss, sessionSeed],
  );

  return (
    <PopupProvider>
      <AuthProvider>
        <LandingProvider value={landing}>
          <App />
          {visible && (
            <Landing exiting={exiting} bootReady={bootReady} onLaunch={dismiss} sessionSeed={sessionSeed} />
          )}
        </LandingProvider>
      </AuthProvider>
    </PopupProvider>
  );
}
