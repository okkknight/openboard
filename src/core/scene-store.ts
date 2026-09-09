import type { JsonValue, Scene, VisualPatch, VisualSpec } from "./types.js";

export interface VisualMutationResult {
  revision: number;
  visual: VisualSpec;
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

  constructor(scene: Scene) {
    this.#scene = clone(scene);
  }

  inspect(): Scene {
    return clone(this.#scene);
  }

  #assertRevision(expectedRevision?: number): void {
    if (expectedRevision !== undefined && expectedRevision !== this.#scene.revision) {
      throw new Error(`revision_conflict: expected ${expectedRevision}, actual ${this.#scene.revision}`);
    }
  }

  #commit(mutator: (draft: Scene) => void, expectedRevision?: number): Scene {
    this.#assertRevision(expectedRevision);
    const draft = clone(this.#scene);
    mutator(draft);
    draft.revision = this.#scene.revision + 1;
    this.#scene = draft;
    return clone(this.#scene);
  }

  patchVisual(id: string, patch: VisualPatch, expectedRevision?: number): VisualMutationResult {
    const scene = this.#commit((draft) => {
      const visual = draft.visuals[id];
      if (!visual) throw new Error(`not_found: visual ${id}`);
      draft.visuals[id] = applyPatch(visual, patch);
    }, expectedRevision);
    return { revision: scene.revision, visual: clone(scene.visuals[id]) };
  }

  cloneVisual(id: string, newId: string, patch?: VisualPatch, expectedRevision?: number): VisualMutationResult {
    const scene = this.#commit((draft) => {
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
}
