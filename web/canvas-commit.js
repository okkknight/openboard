const sameLayout = (left, right) => left && right && left.x === right.x && left.y === right.y && left.w === right.w && left.h === right.h;
const keyFor = (target) => `${target.kind}:${target.id}`;
const originalFor = (originals, key) => originals instanceof Map ? originals.get(key) : originals[key];
const sceneLayout = (scene, target) => target.kind === 'visual' ? scene.visuals?.[target.id]?.layout : scene.annotations?.[target.id]?.layout;

export function createCanvasCommitter({ fetchScene, postCompose, postAnnotate, applyDurableScene, rollback, announce }) {
  const commitLayoutGesture = async (gesture) => {
    if (!gesture.layoutUpdates?.length) return { status: 'noop' };
    const request = { action: gesture.action, layout_updates: gesture.layoutUpdates, expected_revision: gesture.baseRevision };
    try {
      const result = await postCompose(request);
      applyDurableScene(await fetchScene());
      return result;
    } catch (error) {
      if (error?.status !== 409 && error?.code !== 'revision_conflict') throw error;
      const latest = await fetchScene();
      const unchanged = gesture.layoutUpdates.every(({ target }) => sameLayout(sceneLayout(latest, target), originalFor(gesture.originalLayouts, keyFor(target))));
      if (!unchanged) {
        rollback(gesture.originalLayouts);
        announce('Layout changed elsewhere. Your gesture was rolled back.');
        throw new Error('layout_conflict');
      }
      try {
        const result = await postCompose({ ...request, expected_revision: latest.revision });
        applyDurableScene(await fetchScene());
        return result;
      } catch (retryError) {
        rollback(gesture.originalLayouts);
        announce('Layout changed again. Your gesture was rolled back.');
        throw retryError;
      }
    }
  };
  const patchAnnotation = async ({ id, patch, baseRevision }) => {
    try {
      const result = await postAnnotate({ mode: 'patch', id, patch, expected_revision: baseRevision });
      applyDurableScene(await fetchScene());
      return result;
    } catch (error) {
      if (error?.status === 409 || error?.code === 'revision_conflict') announce('Annotation changed elsewhere. Reloaded the latest version.');
      throw error;
    }
  };
  return { commitLayoutGesture, patchAnnotation };
}
