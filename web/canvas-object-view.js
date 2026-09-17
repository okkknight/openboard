const keyFor = (kind, id) => `${kind}:${id}`;

export function createCanvasObjectView({ board, renderAnnotation }) {
  const elements = new Map();
  const create = (kind, id) => {
    const element = document.createElement('article');
    element.className = 'canvas-object';
    element.dataset.kind = kind;
    element.dataset.objectId = id;
    if (kind === 'visual') element.dataset.visual = id;
    element.tabIndex = 0;
    const title = document.createElement('div'); title.className = 'object-title';
    const grab = document.createElement('span'); grab.className = 'object-grab'; grab.ariaHidden = 'true';
    const titleText = document.createElement('span'); titleText.className = 'object-title-text';
    title.append(grab, titleText);
    const content = document.createElement('div'); content.className = 'object-content';
    if (kind === 'visual') content.append(Object.assign(document.createElement('div'), { className: 'plot' }));
    else content.append(Object.assign(document.createElement('div'), { className: 'annotation-text' }));
    const status = document.createElement('div'); status.className = 'object-status'; status.hidden = true; status.setAttribute('aria-live', 'polite');
    element.append(title, content, status); board.append(element); elements.set(keyFor(kind, id), element);
    return element;
  };
  const api = {
    ensure(kind, object) {
      const element = elements.get(keyFor(kind, object.id)) ?? create(kind, object.id);
      const title = kind === 'visual' ? object.title || 'Untitled visual' : object.style?.variant === 'callout' ? 'Callout' : 'Note';
      element.querySelector('.object-title-text').textContent = title;
      element.setAttribute('aria-label', `${kind === 'visual' ? 'Visual' : 'Annotation'}: ${title}`);
      if (kind === 'annotation') renderAnnotation(element.querySelector('.annotation-text'), object);
      return element;
    },
    remove(kind, id) { const element = elements.get(keyFor(kind, id)); element?.remove(); elements.delete(keyFor(kind, id)); },
    elementFor(kind, id) { return elements.get(keyFor(kind, id)); },
    layoutFor(kind, id) {
      const element = elements.get(keyFor(kind, id));
      if (!element) return undefined;
      return { x: Number.parseFloat(element.style.left), y: Number.parseFloat(element.style.top), w: Number.parseFloat(element.style.width), h: Number.parseFloat(element.style.height) };
    },
    allRefs() { return [...elements.keys()].map((key) => { const separator = key.indexOf(':'); return { kind: key.slice(0, separator), id: key.slice(separator + 1) }; }); },
    sync(scene) {
      const wanted = new Set();
      for (const visual of Object.values(scene.visuals)) { wanted.add(keyFor('visual', visual.id)); api.ensure('visual', visual); }
      for (const annotation of Object.values(scene.annotations)) { wanted.add(keyFor('annotation', annotation.id)); api.ensure('annotation', annotation); }
      for (const key of [...elements.keys()]) if (!wanted.has(key)) { elements.get(key)?.remove(); elements.delete(key); }
    }
  };
  return api;
}
