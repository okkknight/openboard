export const MOTION_TIMING = Object.freeze({
  draft: { duration: 160, easing: 'cubic-bezier(.2,.8,.2,1)' },
  enter: { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' },
  update: { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' },
  settle: { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' }
});

const ENTER_MODE = Object.freeze({ bar: 'baseline-enter', area: 'baseline-enter', dot: 'scale-enter', line: 'draw-enter', rule: 'draw-enter', arc: 'sweep-enter', text: 'translate-fade-enter', fallback: 'fade-enter' });

function timingFor(phase, operation) {
  return phase === 'draft'
    ? MOTION_TIMING.draft
    : phase === 'layout-settle'
      ? MOTION_TIMING.settle
      : operation === 'enter'
        ? MOTION_TIMING.enter
        : MOTION_TIMING.update;
}

export function createMotionPolicy({ reduced = () => false, hidden = () => false, maxAnimatedElements = 120 } = {}) {
  return {
    forOperation({ phase, operation, family, index = 0, elementCount = 1 }) {
      if (hidden()) return { animate: false, duration: 0, delay: 0, easing: 'linear', mode: 'none' };
      if (elementCount > maxAnimatedElements) return { animate: false, duration: 0, delay: 0, easing: 'linear', mode: 'layer-only' };
      if (reduced()) return { animate: true, duration: 100, delay: 0, easing: 'ease-out', mode: 'opacity-only' };
      const timing = timingFor(phase, operation);
      const delay = operation === 'enter' && index < 6 ? index * 24 : 0;
      const mode = operation === 'enter' ? (ENTER_MODE[family] ?? ENTER_MODE.fallback) : operation === 'exit' ? 'exit' : 'geometry-update';
      return { animate: true, duration: timing.duration, delay, easing: timing.easing, mode };
    },
    forLayer({ phase, elementCount }) {
      if (elementCount <= maxAnimatedElements || hidden()) return { animate: false, duration: 0, easing: 'linear', mode: 'none' };
      if (reduced()) return { animate: true, duration: 100, easing: 'ease-out', mode: 'layer-fade' };
      const timing = timingFor(phase, phase === 'data-enter' ? 'enter' : 'update');
      return { animate: true, duration: timing.duration, easing: timing.easing, mode: 'layer-fade' };
    }
  };
}
