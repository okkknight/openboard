const HANDLES = [
  ['nw', 'North west resize handle'], ['n', 'North resize handle'], ['ne', 'North east resize handle'],
  ['e', 'East resize handle'], ['se', 'South east resize handle'], ['s', 'South resize handle'],
  ['sw', 'South west resize handle'], ['w', 'West resize handle']
];

export function createInteractionChrome(root) {
  const layer = document.createElement('div'); layer.className = 'interaction-chrome'; layer.hidden = true;
  const selection = document.createElement('div'); selection.className = 'selection-bounds';
  const handles = HANDLES.map(([name, label]) => {
    const handle = document.createElement('button'); handle.type = 'button'; handle.className = `resize-handle handle-${name}`;
    handle.dataset.handle = name; handle.setAttribute('aria-label', label); selection.append(handle); return handle;
  });
  const guides = document.createElement('div'); guides.className = 'snap-guides';
  const chip = document.createElement('output'); chip.className = 'measurement-chip'; chip.hidden = true;
  const live = document.createElement('div'); live.className = 'interaction-live'; live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true');
  layer.append(selection, guides, chip, live); root.append(layer);
  const place = (element, bounds) => { element.style.left = `${bounds.x}px`; element.style.top = `${bounds.y}px`; element.style.width = `${bounds.w}px`; element.style.height = `${bounds.h}px`; };
  return {
    layer, handles,
    renderSelection(bounds) { layer.hidden = !bounds; if (bounds) place(selection, bounds); },
    renderGuides(items = []) {
      guides.replaceChildren(...items.map((guide) => { const line = document.createElement('i'); line.className = `snap-guide guide-${guide.axis}`; line.style[guide.axis === 'x' ? 'left' : 'top'] = `${guide.value}px`; return line; }));
    },
    renderMarquee(bounds) { let marquee = layer.querySelector('.selection-marquee'); if (!bounds) { marquee?.remove(); return; } if (!marquee) { marquee = document.createElement('div'); marquee.className = 'selection-marquee'; layer.append(marquee); } place(marquee, bounds); },
    showMeasurement(text) { chip.textContent = text; chip.hidden = !text; },
    announce(message) { live.textContent = ''; requestAnimationFrame(() => { live.textContent = message; }); },
    clear() { layer.hidden = true; guides.replaceChildren(); chip.hidden = true; layer.querySelector('.selection-marquee')?.remove(); }
  };
}
