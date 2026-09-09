import { HistoryStore } from "./history-store.js";
import type { AnnotationSpec, ComposeInput, HistoryRecord, JsonValue, Scene, VisualPatch, VisualSpec } from "./types.js";

export interface VisualMutationResult {
  revision: number;
  visual: VisualSpec;
}

export interface SceneMutationResult {
  revision: number;
}

const IMMUTABLE_PATHS = new Set(["id", "derived_from", "marks"]);
const ALLOWED_ROOTS = new Set(["title", "kind", "source", "query", "layout", "facet"]);

function clone<T>(value: T): T {
  return structuredClone(value);
}

function validatePatchPath(path: string): void {
  const root = path.split(".")[0];
  if (IMMUTABLE_PATHS.has(path) || IMMUTABLE_PATHS.has(root)) {
    throw new Error(`immutable_path: ${path}`);
  }
  if (!ALLOWED_ROOTS.has(root)) {
    throw new Error(`invalid_patch_path: ${path}`);
  }
}

function setAtPath(target: Record<string, unknown>, path: string, value: JsonValue): void {
  validatePatchPath(path);
  const segments = path.split(".");
  let cursor: Record<string, unknown> = target;
  for (const segment of segments.slice(0, -1)) {
    const existing = cursor[segment];
    if (existing === undefined || existing === null || typeof existing !== "object" || Array.isArray(existing)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments.at(-1)!] = clone(value);
}

function unsetAtPath(target: Record<string, unknown>, path: string): void {
  validatePatchPath(path);
  const segments = path.split(".");
  let cursor: Record<string, unknown> = target;
  for (const segment of segments.slice(0, -1)) {
    const existing = cursor[segment];
    if (existing === undefined || existing === null || typeof existing !== "object" || Array.isArray(existing)) return;
    cursor = existing as Record<string, unknown>;
  }
  delete cursor[segments.at(-1)!];
}

function applyPatch(visual: VisualSpec, patch: VisualPatch): VisualSpec {
  const next = clone(visual) as VisualSpec & Record<string, unknown>;

  for (const [path, value] of Object.entries(patch.set ?? {})) setAtPath(next, path, value);
  for (const path of patch.unset ?? []) unsetAtPath(next, path);

  const remove = new Set(patch.remove_marks ?? []);
  if (remove.size > 0) next.marks = next.marks.filter((mark) => !remove.has(mark.id));

  if (patch.add_marks?.length) {
    const ids = new Set(next.marks.map((mark) => mark.id));
    for (const mark of patch.add_marks) {
      if (ids.has(mark.id)) throw new Error(`duplicate_mark: ${mark.id}`);
      ids.add(mark.id);
      next.marks.push(clone(mark));
    }
  }

  return next;
}

export class SceneStore {
  #scene: Scene;
  #history: HistoryStore;

  constructor(scene: Scene) {
    this.#scene = clone(scene);
    this.#history = new HistoryStore(this.#scene);
  }

  inspect(): Scene {
    return clone(this.#scene);
  }

  previewPatch(id: string, patch: VisualPatch): VisualSpec {
    const visual = this.#scene.visuals[id];
    if (!visual) throw new Error(`not_found: visual ${id}`);
    return applyPatch(visual, patch);
  }

  #assertRevision(expectedRevision?: number): void {
    if (expectedRevision !== undefined && expectedRevision !== this.#scene.revision) {
      throw new Error(`revision_conflict: expected ${expectedRevision}, actual ${this.#scene.revision}`);
    }
  }

  #commit(operation: Omit<HistoryRecord, "revision" | "parent_revision" | "timestamp">, mutator: (draft: Scene) => void, expectedRevision?: number): Scene {
    this.#assertRevision(expectedRevision);
    const draft = clone(this.#scene);
    mutator(draft);
    draft.revision = this.#scene.revision + 1;
    this.#history.append({
      ...operation,
      revision: draft.revision,
      parent_revision: this.#scene.revision,
      timestamp: new Date().toISOString()
    }, draft);
    this.#scene = draft;
    return clone(this.#scene);
  }

  patchVisual(id: string, patch: VisualPatch, expectedRevision?: number): VisualMutationResult {
    const scene = this.#commit({ operation: "visual.patch", target: id, input: patch as unknown as JsonValue }, (draft) => {
      const visual = draft.visuals[id];
      if (!visual) throw new Error(`not_found: visual ${id}`);
      draft.visuals[id] = applyPatch(visual, patch);
    }, expectedRevision);
    return { revision: scene.revision, visual: clone(scene.visuals[id]) };
  }

  cloneVisual(id: string, newId: string, patch?: VisualPatch, expectedRevision?: number): VisualMutationResult {
    const scene = this.#commit({ operation: "visual.clone", target: id, input: { new_id: newId, patch } as unknown as JsonValue }, (draft) => {
      const source = draft.visuals[id];
      if (!source) throw new Error(`not_found: visual ${id}`);
      if (draft.visuals[newId]) throw new Error(`already_exists: visual ${newId}`);
      let visual = clone(source);
      visual.id = newId;
      visual.derived_from = id;
      if (patch) visual = applyPatch(visual, patch);
      draft.visuals[newId] = visual;
    }, expectedRevision);
    return { revision: scene.revision, visual: clone(scene.visuals[newId]) };
  }

  createVisual(visual: VisualSpec, expectedRevision?: number): VisualMutationResult {
    const scene = this.#commit({ operation: "visual.create", target: visual.id, input: visual as unknown as JsonValue }, (draft) => {
      if (draft.visuals[visual.id]) throw new Error(`already_exists: visual ${visual.id}`);
      draft.visuals[visual.id] = clone(visual);
    }, expectedRevision);
    return { revision: scene.revision, visual: clone(scene.visuals[visual.id]) };
  }

  compose(input: ComposeInput, expectedRevision?: number): SceneMutationResult {
    const scene = this.#commit({ operation: "canvas.compose", target: input.target, input: input as unknown as JsonValue }, (draft) => {
      if (input.action === "focus") {
        if (!input.target || !draft.visuals[input.target]) throw new Error(`not_found: visual ${input.target}`);
        draft.canvas.focus = input.target;
        return;
      }
      if (input.action === "delete") {
        if (!input.target || !draft.visuals[input.target]) throw new Error(`not_found: visual ${input.target}`);
        delete draft.visuals[input.target];
        if (draft.canvas.focus === input.target) delete draft.canvas.focus;
        return;
      }
      if (input.action === "move" || input.action === "resize") {
        if (!input.target || !draft.visuals[input.target]) throw new Error(`not_found: visual ${input.target}`);
        if (!input.layout) throw new Error("invalid_compose: layout required");
        draft.visuals[input.target].layout = clone(input.layout);
        return;
      }
      throw new Error(`unsupported_compose: ${input.action}`);
    }, expectedRevision);
    return { revision: scene.revision };
  }

  annotate(annotation: AnnotationSpec, expectedRevision?: number): SceneMutationResult {
    const scene = this.#commit({ operation: "canvas.annotate", target: annotation.target, input: annotation as unknown as JsonValue }, (draft) => {
      if (draft.annotations[annotation.id]) throw new Error(`already_exists: annotation ${annotation.id}`);
      if (annotation.target && !draft.visuals[annotation.target]) throw new Error(`not_found: visual ${annotation.target}`);
      draft.annotations[annotation.id] = clone(annotation);
    }, expectedRevision);
    return { revision: scene.revision };
  }

  historyRecords(): HistoryRecord[] {
    return this.#history.records();
  }
}
