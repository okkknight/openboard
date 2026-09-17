export async function createInWork(runtime, visual) {
  const begun = await runtime.workApply({ action: "begin" });
  const result = await runtime.visualCreate(visual, undefined, begun.result.work_id);
  const committed = await runtime.workApply({ action: "commit", work_id: begun.result.work_id });
  return { ...result, revision: committed.revision };
}

export async function patchInWork(runtime, id, patch) {
  const begun = await runtime.workApply({ action: "begin" });
  const result = await runtime.visualPatch(id, patch, undefined, begun.result.work_id);
  const committed = await runtime.workApply({ action: "commit", work_id: begun.result.work_id });
  return { ...result, revision: committed.revision };
}

export async function cloneInWork(runtime, id, newId, patch) {
  const begun = await runtime.workApply({ action: "begin" });
  const result = await runtime.visualClone(id, newId, patch, undefined, begun.result.work_id);
  const committed = await runtime.workApply({ action: "commit", work_id: begun.result.work_id });
  return { ...result, revision: committed.revision };
}
