import {
  APP_NAME,
  AUTHOR_NAME,
  AUTHOR_PORTFOLIO_URL,
  AUTHOR_X_URL,
  CURSOR_PACK_AUTHOR,
  CURSOR_PACK_URL,
  GITHUB_REPO_URL,
} from '../constants/app.js';
import { Logo, LandingVersionTile, LandingSeedTile, FEATURES, MODES } from './shared.jsx';

const MODE_ICONS = {
  studio: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 15 L8 10 L12 14 L16 8 L21 15" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  infinite: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 12c3-6 13-6 16 0s-13 6-16 0z" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  ),
  planet: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.5" />
      <ellipse cx="12" cy="12" rx="8" ry="3" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
    </svg>
  ),
};

export default function Landing({ exiting, bootReady, onLaunch, sessionSeed }) {
  return (
    <div className={`landing landing-overlay landing-b${exiting ? ' exiting' : ''}`}>
      <div className="landing-scrim" aria-hidden="true" />
      <div className="landing-b-inner">
        <header className="landing-b-header">
          <div className="landing-b-brand">
            <Logo size={28} />
            <span>{APP_NAME}</span>
          </div>
          <div className="landing-b-meta">
            <LandingSeedTile seed={sessionSeed} />
            <LandingVersionTile />
          </div>
        </header>

        <main className="landing-b-main">
          <section className="landing-b-hero">
            <p className="landing-b-eyebrow">Terrain Studio</p>
            <h1 className="landing-b-title">
              Sculpt worlds
              <br />
              <span>in real time</span>
            </h1>
            <p className="landing-b-lead">
              A shader-driven editor to explore, paint and export procedural landscapes —
              from a fixed tile board to an infinite world, all the way to a full planet.
            </p>
            <button
              type="button"
              className={`landing-cta${bootReady ? '' : ' loading'}`}
              onClick={onLaunch}
              disabled={!bootReady || exiting}
            >
              {bootReady ? (
                <>
                  Open Editor
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3 8h9M9 5l3 3-3 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </>
              ) : (
                <>
                  <span className="landing-cta-spinner" aria-hidden="true" />
                  Loading engine…
                </>
              )}
            </button>
          </section>

          <section className="landing-b-modes" aria-label="Available modes">
            {MODES.map((mode) => (
              <article key={mode.id} className="landing-b-mode-card">
                <div className="landing-b-mode-icon">{MODE_ICONS[mode.id]}</div>
                <div>
                  <h2>{mode.name}</h2>
                  <p>{mode.desc}</p>
                </div>
              </article>
            ))}
          </section>
        </main>

        <footer className="landing-b-footer">
          <div className="landing-b-pills">
            {FEATURES.map((f) => (
              <span key={f.title} className="landing-b-pill">{f.title}</span>
            ))}
          </div>

          <div className="landing-site-footer">
            <p className="landing-site-credit">
              Made by{' '}
              <a href={AUTHOR_PORTFOLIO_URL} target="_blank" rel="noopener noreferrer">
                {AUTHOR_NAME}
              </a>
            </p>
            <p className="landing-site-credit">
              Cursors by{' '}
              <a href={CURSOR_PACK_URL} target="_blank" rel="noopener noreferrer">
                {CURSOR_PACK_AUTHOR}
              </a>
            </p>
            <nav className="landing-site-links" aria-label="Project links">
              <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
              <span className="landing-site-sep" aria-hidden="true">·</span>
              <a href={AUTHOR_X_URL} target="_blank" rel="noopener noreferrer">X</a>
              <span className="landing-site-sep" aria-hidden="true">·</span>
              <a href={AUTHOR_PORTFOLIO_URL} target="_blank" rel="noopener noreferrer">Portfolio</a>
            </nav>
            <p className="landing-site-tagline">WebGL2 procedural terrain · React + Three.js</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
