const FAMILY = new Map([
  ['barX', 'bar'], ['barY', 'bar'], ['rect', 'bar'], ['cell', 'bar'], ['box', 'bar'],
  ['dot', 'dot'], ['circle', 'dot'], ['ruleX', 'rule'], ['ruleY', 'rule'], ['line', 'rule'],
  ['text', 'text'], ['arc', 'arc'], ['lineX', 'line'], ['lineY', 'line'], ['areaX', 'area'], ['areaY', 'area'], ['area', 'area']
]);

const NUMERIC_ATTRIBUTES = ['x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'x1', 'x2', 'y1', 'y2', 'rx', 'ry', 'stroke-width'];

export function motionStrategy(operation, markType) {
  const family = FAMILY.get(markType) ?? 'fallback';
  const action = {
    bar: { enter: 'baseline-enter', update: 'geometry-update', exit: 'baseline-exit' },
    dot: { enter: 'scale-enter', update: 'geometry-update', exit: 'scale-exit' },
    rule: { enter: 'draw-enter', update: 'geometry-update', exit: 'retract-exit' },
    text: { enter: 'translate-fade-enter', update: 'geometry-update', exit: 'fade-exit' },
    arc: { enter: 'sweep-enter', update: 'geometry-update', exit: 'collapse-exit' },
    line: { enter: 'draw-enter', update: 'safe-path-or-fade', exit: 'erase-exit' },
    area: { enter: 'baseline-enter', update: 'safe-path-or-fade', exit: 'collapse-exit' },
    fallback: { enter: 'fade-enter', update: 'fade-update', exit: 'fade-exit' }
  }[family][operation];
  return { family, action };
}

export function motionFrames(operation, markType, preservesSvgTransform = false) {
  const strategy = motionStrategy(operation, markType);
  if (preservesSvgTransform) return operation === 'enter' ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }];
  return operation === 'enter'
    ? [{ opacity: 0, transform: strategy.family === 'dot' ? 'scale(0)' : 'translateY(5px)' }, { opacity: 1, transform: 'none' }]
    : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: strategy.family === 'dot' ? 'scale(0)' : 'translateY(-4px)' }];
}

export function captureGeometry(element) {
  return Object.fromEntries(NUMERIC_ATTRIBUTES.map((name) => [name, element.getAttribute(name)]).filter(([, value]) => value !== null));
}

function waitForAnimation(element, keyframes, options, current, register) {
  if (!element.animate || !current()) return Promise.resolve();
  const animation = element.animate(keyframes, options);
  register?.(animation);
  return new Promise((resolve) => {
    animation.onfinish = resolve;
    animation.oncancel = resolve;
  });
}

function tweenGeometry(element, from, current) {
  const target = captureGeometry(element);
  const pairs = Object.entries(target)
    .map(([name, value]) => [name, Number(from[name]), Number(value)])
    .filter(([, oldValue, newValue]) => Number.isFinite(oldValue) && Number.isFinite(newValue) && oldValue !== newValue);
  if (!pairs.length || !current()) return Promise.resolve();
  for (const [name, oldValue] of pairs) element.setAttribute(name, String(oldValue));
  return new Promise((resolve) => {
    const started = performance.now();
    const frame = (now) => {
      if (!current()) return resolve();
      const progress = Math.min(1, (now - started) / 220);
      const eased = 1 - Math.pow(1 - progress, 3);
      for (const [name, oldValue, newValue] of pairs) element.setAttribute(name, String(oldValue + (newValue - oldValue) * eased));
      if (progress < 1) requestAnimationFrame(frame); else resolve();
    };
    requestAnimationFrame(frame);
  });
}

export function createRenderMotion({ reduced = () => false } = {}) {
  const latest = new Map();
  const animations = new Map();
  const current = (visualId, generation) => latest.get(visualId) === generation;
  const key = (visualId, generation) => `${visualId}:${generation}`;

  return {
    begin(visualId, generation) {
      latest.set(visualId, generation);
      for (const [animationKey, animation] of animations) {
        if (!animationKey.startsWith(`${visualId}:`)) continue;
        animation.cancel?.();
        animations.delete(animationKey);
      }
    },
    async apply({ visualId, generation, operation, markType, element, from = {}, index = 0 }) {
      if (!element || !current(visualId, generation) || reduced()) return;
      const strategy = motionStrategy(operation.type, markType);
      const active = () => current(visualId, generation);
      const register = (animation) => animations.set(`${key(visualId, generation)}:${animations.size}`, animation);
      const delay = operation.type === 'enter' && index < 6 ? Math.min(index * 24, 120) : 0;
      if (operation.type === 'update') {
        if (strategy.action === 'geometry-update') await tweenGeometry(element, from, active);
        else await waitForAnimation(element, [{ opacity: 0.55 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' }, active, register);
        return;
      }
      const preservesSvgTransform = element instanceof SVGElement && element.hasAttribute('transform');
      const frames = motionFrames(operation.type, markType, preservesSvgTransform);
      if (!preservesSvgTransform) {
        element.style.transformBox = 'fill-box';
        element.style.transformOrigin = strategy.family === 'bar' || strategy.family === 'area' ? 'center bottom' : 'center';
      }
      await waitForAnimation(element, frames, { duration: 220, delay, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' }, active, register);
      if (!preservesSvgTransform) element.style.transform = '';
      element.style.opacity = '';
    }
  };
}
