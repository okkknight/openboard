import { HistoryStore, type HistoryStoreSeed } from "./history-store.js";
import type { AnnotationPatch, AnnotationSpec, ComposeInput, HistoryApplyInput, HistoryRecord, JsonValue, LayoutSpec, LayoutUpdate, Scene, VisualPatch, VisualSpec } from "./types.js";
import { normalizeScene, normalizeVisual } from "./scene-normalizer.js";

export interface VisualMutationResult {
  revision: number;
  visual: VisualSpec;
}

export interface SceneMutationResult {
  revision: number;
}

export class RevisionConflictError extends Error {
  readonly code = "revision_conflict";
  constructor(readonly expected_revision: number, readonly actual_revision: number) {
    super(`revision_conflict: expected ${expected_revision}, actual ${actual_revision}`);
  }
}

export interface HistoryMutationResult extends SceneMutationResult {
  checkpoint?: string;
  parent_revision?: number;
  branch_id?: string;
}

export interface SceneStoreState {
  scene: Scene;
  history: HistoryStoreSeed;
}

const IMMUTABLE_PATHS = new Set(["id", "derived_from", "marks"]);
const ALLOWED_ROOTS = new Set(["title", "kind", "source", "query", "layout", "facet", "coordinate"]);

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function layoutsEqual(left: LayoutSpec | undefined, right: LayoutSpec): boolean {
  return Boolean(left) && left!.x === right.x && left!.y === right.y && left!.w === right.w && left!.h === right.h;
}

export function normalizeLayoutUpdates(input: ComposeInput): LayoutUpdate[] {
  if (input.layout_updates) {
    if (input.target !== undefined || input.layout !== undefined) throw new Error("invalid_compose: mixed layout forms");
    if (input.layout_updates.length === 0) throw new Error("invalid_compose: layout updates required");
    const seen = new Set<string>();
    for (const update of input.layout_updates) {
      const key = `${update.target.kind}:${update.target.id}`;
      if (seen.has(key)) throw new Error(`invalid_compose: duplicate layout target ${key}`);
      seen.add(key);
    }
    return input.layout_updates;
  }
  if (!input.target || !input.layout) throw new Error("invalid_compose: target and layout required");
  return [{ target: { kind: "visual", id: input.target }, layout: input.layout }];
}

export function applyAnnotationPatch(annotation: AnnotationSpec, patch: AnnotationPatch): AnnotationSpec {
  if (Object.keys(patch).length === 0) throw new Error("invalid_annotation_patch: empty patch");
  const next = clone(annotation);
  if (patch.text !== undefined) next.text = patch.text;
  if (patch.target === null) delete next.target;
  else if (patch.target !== undefined) next.target = patch.target;
  if (patch.anchor === null) delete next.anchor;
  else if (patch.anchor !== undefined) next.anchor = clone(patch.anchor);
  if (patch.layout !== undefined) next.layout = clone(patch.layout);
  if (patch.style !== undefined) next.style = clone(patch.style);
  return next;
}

export function assertValidVisualPatchPath(path: string): void {
  const segments = path.split(".");
  const root = segments[0];
  if (root === "marks" && segments.length >= 3) {
    if (segments[2] === "id") throw new Error(`immutable_path: ${path}`);
    return;
  }
  if (IMMUTABLE_PATHS.has(path) || IMMUTABLE_PATHS.has(root)) {
    throw new Error(`immutable_path: ${path}`);
  }
  if (!ALLOWED_ROOTS.has(root)) {
    throw new Error(`invalid_patch_path: ${path}`);
  }
}

function markForPath(target: Record<string, unknown>, path: string): { mark: Record<string, unknown>; segments: string[] } | undefined {
  const segments = path.split(".");
  if (segments[0] !== "marks" || segments.length < 3) return undefined;
  const marks = target.marks;
  if (!Array.isArray(marks)) throw new Error("invalid_marks");
  const mark = marks.find((candidate) => candidate && typeof candidate === "object" && (candidate as { id?: unknown }).id === segments[1]);
  if (!mark || typeof mark !== "object" || Array.isArray(mark)) throw new Error(`not_found: mark ${segments[1]}`);
  return { mark: mark as Record<string, unknown>, segments: segments.slice(2) };
}

function setObjectPath(target: Record<string, unknown>, segments: string[], value: JsonValue): void {
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    const existing = cursor[segment];
    if (existing === undefined || existing === null || typeof existing !== "object" || Array.isArray(existing)) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments.at(-1)!] = clone(value);
}

function unsetObjectPath(target: Record<string, unknown>, segments: string[]): void {
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    const existing = cursor[segment];
    if (existing === undefined || existing === null || typeof existing !== "object" || Array.isArray(existing)) return;
    cursor = existing as Record<string, unknown>;
  }
  delete cursor[segments.at(-1)!];
}

function setAtPath(target: Record<string, unknown>, path: string, value: JsonValue): void {
  assertValidVisualPatchPath(path);
  const markPath = markForPath(target, path);
  if (markPath) { setObjectPath(markPath.mark, markPath.segments, value); return; }
  setObjectPath(target, path.split("."), value);
}

function unsetAtPath(target: Record<string, unknown>, path: string): void {
  assertValidVisualPatchPath(path);
  const markPath = markForPath(target, path);
  if (markPath) {
    unsetObjectPath(markPath.mark, markPath.segments);
    return;
  }
  const segments = path.split(".");
  let cursor: Record<string, unknown> = target;
  for (const segment of segments.slice(0, -1)) {
    const existing = cursor[segment];
    if (existing === undefined || existing === null || typeof existing !== "object" || Array.isArray(existing)) return;
    cursor = existing as Record<string, unknown>;
  }
  delete cursor[segments.at(-1)!];
}

export function applyVisualPatch(visual: VisualSpec, patch: VisualPatch): VisualSpec {
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

  constructor(scene: Scene, historySeed?: HistoryStoreSeed) {
    this.#scene = normalizeScene(scene);
    this.#history = new HistoryStore(this.#scene, historySeed);
  }

  inspect(): Scene {
    return clone(this.#scene);
  }

  snapshotState(): SceneStoreState {
    return {
      scene: clone(this.#scene),
      history: {
        records: this.#history.records(),
        snapshots: this.#history.revisions().map((revision) => this.#history.snapshotAt(revision)),
        checkpoints: this.#history.checkpoints(),
        forks: this.#history.forks()
      }
    };
  }

  restoreState(state: SceneStoreState): void {
    this.#scene = clone(state.scene);
    this.#history = new HistoryStore(this.#scene, state.history);
  }

  previewPatch(id: string, patch: VisualPatch): VisualSpec {
    const visual = this.#scene.visuals[id];
    if (!visual) throw new Error(`not_found: visual ${id}`);
    return applyVisualPatch(visual, patch);
  }

  previewClone(id: string, newId: string, patch?: VisualPatch): VisualSpec {
    const source = this.#scene.visuals[id];
    if (!source) throw new Error(`not_found: visual ${id}`);
    if (this.#scene.visuals[newId]) throw new Error(`already_exists: visual ${newId}`);
    const visual = clone(source);
    visual.id = newId;
    visual.derived_from = id;
    return patch ? applyVisualPatch(visual, patch) : visual;
  }

  #assertRevision(expectedRevision?: number): void {
    if (expectedRevision !== undefined && expectedRevision !== this.#scene.revision) {
      throw new RevisionConflictError(expectedRevision, this.#scene.revision);
    }
  }

  #commit(operation: Omit<HistoryRecord, "revision" | "parent_revision" | "timestamp">, mutator: (draft: Scene) => void, expectedRevision?: number): Scene {
    this.#assertRevision(expectedRevision);
    const draft = clone(this.#scene);
    mutator(draft);
    draft.revision = this.#history.nextRevision();
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
      draft.visuals[id] = normalizeVisual(applyVisualPatch(visual, patch));
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
      if (patch) visual = applyVisualPatch(visual, patch);
      draft.visuals[newId] = normalizeVisual(visual);
    }, expectedRevision);
    return { revision: scene.revision, visual: clone(scene.visuals[newId]) };
  }

  createVisual(visual: VisualSpec, expectedRevision?: number): VisualMutationResult {
    const scene = this.#commit({ operation: "visual.create", target: visual.id, input: visual as unknown as JsonValue }, (draft) => {
      if (draft.visuals[visual.id]) throw new Error(`already_exists: visual ${visual.id}`);
      draft.visuals[visual.id] = normalizeVisual(clone(visual));
    }, expectedRevision);
    return { revision: scene.revision, visual: clone(scene.visuals[visual.id]) };
  }

  /** Applies a fully validated ephemeral work result through one durable revision. */
  commitWork(materialized: Scene, input: JsonValue, expectedRevision?: number): SceneMutationResult {
    if (materialized.canvas_id !== this.#scene.canvas_id) throw new Error("work_canvas_mismatch");
    const normalized = normalizeScene(clone(materialized));
    const scene = this.#commit({ operation: "work.commit", input }, (draft) => {
      draft.datasets = clone(normalized.datasets);
      draft.visuals = clone(normalized.visuals);
      draft.annotations = clone(normalized.annotations);
      draft.canvas = clone(normalized.canvas);
    }, expectedRevision);
    return { revision: scene.revision };
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
        const updates = normalizeLayoutUpdates(input);
        let changed = false;
        for (const update of updates) {
          const object = update.target.kind === "visual" ? draft.visuals[update.target.id] : draft.annotations[update.target.id];
          if (!object) throw new Error(`not_found: ${update.target.kind} ${update.target.id}`);
          if (!layoutsEqual(object.layout, update.layout)) changed = true;
        }
        if (input.layout_updates && !changed) throw new Error("no_op: layout batch unchanged");
        for (const update of updates) {
          if (update.target.kind === "visual") draft.visuals[update.target.id].layout = clone(update.layout);
          else draft.annotations[update.target.id].layout = clone(update.layout);
        }
        return;
      }
      if (input.action === "group") {
        if (!input.target || !input.targets?.length) throw new Error("invalid_compose: group target and targets required");
        if (input.targets.some((id) => !draft.visuals[id])) throw new Error("not_found: visual");
        draft.canvas.groups = (draft.canvas.groups ?? []).filter((group) => group.id !== input.target);
        draft.canvas.groups.push({ id: input.target, visual_ids: [...input.targets] });
        return;
      }
      if (input.action === "ungroup") {
        if (!input.target) throw new Error("invalid_compose: group target required");
        draft.canvas.groups = (draft.canvas.groups ?? []).filter((group) => group.id !== input.target);
        return;
      }
      if (input.action === "arrange") {
        if (!input.targets?.length || !input.arrangement) throw new Error("invalid_compose: targets and arrangement required");
        const visuals = input.targets.map((id) => draft.visuals[id]);
        if (visuals.some((visual) => !visual)) throw new Error("not_found: visual");
        const first = visuals[0].layout;
        if (input.arrangement === "grid") {
          const columns = Math.ceil(Math.sqrt(visuals.length));
          visuals.forEach((visual, index) => {
            const column = index % columns;
            const row = Math.floor(index / columns);
            visual.layout = { ...visual.layout, x: first.x + column * first.w, y: first.y + row * first.h };
          });
          return;
        }
        if (input.arrangement === "compact") {
          visuals.forEach((visual, index) => {
            visual.layout = { ...visual.layout, x: first.x + index * first.w, y: first.y };
          });
          return;
        }
        visuals.forEach((visual, index) => {
          if (input.arrangement === "row") visual.layout = { ...visual.layout, x: first.x + index * visual.layout.w, y: first.y };
          if (input.arrangement === "column") visual.layout = { ...visual.layout, x: first.x, y: first.y + index * visual.layout.h };
        });
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

  patchAnnotation(id: string, patch: AnnotationPatch, expectedRevision?: number): SceneMutationResult {
    const scene = this.#commit({ operation: "canvas.annotate", target: id, input: { mode: "patch", id, patch } as unknown as JsonValue }, (draft) => {
      const annotation = draft.annotations[id];
      if (!annotation) throw new Error(`not_found: annotation ${id}`);
      const next = applyAnnotationPatch(annotation, patch);
      if (next.target && !draft.visuals[next.target]) throw new Error(`not_found: visual ${next.target}`);
      draft.annotations[id] = next;
    }, expectedRevision);
    return { revision: scene.revision };
  }

  historyRecords(): HistoryRecord[] {
    return this.#history.records();
  }

  historySnapshots(): Scene[] {
    return this.#history.revisions().map((revision) => this.#history.snapshotAt(revision));
  }

  historyCheckpoints(): Record<string, number> {
    return this.#history.checkpoints();
  }

  historyForks() {
    return this.#history.forks();
  }

  applyHistory(input: HistoryApplyInput): HistoryMutationResult {
    this.#assertRevision(input.expected_revision);
    let revision: number | undefined;
    if (input.action === "goto") revision = input.revision ?? (input.label ? this.#history.checkpointRevision(input.label) : undefined);
    if (input.action === "undo") revision = this.#history.parentRevision(this.#scene.revision);
    if (input.action === "redo") revision = this.#history.childRevisions(this.#scene.revision)[0];
    if (input.action === "checkpoint") {
      if (!input.label) throw new Error("invalid_checkpoint");
      this.#history.checkpoint(input.label, this.#scene.revision);
      return { revision: this.#scene.revision, checkpoint: input.label };
    }
    if (input.action === "fork") {
      const parentRevision = input.revision ?? (input.label ? this.#history.checkpointRevision(input.label) : this.#scene.revision);
      if (parentRevision === undefined) throw new Error("history_not_found: fork");
      const fork = this.#history.fork(this.#scene.canvas_id, parentRevision);
      return { revision: this.#scene.revision, parent_revision: fork.parent_revision, branch_id: fork.branch_id };
    }
    if (revision === undefined) throw new Error(`history_not_found: ${input.action}`);
    this.#scene = this.#history.snapshotAt(revision);
    return { revision: this.#scene.revision };
  }
}
