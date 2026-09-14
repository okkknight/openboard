export function createRenderIdentityRegistry() {
  const visuals = new Map();

  function remember(artifact, plot) {
    if (artifact?.artifact_version !== 2) throw new Error('invalid_render_artifact');
    const marks = new Map();
    for (const descriptor of artifact.identity?.marks ?? []) {
      const plotMark = (plot?.marks ?? []).find((mark) => mark.id === descriptor.mark_id);
      const primitive = (plot?.primitives ?? []).find((layer) => layer.id === descriptor.mark_id);
      const renderKeys = plotMark?.render_keys ?? primitive?.values?.map((value) => value.render_key).filter(Boolean) ?? [];
      marks.set(descriptor.mark_id, { ...structuredClone(descriptor), render_keys: [...renderKeys] });
    }
    visuals.set(artifact.visual_id, { generation: artifact.generation, marks });
  }

  return {
    remember,
    mark(visualId, markId) {
      const mark = visuals.get(visualId)?.marks.get(markId);
      return mark ? structuredClone(mark) : undefined;
    },
    generation(visualId) {
      return visuals.get(visualId)?.generation;
    },
    clear(visualId) {
      visuals.delete(visualId);
    }
  };
}
