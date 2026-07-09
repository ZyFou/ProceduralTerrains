import { Route } from 'lucide-react';

export default function CreatorToolbar({ active, onToggle }) {
  return (
    <div className="creator-toolbar" role="toolbar" aria-label="Creator tools">
      <button
        type="button"
        className={`creator-toolbar-btn${active ? ' active' : ''}`}
        onClick={onToggle}
        title="Toggle spline editor (S)"
        aria-label="Toggle spline editor"
        aria-pressed={active}
      >
        <Route size={16} strokeWidth={1.9} aria-hidden />
      </button>
    </div>
  );
}
