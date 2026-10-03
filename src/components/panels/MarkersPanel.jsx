import React, { useState } from 'react';
import SidePanel from './SidePanel.jsx';
import { ToggleRow, SelectRow, SliderCtl } from '../controls.jsx';
import { COORDINATE_FORMATS } from '../../engine/terrain/CoordinateFormats.js';
import { parseCoordinateInput, formatCoordinateDisplay } from '../../engine/terrain/RealWorldHeightmap.js';

export default function MarkersPanel({ ctx }) {
  const state = ctx.realWorldMarkers;
  const status = ctx.realWorldMarkerStatus || {};
  const [name, setName] = useState('');
  const [coordinates, setCoordinates] = useState('');
  const [format, setFormat] = useState('degrees');
  const [error, setError] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [editing, setEditing] = useState(null);
  const update = (patch) => ctx.onRealWorldMarkers({ ...state, ...patch });
  const save = (e) => {
    e.preventDefault();
    const point = parseCoordinateInput(coordinates, format);
    if (!point || Math.abs(point.lat) > 85.051) { setError('Enter valid coordinates in the selected format.'); return; }
    if (!name.trim()) { setError('Enter a place name.'); return; }
    if (!editing && state.points.length >= 200) { setError('The limit is 200 markers.'); return; }
    const previous = state.points.find((p) => p.id === editing);
    const next = { ...previous, id: editing || crypto.randomUUID(), name: name.trim(), ...point, visible: previous?.visible !== false };
    update({ points: editing ? state.points.map((p) => p.id === editing ? next : p) : [...state.points, next] });
    setName(''); setCoordinates(''); setEditing(null); setError('');
  };
  const shownPoints = state.points.filter((p) => p.source !== 'city' || state.autoCities);
  const options = [{ value: '', label: 'Choose a marker' }, ...shownPoints.map((p) => ({ value: p.id, label: p.name }))];
  const routeValid = from && to && from !== to && state.points.some((p) => p.id === from) && state.points.some((p) => p.id === to);
  return <SidePanel title="Markers" description="Floating places and routes above real terrain." onClose={ctx.onClose}>
    <p className="section-hint">Add cities or other places by name and coordinates. Only points within loaded terrain tiles are displayed.</p>
    <ToggleRow label="Show markers and routes" value={state.visible} onChange={(visible) => update({ visible })} />
    <ToggleRow label="Show place labels" value={state.labels} onChange={(labels) => update({ labels })} />
    <ToggleRow label="Automatic city markers" value={state.autoCities} onChange={(autoCities) => update({ autoCities })} />
    <p className="section-hint">Automatically place named cities, towns, and villages from OpenStreetMap above loaded terrain.</p>
    {state.autoCities && <>
      <button className="action-btn" disabled={status.loading} onClick={ctx.onRefreshCityMarkers}>{status.loading ? 'Loading cities…' : 'Refresh city markers'}</button>
      {status.error && <p className="section-hint import-map-error" role="alert">{status.error}</p>}
      {!status.loading && !status.error && <p className="section-hint">{state.points.filter((p) => p.source === 'city').length} city markers · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></p>}
    </>}
    <ToggleRow label="Click markers to create routes" value={!!status.picking} onChange={ctx.onMarkerRoutePicking} />
    {status.picking && <div className="marker-route-prompt" role="status">
      <p>{status.from ? `From ${status.fromName} — click the destination marker.` : 'Click a marker in the terrain view, then a second marker to create a route.'}</p>
      {status.from && <button className="action-btn" onClick={() => ctx.onMarkerRoutePicking(true)}>Cancel selection</button>}
    </div>}
    <SliderCtl def={{ label: 'Height above terrain', min: 1, max: 500, step: 1, unit: ' m', digits: 0 }} value={state.lift} onChange={(lift) => update({ lift })} />
    <form className="markers-form" onSubmit={save}>
      <label className="setting-label" htmlFor="marker-name">Place name</label>
      <div className="seed-input-wrap"><input id="marker-name" value={name} maxLength={80} placeholder="City or place name" onChange={(e) => setName(e.target.value)} /></div>
      <SelectRow label="Coordinate format" value={format} options={COORDINATE_FORMATS} onChange={(next) => {
        const parsed = parseCoordinateInput(coordinates, format);
        if (coordinates.trim() && !parsed) { setError('Correct the coordinates before switching format.'); return; }
        if (parsed) {
          const converted = formatCoordinateDisplay(parsed, next);
          if (!parseCoordinateInput(converted, next)) { setError('Lambert 93 covers mainland France and Corsica. Choose another format for this place.'); return; }
          setCoordinates(converted);
        }
        setFormat(next); setError('');
      }} />
      <label className="setting-label" htmlFor="marker-coordinates">{['lambert93', 'mercator'].includes(format) ? 'Easting, northing (meters)' : 'Latitude, longitude'}</label>
      <div className="seed-input-wrap"><input id="marker-coordinates" value={coordinates} onChange={(e) => setCoordinates(e.target.value)} placeholder={format === 'lambert93' ? '700000, 6600000' : format === 'mercator' ? '333958.47, 5860839.83' : '46.5, 3.0'} /></div>
      {error && <p className="section-hint import-map-error" role="alert">{error}</p>}
      <button className="action-btn primary" type="submit">{editing ? 'Save marker' : 'Add marker'}</button>
      {editing && <button className="action-btn" type="button" onClick={() => { setEditing(null); setName(''); setCoordinates(''); setError(''); }}>Cancel edit</button>}
    </form>
    <div className="markers-list">
      {shownPoints.map((p) => <div className={`marker-item${status.from === p.id ? ' marker-item-selected' : ''}`} key={p.id}>
        <ToggleRow label={p.name} value={p.visible} onChange={(visible) => update({ points: state.points.map((point) => point.id === p.id ? { ...point, visible } : point) })} />
        <span className="section-hint">{formatCoordinateDisplay(p, format)}</span>
        {status.picking && <button className="action-btn" disabled={!p.visible || !state.visible} onClick={() => ctx.onSelectMarkerForRoute(p.id)}>{status.from === p.id ? 'Starting point selected' : status.from ? 'Route to this marker' : 'Start route here'}</button>}
        <div className="marker-actions"><button className="action-btn" onClick={() => { setEditing(p.id); setName(p.name); setCoordinates(formatCoordinateDisplay(p, format)); setError(''); }}>Edit</button>
          <button className="action-btn" aria-label={`Delete ${p.name}`} onClick={() => { update({ points: state.points.filter((point) => point.id !== p.id), routes: state.routes.filter((r) => r.from !== p.id && r.to !== p.id) }); if (editing === p.id) { setEditing(null); setName(''); setCoordinates(''); } }}>Delete</button></div>
      </div>)}
    </div>
    <h3 className="setting-label">Routes</h3>
    <p className="section-hint">Connect two markers with a direct line that follows the terrain. These are visual connections, not driving directions.</p>
    <SelectRow label="From" value={from} options={options} onChange={setFrom} />
    <SelectRow label="To" value={to} options={options} onChange={setTo} />
    <button className="action-btn primary" disabled={!routeValid || state.routes.length >= 200} onClick={() => update({ routes: [...state.routes, { id: crypto.randomUUID(), from, to, visible: true }] })}>Add route</button>
    {state.routes.map((r) => <div className="marker-item" key={r.id}>
      <ToggleRow label={`${state.points.find((p) => p.id === r.from)?.name} → ${state.points.find((p) => p.id === r.to)?.name}`} value={r.visible} onChange={(visible) => update({ routes: state.routes.map((route) => route.id === r.id ? { ...route, visible } : route) })} />
      <button className="action-btn" aria-label="Delete route" onClick={() => update({ routes: state.routes.filter((route) => route.id !== r.id) })}>Delete route</button>
    </div>)}
  </SidePanel>;
}
