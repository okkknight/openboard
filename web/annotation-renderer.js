const VARIANTS = new Set(['caption', 'body', 'insight', 'callout']);
const ALIGNS = new Set(['start', 'center', 'end']);
const COLORS = new Set(['default', 'muted', 'accent', 'warning']);

export function fallbackAnnotationLayout(annotation, visuals, index = 0) {
  if (annotation.layout) return { ...annotation.layout };
  if (annotation.anchor) return { x: annotation.anchor.x, y: annotation.anchor.y, w: 280, h: 120 };
  const target = annotation.target ? visuals[annotation.target] : undefined;
  if (target) return { x: target.x + target.w + 24, y: target.y, w: 280, h: 120 };
  return { x: 48, y: 96 + index * 144, w: 320, h: 120 };
}

export function connectorGeometry(annotation, target) {
  const annotationCenter = { x: annotation.x + annotation.w / 2, y: annotation.y + annotation.h / 2 };
  const targetCenter = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
  const horizontal = Math.abs(annotationCenter.x - targetCenter.x) >= Math.abs(annotationCenter.y - targetCenter.y);
  if (horizontal) {
    const annotationOnRight = annotationCenter.x >= targetCenter.x;
    return {
      from: { x: annotationOnRight ? annotation.x : annotation.x + annotation.w, y: annotationCenter.y },
      to: { x: annotationOnRight ? target.x + target.w : target.x, y: Math.max(target.y, Math.min(target.y + target.h, annotationCenter.y)) }
    };
  }
  const annotationBelow = annotationCenter.y >= targetCenter.y;
  return {
    from: { x: annotationCenter.x, y: annotationBelow ? annotation.y : annotation.y + annotation.h },
    to: { x: Math.max(target.x, Math.min(target.x + target.w, annotationCenter.x)), y: annotationBelow ? target.y + target.h : target.y }
  };
}

export function semanticAnnotationClass(style = {}) {
  const variant = VARIANTS.has(style.variant) ? style.variant : 'body';
  const align = ALIGNS.has(style.align) ? style.align : 'start';
  const color = COLORS.has(style.color_role) ? style.color_role : 'default';
  return `annotation-${variant} align-${align} color-${color}`;
}

export function renderAnnotationContent(element, annotation) {
  element.className = `annotation-text ${semanticAnnotationClass(annotation.style)}`;
  element.textContent = annotation.text;
}

export function renderConnectors(layer, annotations, visuals, layoutFor) {
  const namespace = 'http://www.w3.org/2000/svg';
  const lines = [];
  for (const annotation of Object.values(annotations)) {
    const target = annotation.target && visuals[annotation.target];
    if (!target) continue;
    const annotationLayout = layoutFor('annotation', annotation.id);
    if (!annotationLayout) continue;
    const points = connectorGeometry(annotationLayout, target.layout);
    const line = document.createElementNS(namespace, 'line');
    line.dataset.annotationId = annotation.id;
    line.setAttribute('x1', String(points.from.x)); line.setAttribute('y1', String(points.from.y));
    line.setAttribute('x2', String(points.to.x)); line.setAttribute('y2', String(points.to.y));
    lines.push(line);
  }
  layer.replaceChildren(...lines);
}
