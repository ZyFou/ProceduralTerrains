import React, { useEffect, useMemo, useRef } from 'react';
import { SEARCH_SETTINGS_SHORTCUT } from '../../keyboardShortcuts.js';
import ShortcutHint from './ShortcutHint.jsx';

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export default function SettingsSearchOverlay({
  open,
  query,
  groupedResults,
  flatResults,
  selectedIndex,
  onChangeQuery,
  onSelectIndex,
  onConfirm,
  onConfirmPanel,
  onClose,
}) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select?.();
  }, [open]);

  const totalResults = flatResults.length;
  const hasResults = totalResults > 0;
  const hint = useMemo(() => {
    if (!query.trim()) return 'Search terrain, water, biomes, lighting, performance...';
    if (!hasResults) return 'No matching settings. Try a broader keyword.';
    return 'Enter opens the selected item. Click a category to open its panel. Esc closes.';
  }, [hasResults, query]);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (totalResults) onSelectIndex(Math.min(selectedIndex + 1, totalResults - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (totalResults) onSelectIndex(Math.max(selectedIndex - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className={`settings-search-overlay${open ? ' open' : ''}`} aria-hidden={!open}>
      <button
        type="button"
        className="settings-search-backdrop"
        aria-label="Close settings search"
        onClick={onClose}
      />
      <div className="settings-search-shell" role="dialog" aria-modal="false" aria-label="Search settings">
        <div className="settings-search-wrap settings-search-wrap-global">
          <SearchIcon />
          <input
            ref={inputRef}
            type="search"
            className="settings-search-input"
            placeholder="Search settings..."
            value={query}
            onChange={(e) => onChangeQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {query && (
            <button
              type="button"
              className="settings-search-clear"
              onClick={() => onChangeQuery('')}
              aria-label="Clear search"
            >
              x
            </button>
          )}
        </div>

        <div className="settings-search-results-panel">
          <div className="settings-search-hint-row">
            <span>{hint}</span>
            <ShortcutHint shortcut={SEARCH_SETTINGS_SHORTCUT} className="settings-search-shortcut" />
          </div>

          {groupedResults.length > 0 ? (
            <div className="settings-search-results">
              {groupedResults.map((group) => (
                <section className="settings-search-group" key={group.panelId}>
                  <button
                    type="button"
                    className="settings-search-group-title settings-search-group-title-btn"
                    onClick={() => onConfirmPanel?.(group.panelId)}
                  >
                    <span>{group.panelLabel}</span>
                    <span>{group.items.length}</span>
                  </button>
                  <div className="settings-search-group-body">
                    {group.items.map((item) => {
                      const isActive = flatResults[selectedIndex]?.settingId === item.settingId;
                      return (
                        <button
                          key={item.settingId}
                          type="button"
                          className={`settings-search-item${isActive ? ' active' : ''}`}
                          onMouseEnter={() => onSelectIndex(item.flatIndex)}
                          onClick={() => onConfirm(item.flatIndex)}
                        >
                          <div className="settings-search-item-row">
                            <div className="settings-search-item-copy">
                              <div className="settings-search-item-label">{item.label}</div>
                              <div className="settings-search-item-meta">
                                <span>{group.panelLabel}</span>
                                {item.sectionLabel && <span>{item.sectionLabel}</span>}
                              </div>
                            </div>
                            <span className="settings-search-item-value">
                              {item.isSection ? 'Section' : (item.valueText ?? '-')}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="settings-search-empty">No settings match this search.</div>
          )}
        </div>
      </div>
    </div>
  );
}
