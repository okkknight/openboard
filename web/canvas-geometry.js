const round = (value) => Math.round(value * 100) / 100;
const copyEntries = (entries) => new Map([...entries].map(([key, layout]) => [key, { ...layout }]));

export function screenDeltaToCanvas(delta, zoom) {
  if (!Number.isFinite(zoom) || zoom <= 0) throw new Error('invalid_zoom');
  return { x: delta.x / zoom, y: delta.y / zoom };
}

export function boundsForLayouts(entries) {
  const layouts = [...entries].map(([, layout]) => layout);
  if (!layouts.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...layouts.map((layout) => layout.x));
  const y = Math.min(...layouts.map((layout) => layout.y));
  const right = Math.max(...layouts.map((layout) => layout.x + layout.w));
  const bottom = Math.max(...layouts.map((layout) => layout.y + layout.h));
  return { x, y, w: right - x, h: bottom - y };
}

export function moveLayouts(entries, delta) {
  return new Map([...entries].map(([key, layout]) => [key, {
    ...layout, x: round(layout.x + delta.x), y: round(layout.y + delta.y)
  }]));
}

function resizedBounds(bounds, handle, delta, modifiers) {
  let left = bounds.x;
  let right = bounds.x + bounds.w;
  let top = bounds.y;
  let bottom = bounds.y + bounds.h;
  if (handle.includes('e')) { right += delta.x; if (modifiers.altKey) left -= delta.x; }
  if (handle.includes('w')) { left += delta.x; if (modifiers.altKey) right -= delta.x; }
  if (handle.includes('s')) { bottom += delta.y; if (modifiers.altKey) top -= delta.y; }
  if (handle.includes('n')) { top += delta.y; if (modifiers.altKey) bottom -= delta.y; }

  let width = right - left;
  let height = bottom - top;
  if (modifiers.shiftKey && /[ns]/.test(handle) && /[ew]/.test(handle)) {
    const ratio = bounds.w / bounds.h;
    const widthChange = Math.abs(width / bounds.w - 1);
    const heightChange = Math.abs(height / bounds.h - 1);
    if (widthChange >= heightChange) height = width / ratio;
    else width = height * ratio;
    if (modifiers.altKey) {
      const centerX = bounds.x + bounds.w / 2;
      const centerY = bounds.y + bounds.h / 2;
      left = centerX - width / 2;
      top = centerY - height / 2;
    } else {
      if (handle.includes('w')) left = right - width;
      else right = left + width;
      if (handle.includes('n')) top = bottom - height;
      else bottom = top + height;
    }
  }
  return { x: left, y: top, w: width, h: height };
}

function clampBounds(candidate, original, handle, modifiers, minWidth, minHeight) {
  const width = Math.max(candidate.w, minWidth);
  const height = Math.max(candidate.h, minHeight);
  let x = candidate.x;
  let y = candidate.y;
  if (width !== candidate.w) {
    if (modifiers.altKey) x = original.x + original.w / 2 - width / 2;
    else if (handle.includes('w')) x = original.x + original.w - width;
  }
  if (height !== candidate.h) {
    if (modifiers.altKey) y = original.y + original.h / 2 - height / 2;
    else if (handle.includes('n')) y = original.y + original.h - height;
  }
  return { x, y, w: width, h: height };
}

export function resizeLayouts(entries, groupBounds, handle, delta, modifiers = {}, minimumFor = () => ({ w: 1, h: 1 })) {
  const source = [...entries];
  if (!source.length || !groupBounds.w || !groupBounds.h) return new Map();
  let minGroupWidth = 1;
  let minGroupHeight = 1;
  for (const [key, layout] of source) {
    const minimum = minimumFor(key, layout);
    minGroupWidth = Math.max(minGroupWidth, minimum.w * groupBounds.w / layout.w);
    minGroupHeight = Math.max(minGroupHeight, minimum.h * groupBounds.h / layout.h);
  }
  const nextBounds = clampBounds(resizedBounds(groupBounds, handle, delta, modifiers), groupBounds, handle, modifiers, minGroupWidth, minGroupHeight);
  const scaleX = nextBounds.w / groupBounds.w;
  const scaleY = nextBounds.h / groupBounds.h;
  return new Map(source.map(([key, layout]) => [key, {
    x: round(nextBounds.x + (layout.x - groupBounds.x) * scaleX),
    y: round(nextBounds.y + (layout.y - groupBounds.y) * scaleY),
    w: round(layout.w * scaleX),
    h: round(layout.h * scaleY)
  }]));
}

const axisPoints = (layout, axis) => axis === 'x'
  ? [{ value: layout.x, role: 'edge' }, { value: layout.x + layout.w / 2, role: 'center' }, { value: layout.x + layout.w, role: 'edge' }]
  : [{ value: layout.y, role: 'edge' }, { value: layout.y + layout.h / 2, role: 'center' }, { value: layout.y + layout.h, role: 'edge' }];

function closest(candidates, threshold) {
  return candidates
    .filter((candidate) => Math.abs(candidate.delta) <= threshold)
    .sort((left, right) => Math.abs(left.delta) - Math.abs(right.delta))[0];
}

function objectCandidate(bounds, stationary, axis, threshold) {
  const movingPoints = axisPoints(bounds, axis);
  const candidates = [];
  for (const [key, layout] of stationary) for (const fixed of axisPoints(layout, axis)) for (const moving of movingPoints) {
    candidates.push({ delta: fixed.value - moving.value, kind: moving.role === 'center' && fixed.role === 'center' ? 'center' : 'edge', value: fixed.value, refs: [key] });
  }
  return closest(candidates, threshold);
}

function gapCandidate(bounds, stationary, axis, threshold) {
  const intervals = [...stationary].map(([key, layout]) => axis === 'x'
    ? { key, start: layout.x, end: layout.x + layout.w }
    : { key, start: layout.y, end: layout.y + layout.h }).sort((a, b) => a.start - b.start);
  const size = axis === 'x' ? bounds.w : bounds.h;
  const start = axis === 'x' ? bounds.x : bounds.y;
  const candidates = [];
  for (let index = 0; index < intervals.length - 1; index += 1) {
    const before = intervals[index];
    const after = intervals[index + 1];
    const desired = before.end + (after.start - before.end - size) / 2;
    if (desired >= before.end && desired + size <= after.start) candidates.push({ delta: desired - start, kind: 'gap', value: desired, refs: [before.key, after.key] });
  }
  return closest(candidates, threshold);
}

function gridCandidate(bounds, axis, grid, threshold) {
  if (!grid) return undefined;
  const value = axis === 'x' ? bounds.x : bounds.y;
  const target = Math.round(value / grid) * grid;
  return closest([{ delta: target - value, kind: 'grid', value: target, refs: [] }], threshold);
}

export function snapLayouts(preview, stationary, { zoom = 1, grid = 8, disabled = false } = {}) {
  const layouts = copyEntries(preview);
  if (disabled || !layouts.size) return { layouts, guides: [] };
  const bounds = boundsForLayouts(layouts);
  const threshold = 6 / zoom;
  const guides = [];
  const delta = { x: 0, y: 0 };
  for (const axis of ['x', 'y']) {
    const candidate = objectCandidate(bounds, stationary, axis, threshold)
      ?? gapCandidate(bounds, stationary, axis, threshold)
      ?? gridCandidate(bounds, axis, grid, threshold);
    if (!candidate) continue;
    delta[axis] = candidate.delta;
    guides.push({ axis, value: candidate.value, kind: candidate.kind, refs: candidate.refs });
  }
  return { layouts: moveLayouts(layouts, delta), guides };
}
