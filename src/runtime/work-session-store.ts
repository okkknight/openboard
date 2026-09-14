import type { AnnotationSpec, CanvasState, EffectiveScene, Scene, VisualPatch, WorkingOverlay, WorkingVisual, WorkingVisualDraft, WorkSession, WorkStatus } from "../core/types.js";

function clone<T>(value: T): T { return structuredClone(value); }

function emptyOverlay(): WorkingOverlay {
  return { visuals: {}, removed_visual_ids: [], annotations: {}, removed_annotation_ids: [], operations: 0 };
}

function assertActive(work: WorkSession): void {
  if (work.status !== "active") throw new Error(`invalid_work_state: ${work.status}`);
}

function asRecord(value: WorkingVisual): Record<string, unknown> {
  return clone(value) as unknown as Record<string, unknown>;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    const current = cursor[segment];
    if (!current || typeof current !== "object" || Array.isArray(current)) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments.at(-1)!] = clone(value);
}

function unsetPath(target: Record<string, unknown>, path: string): void {
  const segments = path.split(".");
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    const current = cursor[segment];
    if (!current || typeof current !== "object" || Array.isArray(current)) return;
    cursor = current as Record<string, unknown>;
  }
  delete cursor[segments.at(-1)!];
}

function applyWorkingPatch(visual: WorkingVisual, patch: VisualPatch): WorkingVisualDraft {
  const next = asRecord(visual);
  for (const [path, value] of Object.entries(patch.set ?? {})) setPath(next, path, value);
  for (const path of patch.unset ?? []) unsetPath(next, path);
  const currentMarks = Array.isArray(next.marks) ? next.marks as Array<{ id?: unknown }> : [];
  const removed = new Set(patch.remove_marks ?? []);
  next.marks = currentMarks.filter((mark) => !removed.has(String(mark.id)));
  for (const mark of patch.add_marks ?? []) {
    if ((next.marks as Array<{ id?: unknown }>).some((existing) => existing.id === mark.id)) throw new Error(`duplicate_mark: ${mark.id}`);
    (next.marks as unknown[]).push(clone(mark));
  }
  return next as unknown as WorkingVisualDraft;
}

function isLayout(value: unknown): boolean {
  return Boolean(value) && typeof value === "object" && ["x", "y", "w", "h"].every((key) => typeof (value as Record<string, unknown>)[key] === "number")
    && (value as { w: number }).w > 0 && (value as { h: number }).h > 0;
}

function assertCompleteVisual(id: string, visual: WorkingVisual): asserts visual is import("../core/types.js").VisualSpec {
  if (!visual || typeof visual !== "object" || !visual.id || !["plot", "table", "kpi"].includes(String(visual.kind)) || typeof visual.source !== "string" || !visual.source || !visual.query || typeof visual.query !== "object" || !Array.isArray(visual.marks) || !isLayout(visual.layout)) {
    throw new Error(`invalid_work_draft: ${id}`);
  }
}

export class WorkSessionStore {
  #sessions = new Map<string, WorkSession>();
  #nextId = 1;

  begin(scene: Scene): WorkSession {
    const work: WorkSession = { id: `work_${this.#nextId++}`, base_revision: scene.revision, status: "active", sequence: 1, started_at: new Date().toISOString(), overlay: emptyOverlay() };
    this.#sessions.set(work.id, work);
    return clone(work);
  }

  get(workId: string): WorkSession {
    const work = this.#sessions.get(workId);
    if (!work) throw new Error(`not_found: work ${workId}`);
    return clone(work);
  }

  list(): WorkSession[] { return [...this.#sessions.values()].map(clone); }

  next(workId: string, status?: WorkStatus): WorkSession {
    const work = this.#require(workId);
    if (status) work.status = status;
    work.sequence += 1;
    return clone(work);
  }

  setActivity(workId: string, activity: WorkSession["activity"]): WorkSession {
    const work = this.#require(workId);
    work.activity = activity ? clone(activity) : undefined;
    work.sequence += 1;
    return clone(work);
  }

  createDraft(workId: string, draft: WorkingVisualDraft): WorkSession {
    const work = this.#require(workId); assertActive(work);
    if (!draft.id) throw new Error("invalid_work_draft: id");
    if (work.overlay.visuals[draft.id]) throw new Error(`already_exists: visual ${draft.id}`);
    work.overlay.visuals[draft.id] = clone(draft);
    work.overlay.removed_visual_ids = work.overlay.removed_visual_ids.filter((id) => id !== draft.id);
    work.overlay.operations += 1;
    work.sequence += 1;
    return clone(work);
  }

  patchVisual(workId: string, id: string, patch: VisualPatch, durable: Scene): WorkSession {
    const work = this.#require(workId); assertActive(work);
    const visual = this.effectiveScene(workId, durable).visuals[id];
    if (!visual) throw new Error(`not_found: visual ${id}`);
    work.overlay.visuals[id] = applyWorkingPatch(visual, patch);
    work.overlay.operations += 1;
    work.sequence += 1;
    return clone(work);
  }

  deleteVisual(workId: string, id: string, durable: Scene): WorkSession {
    const work = this.#require(workId); assertActive(work);
    if (!this.effectiveScene(workId, durable).visuals[id]) throw new Error(`not_found: visual ${id}`);
    delete work.overlay.visuals[id];
    if (!work.overlay.removed_visual_ids.includes(id)) work.overlay.removed_visual_ids.push(id);
    work.overlay.operations += 1;
    work.sequence += 1;
    return clone(work);
  }

  setCanvas(workId: string, canvas: CanvasState): WorkSession {
    const work = this.#require(workId); assertActive(work);
    work.overlay.canvas = clone(canvas);
    work.overlay.operations += 1;
    work.sequence += 1;
    return clone(work);
  }

  annotate(workId: string, annotation: AnnotationSpec): WorkSession {
    const work = this.#require(workId); assertActive(work);
    work.overlay.annotations[annotation.id] = clone(annotation);
    work.overlay.removed_annotation_ids = work.overlay.removed_annotation_ids.filter((id) => id !== annotation.id);
    work.overlay.operations += 1;
    work.sequence += 1;
    return clone(work);
  }

  effectiveScene(workId: string, durable: Scene): EffectiveScene {
    const work = this.#require(workId);
    const scene = clone(durable) as EffectiveScene;
    for (const id of work.overlay.removed_visual_ids) delete scene.visuals[id];
    for (const [id, visual] of Object.entries(work.overlay.visuals)) scene.visuals[id] = clone(visual);
    for (const id of work.overlay.removed_annotation_ids) delete scene.annotations[id];
    for (const [id, annotation] of Object.entries(work.overlay.annotations)) scene.annotations[id] = clone(annotation);
    if (work.overlay.canvas) scene.canvas = clone(work.overlay.canvas);
    return scene;
  }

  materializeForCommit(workId: string, durable: Scene): Scene {
    const effective = this.effectiveScene(workId, durable);
    const visuals: Scene["visuals"] = {};
    for (const [id, visual] of Object.entries(effective.visuals)) {
      assertCompleteVisual(id, visual);
      visuals[id] = clone(visual);
    }
    return { canvas_id: effective.canvas_id, revision: durable.revision, datasets: clone(effective.datasets), visuals, annotations: clone(effective.annotations), canvas: clone(effective.canvas) };
  }

  cancel(workId: string): WorkSession {
    const work = this.#require(workId);
    work.status = "cancelled";
    work.sequence += 1;
    this.#sessions.delete(workId);
    return clone(work);
  }

  complete(workId: string): WorkSession {
    const work = this.#require(workId);
    work.status = "completed";
    work.sequence += 1;
    this.#sessions.delete(workId);
    return clone(work);
  }

  #require(workId: string): WorkSession {
    const work = this.#sessions.get(workId);
    if (!work) throw new Error(`not_found: work ${workId}`);
    return work;
  }
}
