import { boundsForLayouts, moveLayouts, resizeLayouts, screenDeltaToCanvas, snapLayouts } from './canvas-geometry.js';

const cloneMap = (map) => new Map([...map].map(([key, value]) => [key, { ...value }]));
const objectRef = (key) => {
  const separator = key.indexOf(':');
  return { kind: key.slice(0, separator), id: key.slice(separator + 1) };
};
const equalLayout = (a, b) => a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const rectangle = (start, end) => ({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) });
const intersects = (a, b) => a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
const DRAG_THRESHOLD_PX = 3;

export function createInteractionController(options = {}) {
  const callbacks = {
    getRevision: options.getRevision ?? (() => 0),
    getLayouts: options.getLayouts ?? (() => new Map()),
    getStationaryLayouts: options.getStationaryLayouts ?? (() => new Map()),
    minimumFor: options.minimumFor ?? (() => ({ w: 1, h: 1 })),
    onPreview: options.onPreview ?? (() => {}),
    onCommit: options.onCommit ?? (() => {}),
    onRollback: options.onRollback ?? (() => {}),
    onSelectionChange: options.onSelectionChange ?? (() => {}),
    onMarquee: options.onMarquee ?? (() => {}),
    onPan: options.onPan ?? (() => {})
  };
  const state = { phase: 'idle', selection: [], gesture: null, editing: null };

  const notifySelection = () => callbacks.onSelectionChange(state.selection.map(objectRef));
  const requireIdle = () => { if (state.phase !== 'idle') throw new Error(`interaction_busy: ${state.phase}`); };
  const selectedLayouts = () => callbacks.getLayouts([...state.selection]);
  const begin = (phase, pointer, settings = {}) => {
    requireIdle();
    if (!state.selection.length && phase !== 'marquee' && phase !== 'panning') throw new Error('empty_selection');
    const original = phase === 'marquee' || phase === 'panning' ? new Map() : selectedLayouts();
    state.phase = phase;
    state.gesture = {
      pointerId: settings.pointerId,
      origin: { ...pointer }, current: { ...pointer }, zoom: settings.zoom ?? 1,
      baseRevision: callbacks.getRevision(), original, preview: cloneMap(original),
      handle: settings.handle, additive: Boolean(settings.additive), initialSelection: [...state.selection], activated: false
    };
  };
  const previewChanged = (gesture) => [...gesture.preview].some(([key, layout]) => !equalLayout(layout, gesture.original.get(key)));
  const finishLayout = () => {
    const gesture = state.gesture;
    if (gesture && previewChanged(gesture)) callbacks.onCommit({
      action: state.phase === 'resizing' ? 'resize' : 'move', baseRevision: gesture.baseRevision,
      originalLayouts: cloneMap(gesture.original),
      layoutUpdates: [...gesture.preview].map(([key, layout]) => ({ target: objectRef(key), layout: { ...layout } }))
    });
    state.phase = 'idle'; state.gesture = null;
  };

  return {
    select(ref, { additive = false, preserveIfSelected = false } = {}) {
      requireIdle();
      const key = `${ref.kind}:${ref.id}`;
      if (!additive && preserveIfSelected && state.selection.includes(key)) return;
      if (!additive) state.selection = [key];
      else if (state.selection.includes(key)) state.selection = state.selection.filter((item) => item !== key);
      else state.selection = [...state.selection, key];
      notifySelection();
    },
    clearSelection() { if (state.phase !== 'idle') return; state.selection = []; notifySelection(); },
    beginMove(pointer, settings = {}) { begin('moving', pointer, settings); },
    beginResize(handle, pointer, settings = {}) { begin('resizing', pointer, { ...settings, handle }); },
    beginMarquee(pointer, settings = {}) { begin('marquee', pointer, settings); callbacks.onMarquee(rectangle(pointer, pointer)); },
    beginPan(pointer, settings = {}) { begin('panning', pointer, settings); },
    updatePointer(pointer, settings = {}) {
      const gesture = state.gesture;
      if (!gesture) return;
      if (settings.pointerId !== undefined && gesture.pointerId !== undefined && settings.pointerId !== gesture.pointerId) return;
      gesture.current = { ...pointer };
      if (state.phase === 'marquee') { callbacks.onMarquee(rectangle(gesture.origin, pointer)); return; }
      const screenDelta = { x: pointer.x - gesture.origin.x, y: pointer.y - gesture.origin.y };
      if (state.phase === 'panning') { callbacks.onPan(screenDelta); return; }
      if (!gesture.activated && Math.hypot(screenDelta.x, screenDelta.y) < DRAG_THRESHOLD_PX) return;
      gesture.activated = true;
      const delta = screenDeltaToCanvas(screenDelta, gesture.zoom);
      const transformed = state.phase === 'resizing'
        ? resizeLayouts(gesture.original, boundsForLayouts(gesture.original), gesture.handle, delta, settings, callbacks.minimumFor)
        : moveLayouts(gesture.original, delta);
      const snapped = snapLayouts(transformed, callbacks.getStationaryLayouts(state.selection), { zoom: gesture.zoom, disabled: Boolean(settings.controlKey) });
      gesture.preview = snapped.layouts;
      callbacks.onPreview(cloneMap(gesture.preview), snapped.guides);
    },
    finishPointer(settings = {}) {
      if (!state.gesture) return;
      if (settings.pointerId !== undefined && state.gesture.pointerId !== undefined && settings.pointerId !== state.gesture.pointerId) return;
      if (state.phase === 'moving' || state.phase === 'resizing') finishLayout();
      else if (state.phase === 'panning') { state.phase = 'idle'; state.gesture = null; }
    },
    finishMarquee(objects) {
      if (state.phase !== 'marquee' || !state.gesture) return;
      const box = rectangle(state.gesture.origin, state.gesture.current);
      const hits = objects.filter(([, layout]) => intersects(box, layout)).map(([key]) => key);
      state.selection = state.gesture.additive ? [...new Set([...state.gesture.initialSelection, ...hits])] : hits;
      state.phase = 'idle'; state.gesture = null; callbacks.onMarquee(null); notifySelection();
    },
    cancel(message = 'Cancelled') {
      if (state.phase === 'idle') { state.selection = []; notifySelection(); return; }
      if (state.phase === 'editing') { state.phase = 'idle'; state.editing = null; return; }
      if (state.gesture?.original?.size) callbacks.onRollback(cloneMap(state.gesture.original), message);
      state.phase = 'idle'; state.gesture = null; callbacks.onMarquee(null);
    },
    nudge(delta) {
      if (state.phase === 'idle') begin('moving', { x: 0, y: 0 }, { zoom: 1 });
      if (state.phase !== 'moving') throw new Error(`interaction_busy: ${state.phase}`);
      const current = state.gesture.preview;
      state.gesture.preview = moveLayouts(current, delta);
      callbacks.onPreview(cloneMap(state.gesture.preview), []);
    },
    finishNudge() { if (state.phase === 'moving') finishLayout(); },
    removeMissing(existingKeys) {
      const existing = new Set(existingKeys);
      const next = state.selection.filter((key) => existing.has(key));
      if (next.length !== state.selection.length) { state.selection = next; notifySelection(); }
    },
    enterEditing(key) { requireIdle(); state.phase = 'editing'; state.editing = key; },
    leaveEditing() { if (state.phase === 'editing') { state.phase = 'idle'; state.editing = null; } },
    getState() { return { phase: state.phase, selection: [...state.selection], editing: state.editing, gesture: state.gesture ? { pointerId: state.gesture.pointerId, baseRevision: state.gesture.baseRevision } : null }; }
  };
}
