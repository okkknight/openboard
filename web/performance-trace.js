const ALLOWED = new Set(['draft_visible', 'visual_first_paint', 'visual_settled', 'work_committed']);

export function createBrowserTrace({ performanceApi = performance, maxTraces = 100 } = {}) {
  const traces = new Map();
  const prefix = (traceId) => `openboard:${traceId}:`;
  return {
    begin(traceId) {
      if (!traceId || traces.has(traceId)) return;
      traces.set(traceId, []);
      while (traces.size > maxTraces) {
        const oldest = traces.keys().next().value;
        traces.delete(oldest);
        performanceApi.clearMarks?.(prefix(oldest));
      }
    },
    mark(traceId, name) {
      if (!ALLOWED.has(name)) throw new Error(`invalid_browser_milestone: ${name}`);
      this.begin(traceId);
      const entries = traces.get(traceId);
      if (entries.some((entry) => entry.name === name)) return;
      const markName = `${prefix(traceId)}${name}`;
      performanceApi.mark(markName);
      entries.push({ name, mark_name: markName });
    },
    snapshot(traceId) { return structuredClone(traces.get(traceId) ?? []); },
    traceIds() { return [...traces.keys()]; },
    clear(traceId) { traces.delete(traceId); performanceApi.clearMarks?.(prefix(traceId)); }
  };
}
