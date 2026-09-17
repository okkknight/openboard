export function createVisualRenderCache() {
  const payloads = new Map();
  return {
    remember(id, payload) { if (payload?.status !== 'rendered') return false; payloads.set(id, structuredClone(payload)); return true; },
    get(id) { const payload = payloads.get(id); return payload ? structuredClone(payload) : undefined; },
    remove(id) { payloads.delete(id); },
    reflow(id, layout, renderer) { const payload = payloads.get(id); if (!payload) return false; renderer(structuredClone(payload), { ...layout }); return true; }
  };
}
