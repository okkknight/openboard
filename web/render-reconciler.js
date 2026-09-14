function byMark(layers) {
  return new Map((layers ?? []).map((layer) => [layer.mark_id, layer]));
}

function byKey(nodes) {
  return new Map((nodes ?? []).map((node) => [node.key, node]));
}

function orderedMarkIds(current, next) {
  const ids = [];
  for (const layer of current.layers ?? []) if (!ids.includes(layer.mark_id)) ids.push(layer.mark_id);
  for (const layer of next.layers ?? []) if (!ids.includes(layer.mark_id)) ids.push(layer.mark_id);
  return ids;
}

export function createRenderGenerationTracker() {
  const latest = new Map();
  return {
    request(visualId) {
      const generation = (latest.get(visualId) ?? 0) + 1;
      latest.set(visualId, generation);
      return generation;
    },
    accepts(visualId, generation) {
      return latest.get(visualId) === generation;
    }
  };
}

export function planRenderOperations(current, next) {
  const operations = [];
  if (current.axes_version !== next.axes_version) operations.push({ type: 'replace-axes' });
  const currentByMark = byMark(current.layers);
  const nextByMark = byMark(next.layers);

  for (const markId of orderedMarkIds(current, next)) {
    const before = currentByMark.get(markId);
    const after = nextByMark.get(markId);
    if (!before || !after || before.identity_mode === 'nonretainable' || after.identity_mode === 'nonretainable' || before.identity_mode !== after.identity_mode || before.mark_type !== after.mark_type) {
      if (!before && after?.identity_mode !== 'nonretainable') {
        for (const node of after.nodes ?? []) operations.push({ type: 'enter', mark_id: markId, key: node.key });
      } else if (before && !after && before.identity_mode !== 'nonretainable') {
        for (const node of before.nodes ?? []) operations.push({ type: 'exit', mark_id: markId, key: node.key });
      } else operations.push({ type: 'replace-layer', mark_id: markId });
      continue;
    }

    const beforeByKey = byKey(before.nodes);
    const afterByKey = byKey(after.nodes);
    for (const node of after.nodes ?? []) {
      if (beforeByKey.has(node.key)) operations.push({ type: 'update', mark_id: markId, key: node.key });
    }
    for (const node of before.nodes ?? []) if (!afterByKey.has(node.key)) operations.push({ type: 'exit', mark_id: markId, key: node.key });
    for (const node of after.nodes ?? []) if (!beforeByKey.has(node.key)) operations.push({ type: 'enter', mark_id: markId, key: node.key });
  }
  return operations;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function markClass(markId) {
  return `dc-mark-${encodeURIComponent(markId).replace(/%/g, '_')}`;
}

function svgGroup() {
  return document.createElementNS(SVG_NS, 'g');
}

function copyAttributes(current, next) {
  for (const attribute of [...current.attributes]) if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
  for (const attribute of [...next.attributes]) current.setAttribute(attribute.name, attribute.value);
  if (current.childNodes.length || next.childNodes.length) current.replaceChildren(...[...next.childNodes].map((node) => node.cloneNode(true)));
}

function identityByMark(artifact) {
  return new Map((artifact.identity?.marks ?? []).map((descriptor) => [descriptor.mark_id, descriptor]));
}

function layerNodes(layer) {
  return [...layer.querySelectorAll('[data-render-key]')]
    .filter((node) => node instanceof SVGElement)
    .map((element) => ({ key: element.dataset.renderKey, element }));
}

function layerModel(layer, descriptor) {
  if (!descriptor) return null;
  return {
    mark_id: descriptor.mark_id,
    mark_type: descriptor.mark_type,
    identity_mode: descriptor.identity_mode,
    nodes: layerNodes(layer)
  };
}

function splitDetachedSvg(svg, artifact) {
  const marks = svgGroup();
  marks.dataset.zone = 'marks';
  const axes = svgGroup();
  axes.dataset.zone = 'axes';
  const descriptors = identityByMark(artifact);
  for (const child of [...svg.children]) {
    const markId = child.dataset?.markId;
    if (markId && descriptors.has(markId)) marks.append(child);
    else if (child.tagName.toLowerCase() !== 'style') axes.append(child);
  }
  return { axes, marks };
}

function synchronizeRoot(current, next, visualId) {
  for (const attribute of [...current.attributes]) if (attribute.name !== 'data-visual-id' && !next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
  for (const attribute of [...next.attributes]) current.setAttribute(attribute.name, attribute.value);
  current.dataset.visualId = visualId;
  const nextStyle = [...next.children].find((child) => child.tagName.toLowerCase() === 'style');
  const currentStyle = [...current.children].find((child) => child.tagName.toLowerCase() === 'style');
  if (nextStyle && currentStyle) currentStyle.replaceWith(nextStyle.cloneNode(true));
  else if (nextStyle) current.prepend(nextStyle.cloneNode(true));
}

function stableViewport(nextSvg, visualId, artifact) {
  synchronizeRoot(nextSvg, nextSvg, visualId);
  const { axes, marks } = splitDetachedSvg(nextSvg, artifact);
  for (const child of [...nextSvg.children]) if (child.tagName.toLowerCase() !== 'style') child.remove();
  nextSvg.append(axes, marks);
  return nextSvg;
}

function axesVersion(axes) {
  return axes.innerHTML;
}

export function annotateDetachedPlotLayer(group, mark) {
  if (!group) return group;
  group.dataset.markId = mark.id;
  group.dataset.markType = mark.type;
  group.dataset.renderer = 'plot';
  group.dataset.identityMode = mark.identity.identity_mode;
  group.dataset.layerKey = mark.identity.layer_key;
  const keyForBoundDatum = (bound) => {
    const indexed = Array.isArray(bound) || ArrayBuffer.isView(bound);
    const index = indexed ? [...bound].find((value) => Number.isInteger(value) && value >= 0) : bound;
    return Number.isInteger(index) ? mark.render_keys[index] : undefined;
  };
  for (const node of group.querySelectorAll('rect,path,circle,line,text')) {
    const key = keyForBoundDatum(node.__data__);
    if (key) node.dataset.renderKey = key;
  }
  if (mark.identity.identity_mode === 'singleton' && !group.querySelector('[data-render-key]')) {
    const node = group.querySelector('path,rect,circle,line,text');
    if (node) node.dataset.renderKey = mark.render_keys[0] ?? `mark=${mark.id}|key=[["singleton",null]]`;
  }
  return group;
}

export function reconcilePlotViewport(container, nextSvg, visual, artifact, { onEnter = () => {}, onUpdate = () => {}, onExit = () => {}, onReplaceLayer = () => {} } = {}) {
  let viewport = container.querySelector('svg[data-visual-id]');
  if (!viewport || viewport.dataset.visualId !== visual.id) {
    viewport = stableViewport(nextSvg, visual.id, artifact);
    container.replaceChildren(viewport);
    const operations = [];
    for (const layer of viewport.querySelectorAll(':scope > [data-zone="marks"] > [data-mark-id]')) {
      for (const node of layerNodes(layer)) {
        const operation = { type: 'enter', mark_id: layer.dataset.markId, key: node.key };
        operations.push(operation);
        void onEnter(node.element, operation, { markType: layer.dataset.markType, index: operations.length - 1 });
      }
    }
    return { viewport, initial: true, operations };
  }

  const next = stableViewport(nextSvg, visual.id, artifact);
  synchronizeRoot(viewport, next, visual.id);
  const currentAxes = viewport.querySelector(':scope > [data-zone="axes"]');
  const currentMarks = viewport.querySelector(':scope > [data-zone="marks"]');
  const nextAxes = next.querySelector(':scope > [data-zone="axes"]');
  const nextMarks = next.querySelector(':scope > [data-zone="marks"]');
  const descriptors = identityByMark(artifact);
  const currentLayers = [...currentMarks.children]
    .map((layer) => layerModel(layer, descriptors.get(layer.dataset.markId) ?? {
      mark_id: layer.dataset.markId,
      mark_type: layer.dataset.markType,
      identity_mode: layer.dataset.identityMode
    }))
    .filter(Boolean);
  const nextLayers = [...nextMarks.children].map((layer) => layerModel(layer, descriptors.get(layer.dataset.markId))).filter(Boolean);
  const operations = planRenderOperations({ axes_version: axesVersion(currentAxes), layers: currentLayers }, { axes_version: axesVersion(nextAxes), layers: nextLayers });
  const currentByMark = new Map([...currentMarks.children].map((layer) => [layer.dataset.markId, layer]));
  const nextByMark = new Map([...nextMarks.children].map((layer) => [layer.dataset.markId, layer]));

  let operationIndex = 0;
  for (const operation of operations) {
    if (operation.type === 'replace-axes') {
      currentAxes.replaceChildren(...[...nextAxes.childNodes].map((node) => node.cloneNode(true)));
      continue;
    }
    const currentLayer = currentByMark.get(operation.mark_id);
    const nextLayer = nextByMark.get(operation.mark_id);
    if (operation.type === 'replace-layer') {
      const markType = nextLayer?.dataset.markType ?? currentLayer?.dataset.markType;
      if (currentLayer && nextLayer) {
        Promise.resolve(onReplaceLayer(currentLayer, nextLayer, operation, { fromMarkType: currentLayer.dataset.markType, markType, index: operationIndex++ })).then(() => {
          const replacement = nextLayer.cloneNode(true);
          currentLayer.replaceWith(replacement);
          for (const node of layerNodes(replacement)) {
            const enter = { type: 'enter', mark_id: operation.mark_id, key: node.key };
            void onEnter(node.element, enter, { markType, index: operationIndex++ });
          }
        });
      }
      else if (currentLayer) currentLayer.remove();
      else if (nextLayer) currentMarks.append(nextLayer.cloneNode(true));
      continue;
    }
    if (!currentLayer && nextLayer) {
      currentMarks.append(nextLayer.cloneNode(true));
      continue;
    }
    if (!currentLayer) continue;
    const selector = `[data-render-key="${CSS.escape(operation.key)}"]`;
    const currentNode = currentLayer.querySelector(selector);
    const nextNode = nextLayer && nextLayer.querySelector(selector);
    const markType = nextLayer?.dataset.markType ?? currentLayer?.dataset.markType;
    if (operation.type === 'update' && currentNode && nextNode) {
      const from = Object.fromEntries([...currentNode.attributes].map((attribute) => [attribute.name, attribute.value]));
      copyAttributes(currentNode, nextNode);
      void onUpdate(currentNode, operation, { markType, from, index: operationIndex++ });
    }
    if (operation.type === 'enter' && nextNode) {
      const entered = nextNode.cloneNode(true);
      currentLayer.append(entered);
      void onEnter(entered, operation, { markType, index: operationIndex++ });
    }
    if (operation.type === 'exit' && currentNode) Promise.resolve(onExit(currentNode, operation, { markType, index: operationIndex++ })).then(() => currentNode.remove());
  }
  return { viewport, initial: false, operations };
}
