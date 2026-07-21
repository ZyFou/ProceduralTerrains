import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, BackgroundVariant, Controls, Handle, Position, ReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Boxes, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleAlert,
  Eye, EyeOff, FolderPlus, GripVertical, Maximize2,
  Play, Plus, Search, Trash2, Ungroup, X,
} from 'lucide-react';
import {
  TERRAIN_OUTPUT_ID, addGraphNode, connectGraphNodes, createBlankGraph,
  duplicateGraphSelection, groupGraphNodes, moveGraphGroup, moveGraphNodes,
  removeGraphEdges, removeGraphGroups, removeGraphNodes, setGraphMode,
  updateGraphGroup, updateGraphNode, updateGraphNodeParams,
} from '../../engine/terrain/graph/GraphDocument.js';
import { getGraphNodeDefinition, listGraphNodeDefinitions } from '../../engine/terrain/graph/GraphRegistry.js';
import { resolveNearestEdge } from '../ui/toolsRailLayout.js';

const LAYOUT_KEY = 'pt-nodes-workspace-layout-v1';
const DEFAULT_LAYOUT = {
  graphEdge: 'bottom', graphRatio: 0.38,
  inspectorSide: 'right', inspectorWidth: 320,
  paletteCollapsed: false, paletteDetached: true, paletteSide: 'left', paletteWidth: 208,
  previewVisible: false,
};
const GRAPH_EDGES = ['bottom', 'left', 'top', 'right'];

function loadLayout() {
  try { return { ...DEFAULT_LAYOUT, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') }; }
  catch { return { ...DEFAULT_LAYOUT }; }
}
function saveLayout(layout) { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* preferences are best effort */ } }
function editingTarget(target) { return target?.matches?.('input, textarea, select, [contenteditable="true"]'); }

function NodePalette({
  detached = false, side = 'left', style, graphMode, definitions, paletteGroups,
  paletteQuery, onPaletteQuery, resultCount, onAdd, onCollapse, onDetach, onAttach, onMoveSide,
}) {
  return (
    <aside className={`node-quick-palette${detached ? ` detached detached-${side}` : ''}`} style={style} aria-label={`${graphMode === 'terrain' ? 'Terrain' : 'Noise'} nodes`}>
      <header>
        <span>{graphMode === 'terrain' ? 'Terrain nodes' : 'Noise nodes'}</span>
        <small>{definitions.length}</small>
        {detached ? (
          <>
            <button type="button" onClick={onMoveSide} title={`Move node list to the ${side === 'left' ? 'right' : 'left'} side`}>
              {side === 'left' ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>
            <button type="button" onClick={onAttach} title="Attach node list inside the graph"><Boxes size={13} /></button>
          </>
        ) : (
          <>
            <button type="button" onClick={onDetach} title="Detach node list to the sidebar"><Maximize2 size={13} /></button>
            <button type="button" onClick={onCollapse} title="Collapse node list"><ChevronLeft size={14} /></button>
          </>
        )}
      </header>
      <label className="node-palette-filter">
        <Search size={12} aria-hidden />
        <input value={paletteQuery} onChange={(event) => onPaletteQuery(event.target.value)} placeholder="Find a node…" aria-label={`Find ${graphMode} nodes`} />
        {paletteQuery ? <button type="button" onClick={() => onPaletteQuery('')} title="Clear node filter"><X size={11} /></button> : null}
      </label>
      <div className="node-palette-scroll">
        {[...paletteGroups].map(([category, items]) => (
          <section key={category}><h4>{category}</h4>{items.map((definition) => (
            <button key={definition.id} type="button" draggable title={`${definition.description} Click to add or drag onto the graph.`} onDragStart={(event) => { event.dataTransfer.setData('application/x-terrain-node', definition.id); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => onAdd(definition.id)}>
              <span className={`node-palette-dot tone-${definition.color || 'blue'}`} /><span>{definition.label}</span><Plus size={12} />
            </button>
          ))}</section>
        ))}
        {!resultCount ? <div className="node-palette-empty"><Search size={16} /><span>No nodes match “{paletteQuery}”</span></div> : null}
      </div>
      <footer><span>{resultCount} shown</span><span className="node-palette-footer-spacer" aria-hidden /> <kbd>Shift</kbd><span>+</span><kbd>A</kbd><span>all nodes</span></footer>
    </aside>
  );
}

function TerrainNode({ data, selected }) {
  const { node, invalid } = data;
  const definition = data.definition || { label: node.type, description: 'This node type is unavailable in this version.', color: 'amber', inputs: [], outputs: [] };
  return (
    <div className={`terrain-flow-node tone-${definition.color || 'blue'}${selected ? ' selected' : ''}${invalid ? ' invalid' : ''}`}>
      <div className="terrain-flow-node__header">
        <span className="terrain-flow-node__icon"><Boxes size={12} aria-hidden /></span>
        <span className="terrain-flow-node__title">{node.label}</span>
        {definition.permanent ? <span className="terrain-flow-node__output">OUT</span> : null}
      </div>
      <div className="terrain-flow-node__ports">
        <div className="terrain-flow-node__port-column inputs">
          {definition.inputs.map((port, index) => (
            <div className="terrain-flow-port input" key={port.id}>
              <Handle id={port.id} type="target" position={Position.Left} style={{ top: 41 + index * 24 }} />
              <span>{port.label}</span>
            </div>
          ))}
        </div>
        <div className="terrain-flow-node__port-column outputs">
          {definition.outputs.map((port, index) => (
            <div className="terrain-flow-port output" key={port.id}>
              <span>{port.label}</span>
              <Handle id={port.id} type="source" position={Position.Right} style={{ top: 41 + index * 24 }} />
            </div>
          ))}
        </div>
      </div>
      <div className="terrain-flow-node__summary">
        {node.type === 'currentTerrain'
          ? `${node.params?.stack?.layers?.filter((layer) => layer.enabled).length || 0} classic layers`
          : definition.description}
      </div>
    </div>
  );
}

function TerrainGroup({ data, selected }) {
  const { group } = data;
  return (
    <div className={`terrain-flow-group tone-${group.color || 'slate'}${selected ? ' selected' : ''}${group.collapsed ? ' collapsed' : ''}`}>
      <div className="terrain-flow-group__header">
        <ChevronDown size={12} className={group.collapsed ? 'collapsed' : ''} aria-hidden />
        <strong>{group.label}</strong>
        <span>{group.nodeIds.length} nodes</span>
        <button type="button" className="nodrag" onClick={(event) => { event.stopPropagation(); data.onToggle(group.id); }}>
          {group.collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>
    </div>
  );
}

const nodeTypes = { terrainNode: TerrainNode, terrainGroup: TerrainGroup };

function InspectorField({ field, value, onChange }) {
  if (field.type === 'boolean') {
    return (
      <label className="node-inspector-toggle">
        <span>{field.label}</span>
        <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked, !!field.structural)} />
      </label>
    );
  }
  if (field.type === 'enum') {
    return (
      <label className="node-inspector-field">
        <span>{field.label}</span>
        <select value={value} onChange={(event) => {
          const option = (field.options || []).find((item) => String(item.value) === event.target.value);
          onChange(option?.value ?? event.target.value, true);
        }}>
          {(field.options || []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
    );
  }
  const numeric = Number.isFinite(Number(value)) ? Number(value) : field.default;
  return (
    <label className="node-inspector-field">
      <span><span>{field.label}</span><output>{Number(numeric).toFixed(field.digits ?? (field.step >= 1 ? 0 : 2))}</output></span>
      <div className="node-inspector-number-row">
        <input type="range" min={field.min} max={field.max} step={field.step} value={numeric} onChange={(event) => onChange(Number(event.target.value), !!field.structural)} />
        <input type="number" min={field.min} max={field.max} step={field.step} value={numeric} onChange={(event) => onChange(Number(event.target.value), !!field.structural)} />
      </div>
    </label>
  );
}

function NodeInspector({
  node, group, graphState, onRename, onParam, onDelete, onGroupPatch, onUngroup, onHeaderPointerDown,
}) {
  const definition = node ? (getGraphNodeDefinition(node.type) || {
    label: `Unknown: ${node.type}`, description: 'This node type is unavailable in this version.', inspector: [], permanent: false,
  }) : null;
  const inspectorSections = definition?.inspector?.reduce((sections, field) => {
    const label = field.section || 'Parameters';
    const entry = sections.find((section) => section.label === label);
    if (entry) entry.fields.push(field); else sections.push({ label, fields: [field] });
    return sections;
  }, []) || [];
  const title = group ? 'Group' : definition?.label || 'Nothing selected';
  return (
    <aside className="node-inspector" aria-label="Selected node properties">
      <header className="node-dock-header node-inspector__header node-dock-header--draggable" onPointerDown={onHeaderPointerDown}>
        <div className="node-dock-heading">
          <span className="node-dock-kicker">Properties</span>
          <strong>{title}</strong>
        </div>
        <GripVertical className="node-dock-drag-cue" size={15} aria-hidden />
      </header>
      {group ? (
        <div className="node-inspector__body">
          <label className="node-inspector-field node-name-field">
            <span>Name</span>
            <input value={group.label} onChange={(event) => onGroupPatch({ label: event.target.value })} />
          </label>
          <p className="node-inspector-description">A visual frame for moving, collapsing, and organizing related terrain operations.</p>
          <div className="node-inspector-section">
            <h4>Organization</h4>
            <label className="node-inspector-field">
              <span>Frame color</span>
              <select value={group.color || 'slate'} onChange={(event) => onGroupPatch({ color: event.target.value })}>
                <option value="slate">Slate</option><option value="green">Green</option><option value="cyan">Cyan</option><option value="amber">Amber</option><option value="violet">Violet</option>
              </select>
            </label>
            <label className="node-inspector-toggle">
              <span>Collapsed</span>
              <input type="checkbox" checked={group.collapsed === true} onChange={(event) => onGroupPatch({ collapsed: event.target.checked })} />
            </label>
            <div className="node-group-summary"><strong>{group.nodeIds.length}</strong><span>nodes in this group</span></div>
          </div>
          <button type="button" className="node-danger-button node-ungroup-button" onClick={onUngroup}><Ungroup size={14} /> Remove group frame</button>
        </div>
      ) : node && definition ? (
        <div className="node-inspector__body">
          <label className="node-inspector-field node-name-field">
            <span>Name</span>
            <input value={node.label} onChange={(event) => onRename(event.target.value)} />
          </label>
          <p className="node-inspector-description">{definition.description}</p>
          {node.type === 'currentTerrain' ? (
            <div className="node-inspector-snapshot">
              <span>Compatibility snapshot</span>
              <strong>{node.params?.stack?.layers?.filter((layer) => layer.enabled).length || 0} active layers</strong>
              <small>Its Noise Stack is frozen so first entry preserves the current terrain.</small>
            </div>
          ) : null}
          {inspectorSections.map((section) => (
            <section className="node-inspector-section" key={section.label}>
              <h4>{section.label}</h4>
              {section.fields.map((field) => (
                <InspectorField key={field.key} field={field} value={node.params?.[field.key] ?? field.default} onChange={(value, structural) => onParam(field.key, value, structural)} />
              ))}
            </section>
          ))}
          {!definition.permanent ? (
            <button type="button" className="node-danger-button" onClick={onDelete}><Trash2 size={14} /> Delete node</button>
          ) : null}
        </div>
      ) : (
        <div className="node-inspector-empty">
          <Boxes size={26} />
          <strong>Select a node or group</strong>
          <span>Its settings will appear here.</span>
        </div>
      )}
      <footer className={`node-graph-health${graphState?.valid === false ? ' invalid' : ''}`}>
        {graphState?.valid === false ? <CircleAlert size={13} /> : <CheckCircle2 size={13} />}
        <span>{graphState?.valid === false ? graphState.diagnostics?.[0]?.message : `${graphState?.slotCount || 0} / 12 realtime slots`}</span>
      </footer>
    </aside>
  );
}

export default function NodeWorkspace({
  graph, graphView, graphState, onGraphChange, onGraphViewChange, onStartBlank,
  inspectorReplaced = false, onRequestInspector, preview = null, onPreviewVisibilityChange,
}) {
  const [localGraph, setLocalGraph] = useState(graph);
  const graphRef = useRef(graph);
  const [selectedNodes, setSelectedNodes] = useState(new Set());
  const [selectedGroups, setSelectedGroups] = useState(new Set());
  const [selectedEdges, setSelectedEdges] = useState(new Set());
  const [nodeMeasurements, setNodeMeasurements] = useState({});
  const [layout, setLayout] = useState(loadLayout);
  const [searchState, setSearchState] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [paletteQuery, setPaletteQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [instance, setInstance] = useState(null);
  const [draggingDock, setDraggingDock] = useState(null);
  const [snapHint, setSnapHint] = useState(null);
  const rootRef = useRef(null);
  const graphDockRef = useRef(null);
  const pointerRef = useRef({ x: window.innerWidth * 0.5, y: window.innerHeight * 0.65 });
  const copyRef = useRef([]);
  const dockDragRef = useRef(null);

  useEffect(() => { setLocalGraph(graph); graphRef.current = graph; }, [graph]);
  useEffect(() => { graphRef.current = localGraph; }, [localGraph]);
  useEffect(() => { saveLayout(layout); onPreviewVisibilityChange?.(layout.previewVisible); }, [layout, onPreviewVisibilityChange]);
  useEffect(() => {
    if (!instance) return undefined;
    const frame = requestAnimationFrame(() => instance.fitView({ padding: 0.2, maxZoom: 1, duration: 220 }));
    return () => cancelAnimationFrame(frame);
  }, [instance, layout.graphEdge, layout.inspectorSide, layout.paletteDetached, layout.paletteSide]);

  const commit = useCallback((next, meta = {}) => {
    graphRef.current = next; setLocalGraph(next); onGraphChange?.(next, meta);
  }, [onGraphChange]);

  const toggleGroup = useCallback((groupId) => {
    const group = (graphRef.current.groups || []).find((candidate) => candidate.id === groupId);
    if (!group) return;
    commit(updateGraphGroup(graphRef.current, groupId, { collapsed: !group.collapsed }), { structural: false, history: true });
  }, [commit]);

  const graphMode = localGraph.mode === 'noise' ? 'noise' : 'terrain';
  useEffect(() => { setPaletteQuery(''); }, [graphMode]);
  const definitions = useMemo(() => listGraphNodeDefinitions({ mode: graphMode }), [graphMode]);
  const grouped = useMemo(() => definitions.reduce((map, definition) => {
    const list = map.get(definition.category) || []; list.push(definition); map.set(definition.category, list); return map;
  }, new Map()), [definitions]);
  const paletteGroups = useMemo(() => {
    const query = paletteQuery.trim().toLowerCase();
    if (!query) return grouped;
    return new Map([...grouped].map(([category, items]) => [category, items.filter((definition) => (
      `${definition.label} ${definition.category} ${definition.description}`.toLowerCase().includes(query)
    ))]).filter(([, items]) => items.length));
  }, [grouped, paletteQuery]);
  const paletteResultCount = useMemo(() => [...paletteGroups.values()].reduce((total, items) => total + items.length, 0), [paletteGroups]);
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return definitions.filter((definition) => !query || `${definition.label} ${definition.category} ${definition.description}`.toLowerCase().includes(query));
  }, [definitions, searchQuery]);

  const invalidNodes = useMemo(() => new Set((graphState?.diagnostics || []).map((diagnostic) => diagnostic.nodeId).filter(Boolean)), [graphState]);
  const collapsedNodes = useMemo(() => new Set((localGraph.groups || [])
    .filter((group) => group.collapsed).flatMap((group) => group.nodeIds)), [localGraph.groups]);
  const flowNodes = useMemo(() => [
    ...(localGraph.groups || []).map((group) => ({
      id: group.id, type: 'terrainGroup', position: group.position,
      data: { group, onToggle: toggleGroup }, selected: selectedGroups.has(group.id), deletable: true,
      zIndex: group.collapsed ? 3 : 0,
      measured: { width: group.collapsed ? 240 : group.width, height: group.collapsed ? 42 : group.height },
      style: { width: group.collapsed ? 240 : group.width, height: group.collapsed ? 42 : group.height },
    })),
    ...localGraph.nodes.filter((node) => !collapsedNodes.has(node.id)).map((node) => ({
      id: node.id, type: 'terrainNode', position: node.position,
      measured: nodeMeasurements[node.id], zIndex: 2,
      data: { node, definition: getGraphNodeDefinition(node.type), invalid: invalidNodes.has(node.id) },
      selected: selectedNodes.has(node.id), deletable: node.type !== 'terrainOutput',
    })),
  ], [localGraph.groups, localGraph.nodes, selectedGroups, selectedNodes, invalidNodes, nodeMeasurements, collapsedNodes, toggleGroup]);
  const flowEdges = useMemo(() => localGraph.edges.filter((edge) => !collapsedNodes.has(edge.source) && !collapsedNodes.has(edge.target)).map((edge) => ({
    ...edge, type: 'default', data: { portType: edge.type }, selected: selectedEdges.has(edge.id), animated: false,
    className: `terrain-flow-edge edge-${getGraphNodeDefinition(localGraph.nodes.find((node) => node.id === edge.source)?.type)?.color || 'blue'}`,
  })), [localGraph.edges, localGraph.nodes, selectedEdges, collapsedNodes]);

  const addNodeAt = useCallback((type, position) => {
    const next = addGraphNode(graphRef.current, type, position);
    const added = next.nodes.at(-1);
    commit(next, { structural: true, history: true });
    setSelectedNodes(new Set([added.id]));
    setSelectedGroups(new Set());
    onRequestInspector?.();
    setSearchState(null); setSearchQuery(''); setSearchIndex(0);
  }, [commit, onRequestInspector]);

  const addNodeFromPalette = useCallback((type) => {
    const rect = graphDockRef.current?.getBoundingClientRect();
    const screenPosition = rect ? {
      x: Math.min(rect.right - 120, rect.left + Math.max(260, rect.width * 0.54)),
      y: Math.min(rect.bottom - 80, rect.top + Math.max(110, rect.height * 0.48)),
    } : pointerRef.current;
    addNodeAt(type, instance?.screenToFlowPosition(screenPosition) || { x: 180, y: 120 });
  }, [addNodeAt, instance]);

  const createGroupFromSelection = useCallback(() => {
    const nodes = graphRef.current.nodes.filter((node) => selectedNodes.has(node.id));
    if (!nodes.length) return;
    const bounds = nodes.reduce((box, node) => {
      const measured = nodeMeasurements[node.id] || { width: 176, height: 90 };
      return {
        minX: Math.min(box.minX, node.position.x), minY: Math.min(box.minY, node.position.y),
        maxX: Math.max(box.maxX, node.position.x + measured.width), maxY: Math.max(box.maxY, node.position.y + measured.height),
      };
    }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const result = groupGraphNodes(graphRef.current, nodes.map((node) => node.id), {
      label: 'Terrain section', position: { x: bounds.minX - 28, y: bounds.minY - 48 },
      width: bounds.maxX - bounds.minX + 56, height: bounds.maxY - bounds.minY + 76,
    });
    if (!result.groupId) return;
    commit(result.graph, { structural: false, history: true });
    setSelectedNodes(new Set()); setSelectedEdges(new Set()); setSelectedGroups(new Set([result.groupId]));
  }, [commit, nodeMeasurements, selectedNodes]);

  const ungroupSelection = useCallback((ids = [...selectedGroups]) => {
    if (!ids.length) return;
    commit(removeGraphGroups(graphRef.current, ids), { structural: false, history: true });
    setSelectedGroups(new Set());
  }, [commit, selectedGroups]);

  const deleteSelection = useCallback(() => {
    let next = removeGraphEdges(graphRef.current, selectedEdges);
    next = removeGraphGroups(next, selectedGroups);
    next = removeGraphNodes(next, selectedNodes);
    commit(next, { structural: true, history: true });
    setSelectedNodes(new Set()); setSelectedGroups(new Set()); setSelectedEdges(new Set());
  }, [commit, selectedEdges, selectedGroups, selectedNodes]);

  const duplicateSelection = useCallback((ids = [...selectedNodes]) => {
    const result = duplicateGraphSelection(graphRef.current, ids, { x: 36, y: 36 });
    if (!result.nodeIds.length) return;
    commit(result.graph, { structural: true, history: true });
    setSelectedNodes(new Set(result.nodeIds)); setSelectedGroups(new Set()); setSelectedEdges(new Set());
  }, [commit, selectedNodes]);

  const openSearch = useCallback(() => {
    const dockRect = graphDockRef.current?.getBoundingClientRect();
    const pointer = pointerRef.current;
    const point = instance?.screenToFlowPosition(pointer) || { x: 160, y: 120 };
    setSearchState({
      flowPosition: point,
      left: Math.max(12, Math.min((dockRect?.width || 500) - 292, pointer.x - (dockRect?.left || 0))),
      top: Math.max(46, Math.min((dockRect?.height || 400) - 330, pointer.y - (dockRect?.top || 0))),
    });
    setSearchQuery(''); setSearchIndex(0);
    requestAnimationFrame(() => document.querySelector('.node-search-popover input')?.focus());
  }, [instance]);

  useEffect(() => {
    const onKey = (event) => {
      if (!rootRef.current || editingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (event.shiftKey && key === 'a') { event.preventDefault(); openSearch(); return; }
      if (event.key === 'Escape') { setSearchState(null); return; }
      if (event.metaKey || event.ctrlKey) {
        if (key === 'c') { event.preventDefault(); copyRef.current = [...selectedNodes].filter((id) => id !== TERRAIN_OUTPUT_ID); }
        else if (key === 'v') { event.preventDefault(); duplicateSelection(copyRef.current); }
        else if (key === 'd') { event.preventDefault(); duplicateSelection(); }
        else if (key === 'a') { event.preventDefault(); setSelectedNodes(new Set(graphRef.current.nodes.map((node) => node.id))); setSelectedGroups(new Set()); }
        return;
      }
      if (key === 'g') { event.preventDefault(); if (event.shiftKey) ungroupSelection(); else createGroupFromSelection(); }
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); }
      else if (key === 'f') { event.preventDefault(); instance?.fitView({ padding: 0.18, duration: 280 }); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [createGroupFromSelection, deleteSelection, duplicateSelection, instance, openSearch, selectedNodes, ungroupSelection]);

  const updateLayout = useCallback((patch) => setLayout((current) => ({ ...current, ...patch })), []);
  const beginDockDrag = useCallback((kind, event) => {
    if (event.button !== 0 || event.target.closest('button, input, select, textarea, a')) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 821px)').matches) return;
    event.preventDefault();
    dockDragRef.current = { kind, startX: event.clientX, startY: event.clientY, armed: false };
  }, []);

  useEffect(() => {
    const move = (event) => {
      const drag = dockDragRef.current;
      const root = rootRef.current;
      if (!drag || !root) return;
      if (!drag.armed) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
        drag.armed = true;
        setDraggingDock(drag.kind);
      }
      const edges = drag.kind === 'graph' ? GRAPH_EDGES : ['left', 'right'];
      setSnapHint(resolveNearestEdge(event.clientX, event.clientY, root.getBoundingClientRect(), edges));
    };
    const finish = (event) => {
      const drag = dockDragRef.current;
      const root = rootRef.current;
      dockDragRef.current = null;
      setDraggingDock(null);
      setSnapHint(null);
      if (!drag?.armed || !root) return;
      const edges = drag.kind === 'graph' ? GRAPH_EDGES : ['left', 'right'];
      const edge = resolveNearestEdge(event.clientX ?? drag.startX, event.clientY ?? drag.startY, root.getBoundingClientRect(), edges);
      updateLayout(drag.kind === 'graph' ? { graphEdge: edge } : { inspectorSide: edge });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [updateLayout]);

  const beginGraphResize = (event) => {
    event.preventDefault();
    const rect = rootRef.current.getBoundingClientRect(); const edge = layout.graphEdge;
    const move = (pointer) => {
      const ratio = edge === 'bottom' ? (rect.bottom - pointer.clientY) / rect.height
        : edge === 'top' ? (pointer.clientY - rect.top) / rect.height
          : edge === 'left' ? (pointer.clientX - rect.left) / rect.width : (rect.right - pointer.clientX) / rect.width;
      updateLayout({ graphRatio: Math.max(0.25, Math.min(0.65, ratio)) });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true });
  };
  const beginInspectorResize = (event) => {
    event.preventDefault(); const rect = rootRef.current.getBoundingClientRect();
    const move = (pointer) => updateLayout({ inspectorWidth: Math.max(260, Math.min(460, layout.inspectorSide === 'right' ? rect.right - pointer.clientX : pointer.clientX - rect.left)) });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true });
  };

  const selectedGroup = (localGraph.groups || []).find((group) => selectedGroups.has(group.id)) || null;
  const selectedNode = selectedGroup ? null : localGraph.nodes.find((node) => selectedNodes.has(node.id)) || null;
  const inspectorOffset = inspectorReplaced ? 0 : layout.inspectorWidth;
  const paletteOffset = layout.paletteDetached ? layout.paletteWidth : 0;
  const sideOffset = (side) => (layout.paletteDetached && layout.paletteSide === side ? paletteOffset : 0)
    + (!inspectorReplaced && layout.inspectorSide === side ? inspectorOffset : 0);
  const dockStyle = layout.graphEdge === 'bottom' || layout.graphEdge === 'top'
    ? { [layout.graphEdge]: 0, left: sideOffset('left'), right: sideOffset('right'), height: `${layout.graphRatio * 100}%` }
    : { [layout.graphEdge]: sideOffset(layout.graphEdge), top: 0, bottom: 0, width: `${layout.graphRatio * 100}%` };

  const palette = (
    <NodePalette
      detached={layout.paletteDetached} side={layout.paletteSide}
      graphMode={graphMode} definitions={definitions} paletteGroups={paletteGroups}
      paletteQuery={paletteQuery} onPaletteQuery={setPaletteQuery} resultCount={paletteResultCount}
      onAdd={addNodeFromPalette}
      onCollapse={() => updateLayout({ paletteCollapsed: true })}
      onDetach={() => updateLayout({ paletteDetached: true, paletteCollapsed: false })}
      onAttach={() => updateLayout({ paletteDetached: false, paletteCollapsed: false })}
      onMoveSide={() => updateLayout({ paletteSide: layout.paletteSide === 'left' ? 'right' : 'left' })}
    />
  );

  return (
    <section ref={rootRef} className={`nodes-workspace graph-edge-${layout.graphEdge} inspector-${layout.inspectorSide}${inspectorReplaced ? ' inspector-replaced' : ''}`} aria-label="Terrain Nodes workspace">
      {draggingDock ? (
        <div className={`panel-snap-layer node-panel-snap-layer${draggingDock === 'inspector' ? ' panel-snap-layer--drawer' : ''}`} aria-hidden>
          {(draggingDock === 'graph' ? GRAPH_EDGES : ['left', 'right']).map((edge) => <div key={edge} className={`panel-snap-zone panel-snap-zone--${edge}${snapHint === edge ? ' active' : ''}`} />)}
        </div>
      ) : null}
      {layout.previewVisible ? <div className={`nodes-map-preview inspector-${layout.inspectorSide}`} style={{ [layout.inspectorSide]: sideOffset(layout.inspectorSide) + 14 }}>{preview}</div> : null}
      {layout.paletteDetached ? React.cloneElement(palette, { style: { [layout.paletteSide]: 0, width: layout.paletteWidth } }) : null}
      <div ref={graphDockRef} className="node-graph-dock" style={dockStyle} onPointerMove={(event) => { pointerRef.current = { x: event.clientX, y: event.clientY }; }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={(event) => {
        event.preventDefault(); const type = event.dataTransfer.getData('application/x-terrain-node'); if (!type || !instance) return;
        addNodeAt(type, instance.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
      }}>
        <div className="node-graph-resizer" onPointerDown={beginGraphResize}><GripVertical size={14} /></div>
        <header className="node-dock-header node-graph-toolbar node-dock-header--draggable" onPointerDown={(event) => beginDockDrag('graph', event)}>
          <div className="node-dock-heading"><span className="node-dock-kicker">Nodes</span><strong>{graphMode === 'terrain' ? 'Terrain Graph' : 'Procedural Noise'}</strong></div>
          <div className="node-mode-switch" role="tablist" aria-label="Node editor sub-mode">
            <button type="button" role="tab" aria-selected={graphMode === 'noise'} className={graphMode === 'noise' ? 'active' : ''} onClick={() => commit(setGraphMode(graphRef.current, 'noise'), { structural: false, history: true })}>Noise</button>
            <button type="button" role="tab" aria-selected={graphMode === 'terrain'} className={graphMode === 'terrain' ? 'active' : ''} onClick={() => commit(setGraphMode(graphRef.current, 'terrain'), { structural: false, history: true })}>Terrain</button>
          </div>
          <div className="node-graph-status">
            {graphState?.valid === false ? <><CircleAlert size={13} /><span>Last valid terrain</span></> : <><Play size={12} /><span>Realtime</span></>}
          </div>
          <div className="node-toolbar-actions">
            <button type="button" className="node-toolbar-button" onClick={openSearch}><Plus size={14} /> Add</button>
            <button type="button" className="node-toolbar-button" onClick={createGroupFromSelection} disabled={!selectedNodes.size} title="Group selected nodes (G)"><FolderPlus size={13} /> Group</button>
            <button type="button" className="node-icon-button" onClick={() => ungroupSelection()} disabled={!selectedGroups.size} title="Remove selected group frame (Shift+G)"><Ungroup size={13} /></button>
            <button type="button" className="node-icon-button" onClick={() => instance?.fitView({ padding: 0.18, maxZoom: 1, duration: 280 })} title="Fit graph"><Maximize2 size={14} /></button>
            <button type="button" className={`node-icon-button${layout.previewVisible ? ' active' : ''}`} onClick={() => updateLayout({ previewVisible: !layout.previewVisible })} title="Toggle 2D preview">{layout.previewVisible ? <Eye size={14} /> : <EyeOff size={14} />}</button>
            <button type="button" className="node-toolbar-button subtle" onClick={() => onStartBlank?.(graphMode)}>Clear graph</button>
          </div>
        </header>

        {!layout.paletteDetached && !layout.paletteCollapsed ? palette : null}
        {!layout.paletteDetached && layout.paletteCollapsed ? <button type="button" className="node-palette-expand" onClick={() => updateLayout({ paletteCollapsed: false })} title="Show quick nodes"><ChevronRight size={15} /></button> : null}

        <div className="node-flow-frame">
        <ReactFlow
          key={[...(localGraph.groups || []), ...localGraph.nodes].map((item) => item.id).sort().join('|')}
          nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} onInit={setInstance}
          defaultViewport={graphView || { x: 0, y: 0, zoom: 1 }} minZoom={0.18} maxZoom={2.2}
          snapToGrid snapGrid={[12, 12]} connectionRadius={30} selectionOnDrag panOnDrag={[1, 2]}
          elevateNodesOnSelect={false}
          deleteKeyCode={null} multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
          onMoveEnd={(_, viewport) => onGraphViewChange?.(viewport)}
          onNodeClick={() => onRequestInspector?.()}
          onSelectionChange={({ nodes, edges }) => {
            setSelectedNodes(new Set(nodes.filter((node) => node.type === 'terrainNode').map((node) => node.id)));
            setSelectedGroups(new Set(nodes.filter((node) => node.type === 'terrainGroup').map((node) => node.id)));
            setSelectedEdges(new Set(edges.map((edge) => edge.id)));
          }}
          onNodesChange={(changes) => {
            const selections = changes.filter((change) => change.type === 'select');
            const groupIds = new Set((graphRef.current.groups || []).map((group) => group.id));
            if (selections.length) {
              setSelectedNodes((current) => {
                const next = new Set(current);
                for (const change of selections.filter((item) => !groupIds.has(item.id))) { if (change.selected) next.add(change.id); else next.delete(change.id); }
                return next;
              });
              setSelectedGroups((current) => {
                const next = new Set(current);
                for (const change of selections.filter((item) => groupIds.has(item.id))) { if (change.selected) next.add(change.id); else next.delete(change.id); }
                return next;
              });
            }
            const positionChanges = changes.filter((change) => change.type === 'position' && change.position);
            if (positionChanges.length) setLocalGraph((current) => {
              let next = current; const positions = {};
              for (const change of positionChanges) {
                if (groupIds.has(change.id)) next = moveGraphGroup(next, change.id, change.position);
                else positions[change.id] = change.position;
              }
              if (Object.keys(positions).length) next = moveGraphNodes(next, positions);
              graphRef.current = next; return next;
            });
            const dimensions = changes.filter((change) => change.type === 'dimensions' && change.dimensions && !groupIds.has(change.id));
            if (dimensions.length) setNodeMeasurements((current) => {
              const next = { ...current }; let changed = false;
              for (const change of dimensions) {
                const previous = next[change.id];
                if (previous?.width !== change.dimensions.width || previous?.height !== change.dimensions.height) {
                  next[change.id] = change.dimensions; changed = true;
                }
              }
              return changed ? next : current;
            });
          }}
          onNodeDragStop={() => commit(graphRef.current, { structural: false, history: true })}
          onEdgesChange={(changes) => {
            const selections = changes.filter((change) => change.type === 'select');
            if (selections.length) setSelectedEdges((current) => {
              const next = new Set(current);
              for (const change of selections) {
                if (change.selected) next.add(change.id); else next.delete(change.id);
              }
              return next;
            });
            const removed = changes.filter((change) => change.type === 'remove').map((change) => change.id);
            if (removed.length) commit(removeGraphEdges(graphRef.current, removed), { structural: true, history: true });
          }}
          onConnect={(connection) => {
            try { commit(connectGraphNodes(graphRef.current, connection), { structural: true, history: true }); }
            catch (error) { graphState?.onDiagnostic?.(error.message); }
          }}
          colorMode="dark" proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Lines} gap={24} size={0.7} color="rgba(255, 255, 255, .075)" />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
        </div>

        {searchState ? (
          <div className="node-search-popover" style={{ left: searchState.left, top: searchState.top }}>
            <div className="node-search-input"><Search size={15} /><input value={searchQuery} placeholder="Search terrain nodes…" onChange={(event) => { setSearchQuery(event.target.value); setSearchIndex(0); }} onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setSearchIndex((index) => Math.min(searchResults.length - 1, index + 1)); }
              else if (event.key === 'ArrowUp') { event.preventDefault(); setSearchIndex((index) => Math.max(0, index - 1)); }
              else if (event.key === 'Enter' && searchResults[searchIndex]) { event.preventDefault(); addNodeAt(searchResults[searchIndex].id, searchState.flowPosition); }
              else if (event.key === 'Escape') setSearchState(null);
            }} /><button type="button" onClick={() => setSearchState(null)}><X size={14} /></button></div>
            <div className="node-search-results">
              {searchResults.map((definition, index) => (
                <button key={definition.id} type="button" className={searchIndex === index ? 'active' : ''} onMouseEnter={() => setSearchIndex(index)} onClick={() => addNodeAt(definition.id, searchState.flowPosition)}>
                  <span className={`node-search-icon tone-${definition.color || 'blue'}`}><Boxes size={13} /></span>
                  <span><strong>{definition.label}</strong><small>{definition.category}</small></span><span>{definition.description}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {!inspectorReplaced ? (
        <div className="node-inspector-dock" style={{ [layout.inspectorSide]: layout.paletteDetached && layout.paletteSide === layout.inspectorSide ? paletteOffset : 0, width: layout.inspectorWidth }}>
          <div className="node-inspector-resizer" onPointerDown={beginInspectorResize} />
          <NodeInspector
            node={selectedNode} group={selectedGroup} graphState={graphState}
            onHeaderPointerDown={(event) => beginDockDrag('inspector', event)}
            onRename={(label) => commit(updateGraphNode(graphRef.current, selectedNode.id, { label }), { structural: false, history: true })}
            onParam={(key, value, structural) => commit(updateGraphNodeParams(graphRef.current, selectedNode.id, { [key]: value }), { structural, history: true })}
            onDelete={() => { const next = removeGraphNodes(graphRef.current, [selectedNode.id]); commit(next, { structural: true, history: true }); setSelectedNodes(new Set()); }}
            onGroupPatch={(patch) => commit(updateGraphGroup(graphRef.current, selectedGroup.id, patch), { structural: false, history: true })}
            onUngroup={() => ungroupSelection([selectedGroup.id])}
          />
        </div>
      ) : null}
    </section>
  );
}

export { createBlankGraph };
