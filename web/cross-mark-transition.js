function family(markType) {
  if (['barX', 'barY', 'rect', 'cell', 'box'].includes(markType)) return 'bar';
  if (['dot', 'circle'].includes(markType)) return 'dot';
  if (markType === 'arc') return 'arc';
  if (['lineX', 'lineY'].includes(markType)) return 'line';
  if (['areaX', 'areaY', 'area'].includes(markType)) return 'area';
  return 'other';
}

export function crossMarkTransition(from, to) {
  const pair = [family(from), family(to)].sort().join('-');
  if (pair === 'bar-dot') return { kind: 'bar-dot', exit: 'collapse', enter: 'expand' };
  if (pair === 'arc-bar') return { kind: 'bar-arc', exit: 'collapse', enter: 'sweep' };
  if (pair === 'bar-line') return { kind: 'bar-line', exit: 'collapse', enter: 'draw' };
  return { kind: 'fallback', exit: 'fade', enter: 'fade' };
}
