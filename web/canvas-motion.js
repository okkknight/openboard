const animate = async (element, frames, options, reducedMotion) => {
  if (!element || reducedMotion() || !element.animate) return;
  await element.animate(frames, options).finished.catch(() => {});
};

export function createCanvasMotion({ reducedMotion = () => false } = {}) {
  return {
    layout(element, from) { return animate(element, [{ transform: `translate(${from.x}px, ${from.y}px) scale(${from.sx}, ${from.sy})` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' }, reducedMotion); },
    snap(element) { return animate(element, [{ transform: element.style.transform }, { transform: 'none' }], { duration: 120, easing: 'ease-out' }, reducedMotion); },
    rollback(element, transform) { return animate(element, [{ transform }, { transform: 'none' }], { duration: 180, easing: 'ease-out' }, reducedMotion); },
    enter(element) { return animate(element, [{ opacity: 0, transform: 'translateY(8px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' }, reducedMotion); },
    exit(element) { return animate(element, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-in', fill: 'both' }, reducedMotion); }
  };
}
