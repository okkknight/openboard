import { observe, type Observation } from "../core/observation.js";
import { assertRenderable, compileQuery } from "../core/query-compiler.js";
import { RevisionConflictError, SceneStore, type HistoryMutationResult } from "../core/scene-store.js";
import type { HistoryStoreSeed } from "../core/history-store.js";
import type { AnnotationSpec, ComposeInput, DatasetSpec, EffectiveScene, HistoryApplyInput, JsonObject, QuerySpec, Scene, VisualPatch, VisualSpec, WorkingVisual, WorkingVisualDraft, WorkActivity, WorkSession } from "../core/types.js";
import { DuckDbEngine, type InspectOptions, type DatasetInspection } from "../data/duckdb-engine.js";
import { compilePlot, type PlotConfig } from "../render/plot-compiler.js";
import { EventBus, type SceneEvent } from "./event-bus.js";
import { Persistence } from "./persistence.js";
import { WorkSessionStore } from "./work-session-store.js";

export interface RuntimeResult {
  status: "rendered" | "working";
  canvas_id: string;
  revision: number;
  result: { visual: WorkingVisual; rows: number; columns: string[]; plot: PlotConfig };
  observation: Observation;
}

interface RenderPayload { rows: JsonObject[]; columns: string[]; plot: PlotConfig; observation: Observation; }
interface RenderArtifact { visual: VisualSpec; revision: number; payload: RenderPayload; generation: number; }

export interface RuntimeOptions { point_limit?: number; engine?: DuckDbEngine; }

const emptyObservation = (): Observation => ({ row_count: 0, numeric: {}, categories: {}, ordered: {}, missing: {}, outliers: [] });

function isCompleteVisual(visual: WorkingVisual | undefined): visual is VisualSpec {
  if (!visual || typeof visual.source !== "string" || !visual.source || !visual.query || !Array.isArray(visual.marks) || !visual.layout) return false;
  const layout = visual.layout as unknown as Record<string, unknown>;
  return ["x", "y", "w", "h"].every((key) => typeof layout[key] === "number") && visual.layout.w > 0 && visual.layout.h > 0;
}

export class DataCanvasRuntime {
  #store: SceneStore;
  #engine: DuckDbEngine;
  #events = new EventBus();
  #works = new WorkSessionStore();
  #artifacts = new Map<string, RenderArtifact>();
  #artifactPromises = new Map<string, Promise<RenderArtifact>>();
  #artifactGenerations = new Map<string, number>();
  #persistence?: Persistence;
  #persistedHistoryLength = 0;
  #pointLimit: number;

  constructor(scene: Scene, persistence?: Persistence, historySeed?: HistoryStoreSeed, options: RuntimeOptions = {}) {
    this.#store = new SceneStore(scene, historySeed);
    this.#engine = options.engine ?? new DuckDbEngine();
    this.#persistence = persistence;
    this.#persistedHistoryLength = historySeed?.records?.length ?? 0;
    this.#pointLimit = options.point_limit ?? 50_000;
  }

  onEvent(listener: (event: SceneEvent) => void): () => void { return this.#events.on(listener); }
  inspect(): Scene { return this.#store.inspect(); }
  pointLimit(): number { return this.#pointLimit; }
  close(): void { this.#engine.close(); }
  inspectWorkSnapshots(): Array<{ work: WorkSession; effective_scene: EffectiveScene }> {
    const durable = this.#store.inspect();
    return this.#works.list().map((work) => ({ work, effective_scene: this.#works.effectiveScene(work.id, durable) }));
  }

  async workApply(input: { action: "begin" | "commit" | "cancel"; work_id?: string }): Promise<{ status: "ok"; canvas_id: string; revision: number; result: { work_id: string; base_revision: number; sequence: number } }> {
    if (input.action === "begin") {
      const work = this.#works.begin(this.#store.inspect());
      this.#emitWork("work.started", work);
      return this.#workResult(work);
    }
    if (!input.work_id) throw new Error("invalid_work: work_id required");
    if (input.action === "cancel") {
      const cancelled = this.#works.cancel(input.work_id);
      this.#clearWorkArtifacts(cancelled.id);
      this.#emitWork("work.cancelled", cancelled);
      return this.#workResult(cancelled);
    }
    const work = this.#works.get(input.work_id);
    const durable = this.#store.inspect();
    if (durable.revision !== work.base_revision) throw new RevisionConflictError(work.base_revision, durable.revision);
    const materialized = this.#works.materializeForCommit(work.id, durable);
    this.#works.next(work.id, "committing");
    const mutation = this.#store.commitWork(materialized, { work_id: work.id, operation_count: work.overlay.operations }, work.base_revision);
    await this.#persist();
    this.#promoteWorkArtifacts(work.id, mutation.revision);
    const completed = this.#works.complete(work.id);
    this.#emitWork("work.completed", completed, undefined, mutation.revision);
    return { status: "ok", canvas_id: durable.canvas_id, revision: mutation.revision, result: { work_id: completed.id, base_revision: completed.base_revision, sequence: completed.sequence } };
  }

  async dataInspect(id: string, options: InspectOptions = {}, workId?: string): Promise<DatasetInspection> {
    if (!workId) return this.#engine.inspect(this.#dataset(id), options);
    return this.#withActivity(workId, "inspect", `Inspecting ${id}`, () => this.#engine.inspect(this.#dataset(id), options));
  }

  async dataQuery(id: string, query: QuerySpec, workId?: string): Promise<{ columns: string[]; data: JsonObject[]; observation: Observation }> {
    const execute = async () => {
      const dataset = this.#dataset(id);
      const profile = await this.#engine.inspect(dataset, { fields: [], sample_rows: 0 });
      const compiled = compileQuery(dataset.id, profile.columns?.map((column) => column.name) ?? [], query);
      const result = query.sql ? await this.#engine.queryRaw(dataset, compiled.sql) : await this.#engine.query(dataset, compiled);
      const numericFields = (query.measures ?? []).map((measure) => measure.alias);
      const categoryFields = (query.dimensions ?? []).map((dimension) => dimension.alias ?? (dimension.time_grain ? `${dimension.field}_${dimension.time_grain}` : dimension.field));
      return { columns: result.columns, data: result.rows, observation: observe(result.rows, { numericFields, categoryFields, orderField: categoryFields[0] }) };
    };
    return workId ? this.#withActivity(workId, "query", `Querying ${id}`, execute) : execute();
  }

  async renderVisual(id: string, workId?: string): Promise<RuntimeResult> {
    const durable = this.#store.inspect();
    const scene = workId ? this.#works.effectiveScene(workId, durable) : durable;
    const visual = scene.visuals[id];
    if (!visual) throw new Error(`not_found: visual ${id}`);
    if (!isCompleteVisual(visual)) return this.#workingResponse(visual, durable.revision);
    const key = this.#artifactKey(id, durable.revision, workId);
    const artifact = await this.#artifactFor(key, visual, durable.revision, workId);
    return this.#response(artifact.visual, artifact.revision, artifact.payload);
  }

  async visualCreate(visual: VisualSpec | WorkingVisualDraft, expectedRevision?: number, workId?: string): Promise<RuntimeResult> {
    if (!workId) {
      return this.#implicitWork(expectedRevision, (id) => this.visualCreate(visual, undefined, id));
    }
    const work = this.#works.createDraft(workId, visual);
    this.#clearWorkArtifact(workId, visual.id);
    this.#emitWork("work.visual.changed", work, visual.id);
    return this.#renderWorkingVisual(workId, visual.id);
  }

  async visualPatch(id: string, patch: VisualPatch, expectedRevision?: number, workId?: string): Promise<RuntimeResult> {
    if (!workId) {
      return this.#implicitWork(expectedRevision, (work) => this.visualPatch(id, patch, undefined, work));
    }
    const work = this.#works.patchVisual(workId, id, patch, this.#store.inspect());
    this.#clearWorkArtifact(workId, id);
    this.#emitWork("work.visual.changed", work, id);
    return this.#renderWorkingVisual(workId, id);
  }

  async visualClone(id: string, newId: string, patch?: VisualPatch, expectedRevision?: number, workId?: string): Promise<RuntimeResult> {
    if (!workId) {
      return this.#implicitWork(expectedRevision, (work) => this.visualClone(id, newId, patch, undefined, work));
    }
    const source = this.#works.effectiveScene(workId, this.#store.inspect()).visuals[id];
    if (!source) throw new Error(`not_found: visual ${id}`);
    const copy = { ...structuredClone(source), id: newId, derived_from: id } as WorkingVisualDraft;
    let work = this.#works.createDraft(workId, copy);
    if (patch) work = this.#works.patchVisual(workId, newId, patch, this.#store.inspect());
    this.#clearWorkArtifact(workId, newId);
    this.#emitWork("work.visual.changed", work, newId);
    return this.#renderWorkingVisual(workId, newId);
  }

  async canvasCompose(input: ComposeInput, expectedRevision?: number, workId?: string): Promise<{ status: "ok"; canvas_id: string; revision: number }> {
    if (workId) {
      const work = this.#works.compose(workId, input, this.#store.inspect());
      if (input.target) this.#clearWorkArtifact(workId, input.target);
      this.#emitWork("work.visual.changed", work, input.target);
      return { status: "ok", canvas_id: this.#store.inspect().canvas_id, revision: this.#store.inspect().revision };
    }
    const mutation = this.#store.compose(input, expectedRevision);
    await this.#persist();
    const scene = this.#store.inspect();
    if (input.action === "focus") this.#events.emit({ type: "focus.changed", canvas_id: scene.canvas_id, revision: mutation.revision, visual_id: input.target });
    else if (input.action === "delete") this.#events.emit({ type: "visual.removed", canvas_id: scene.canvas_id, revision: mutation.revision, visual_id: input.target });
    else this.#events.emit({ type: "layout.changed", canvas_id: scene.canvas_id, revision: mutation.revision, affected_ids: input.targets ?? (input.target ? [input.target] : []) });
    return { status: "ok", canvas_id: scene.canvas_id, revision: mutation.revision };
  }

  async canvasAnnotate(annotation: AnnotationSpec, expectedRevision?: number, workId?: string): Promise<{ status: "ok"; canvas_id: string; revision: number }> {
    if (workId) {
      const work = this.#works.annotate(workId, annotation);
      this.#emitWork("work.visual.changed", work, annotation.target);
      return { status: "ok", canvas_id: this.#store.inspect().canvas_id, revision: this.#store.inspect().revision };
    }
    const mutation = this.#store.annotate(annotation, expectedRevision);
    await this.#persist();
    const scene = this.#store.inspect();
    this.#events.emit({ type: "annotation.created", canvas_id: scene.canvas_id, revision: mutation.revision, annotation_id: annotation.id });
    return { status: "ok", canvas_id: scene.canvas_id, revision: mutation.revision };
  }

  async historyApply(input: HistoryApplyInput): Promise<{ status: "ok"; canvas_id: string; revision: number; result?: { checkpoint?: string; parent_revision?: number; branch_id?: string } }> {
    const mutation = this.#store.applyHistory(input);
    await this.#persist();
    const scene = this.#store.inspect();
    const result = this.#historyResult(mutation);
    this.#events.emit({ type: "history.changed", canvas_id: scene.canvas_id, revision: mutation.revision });
    return result ? { status: "ok", canvas_id: scene.canvas_id, revision: mutation.revision, result } : { status: "ok", canvas_id: scene.canvas_id, revision: mutation.revision };
  }

  async #renderWorkingVisual(workId: string, id: string): Promise<RuntimeResult> {
    const durable = this.#store.inspect();
    const visual = this.#works.effectiveScene(workId, durable).visuals[id];
    if (!visual) throw new Error(`not_found: visual ${id}`);
    if (!isCompleteVisual(visual)) return this.#workingResponse(visual, durable.revision);
    const key = this.#artifactKey(id, durable.revision, workId);
    const artifact = await this.#artifactFor(key, visual, durable.revision, workId);
    const changed = this.#works.next(workId);
    this.#emitWork("work.visual.changed", changed, id);
    return this.#response(artifact.visual, artifact.revision, artifact.payload);
  }

  async #implicitWork<T extends { revision: number }>(expectedRevision: number | undefined, operation: (workId: string) => Promise<T>): Promise<T> {
    const durable = this.#store.inspect();
    if (expectedRevision !== undefined && expectedRevision !== durable.revision) throw new RevisionConflictError(expectedRevision, durable.revision);
    const work = this.#works.begin(durable);
    this.#emitWork("work.started", work);
    try {
      const result = await operation(work.id);
      const committed = await this.workApply({ action: "commit", work_id: work.id });
      return { ...result, revision: committed.revision };
    } catch (error) {
      try { this.#works.get(work.id); await this.workApply({ action: "cancel", work_id: work.id }); } catch { /* terminal work or failed cleanup */ }
      throw error;
    }
  }

  async #artifactFor(key: string, visual: VisualSpec, revision: number, workId?: string): Promise<RenderArtifact> {
    const generation = this.#artifactGenerations.get(key) ?? 0;
    const cached = this.#artifacts.get(key);
    if (cached?.generation === generation) return cached;
    const requestKey = `${key}@${generation}`;
    const inFlight = this.#artifactPromises.get(requestKey);
    if (inFlight) return inFlight;
    const promise = (async () => {
      const payload = workId
        ? await this.#withActivity(workId, "render", `Rendering ${visual.id}`, () => this.#render(visual))
        : await this.#render(visual);
      const artifact = { visual: structuredClone(visual), revision, payload, generation };
      if ((this.#artifactGenerations.get(key) ?? 0) === generation) this.#artifacts.set(key, artifact);
      return artifact;
    })();
    this.#artifactPromises.set(requestKey, promise);
    try {
      return await promise;
    } finally {
      this.#artifactPromises.delete(requestKey);
    }
  }

  async #withActivity<T>(workId: string, kind: WorkActivity["kind"], label: string, operation: () => Promise<T>): Promise<T> {
    const started = this.#works.setActivity(workId, { kind, status: "started", label });
    this.#emitWork("work.activity", started);
    try {
      const result = await operation();
      const completed = this.#works.setActivity(workId, { kind, status: "completed", label });
      this.#emitWork("work.activity", completed);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = this.#works.setActivity(workId, { kind, status: "failed", label, error: message });
      this.#emitWork("work.failed", failed);
      throw error;
    }
  }

  #emitWork(type: Extract<SceneEvent["type"], `work.${string}`>, work: WorkSession, visualId?: string, revision = this.#store.inspect().revision): void {
    let effective: EffectiveScene | undefined;
    if (type !== "work.completed" && type !== "work.cancelled") {
      try { effective = this.#works.effectiveScene(work.id, this.#store.inspect()); } catch { /* terminal session has no overlay */ }
    }
    this.#events.emit({ type, canvas_id: this.#store.inspect().canvas_id, revision, visual_id: visualId, work_id: work.id, base_revision: work.base_revision, sequence: work.sequence, activity: work.activity, work, effective_scene: effective });
  }

  async #render(visual: VisualSpec): Promise<RenderPayload> {
    const dataset = this.#dataset(visual.source);
    const profile = await this.#engine.inspect(dataset, { fields: [], sample_rows: 0 });
    const query = compileQuery(dataset.id, profile.columns?.map((column) => column.name) ?? [], visual.query);
    const result = visual.query.sql ? await this.#engine.queryRaw(dataset, query.sql) : await this.#engine.query(dataset, query);
    assertRenderable(result.rows.length, this.#pointLimit, visual.query.sample);
    const numericFields = (visual.query.measures ?? []).map((measure) => measure.alias);
    const categoryFields = (visual.query.dimensions ?? []).map((dimension) => dimension.alias ?? (dimension.time_grain ? `${dimension.field}_${dimension.time_grain}` : dimension.field));
    return { rows: result.rows, columns: result.columns, plot: compilePlot(visual, result.rows), observation: observe(result.rows, { numericFields, categoryFields, orderField: categoryFields[0] }) };
  }

  #dataset(id: string): DatasetSpec {
    const dataset = this.#store.inspect().datasets[id];
    if (!dataset) throw new Error(`not_found: dataset ${id}`);
    return dataset;
  }
  #response(visual: VisualSpec, revision: number, payload: RenderPayload): RuntimeResult {
    return { status: "rendered", canvas_id: this.#store.inspect().canvas_id, revision, result: { visual, rows: payload.rows.length, columns: payload.columns, plot: payload.plot }, observation: payload.observation };
  }
  #workingResponse(visual: WorkingVisual, revision: number): RuntimeResult {
    return { status: "working", canvas_id: this.#store.inspect().canvas_id, revision, result: { visual, rows: 0, columns: [], plot: { data: [], marks: [] } }, observation: emptyObservation() };
  }
  #workResult(work: WorkSession): { status: "ok"; canvas_id: string; revision: number; result: { work_id: string; base_revision: number; sequence: number } } {
    return { status: "ok", canvas_id: this.#store.inspect().canvas_id, revision: this.#store.inspect().revision, result: { work_id: work.id, base_revision: work.base_revision, sequence: work.sequence } };
  }
  #artifactKey(id: string, revision: number, workId?: string): string { return workId ? `work:${workId}:${id}` : `scene:${revision}:${id}`; }
  #clearWorkArtifact(workId: string, id: string): void {
    const key = this.#artifactKey(id, this.#store.inspect().revision, workId);
    this.#artifacts.delete(key);
    this.#artifactGenerations.set(key, (this.#artifactGenerations.get(key) ?? 0) + 1);
  }

  #clearWorkArtifacts(workId: string): void {
    for (const key of this.#artifacts.keys()) if (key.startsWith(`work:${workId}:`)) this.#artifacts.delete(key);
    for (const key of this.#artifactGenerations.keys()) if (key.startsWith(`work:${workId}:`)) this.#artifactGenerations.delete(key);
  }
  #promoteWorkArtifacts(workId: string, revision: number): void {
    for (const [key, artifact] of this.#artifacts) if (key.startsWith(`work:${workId}:`)) {
      const id = key.slice(`work:${workId}:`.length);
      this.#artifacts.set(this.#artifactKey(id, revision), { ...artifact, revision, generation: 0 });
      this.#artifacts.delete(key);
    }
  }
  async #persist(): Promise<void> {
    if (!this.#persistence) return;
    const scene = this.#store.inspect();
    await this.#persistence.saveScene(scene);
    await this.#persistence.saveSnapshot(scene);
    await this.#persistence.saveMetadata({ checkpoints: this.#store.historyCheckpoints(), forks: this.#store.historyForks() });
    const records = this.#store.historyRecords();
    for (const record of records.slice(this.#persistedHistoryLength)) await this.#persistence.appendHistory(record);
    this.#persistedHistoryLength = records.length;
  }
  #historyResult(mutation: HistoryMutationResult): { checkpoint?: string; parent_revision?: number; branch_id?: string } | undefined {
    const result: { checkpoint?: string; parent_revision?: number; branch_id?: string } = {};
    if (mutation.checkpoint) result.checkpoint = mutation.checkpoint;
    if (mutation.parent_revision !== undefined) result.parent_revision = mutation.parent_revision;
    if (mutation.branch_id) result.branch_id = mutation.branch_id;
    return Object.keys(result).length ? result : undefined;
  }
}
