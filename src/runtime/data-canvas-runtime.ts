import { observe, type Observation } from "../core/observation.js";
import { assertRenderable, compileQuery } from "../core/query-compiler.js";
import { RevisionConflictError, SceneStore, type HistoryMutationResult } from "../core/scene-store.js";
import type { HistoryStoreSeed } from "../core/history-store.js";
import type { AnnotationMutation, AnnotationSpec, CanvasObjectRef, ComposeInput, DatasetSpec, EffectiveScene, HistoryApplyInput, JsonObject, QuerySpec, RenderIdentityContract, Scene, VisualPatch, VisualSpec, WorkingVisual, WorkingVisualDraft, WorkActivity, WorkSession } from "../core/types.js";
import { DuckDbEngine, type InspectOptions, type DatasetInspection } from "../data/duckdb-engine.js";
import { compilePlot, type PlotConfig } from "../render/plot-compiler.js";
import { EventBus, type SceneEvent } from "./event-bus.js";
import { Persistence } from "./persistence.js";
import { createTrace, type PerformanceTrace } from "./performance-trace.js";
import { QueryArtifactStore, type QueryArtifact } from "./query-artifact-store.js";
import { WorkSessionStore } from "./work-session-store.js";

export interface RuntimeResult {
  status: "rendered" | "working";
  canvas_id: string;
  revision: number;
  result: { visual: WorkingVisual; rows: number; columns: string[]; plot: PlotConfig; artifact: RenderArtifactV2 };
  observation: Observation;
}

interface RenderPayload { rows: JsonObject[]; columns: string[]; plot: PlotConfig; observation: Observation; }
interface RenderArtifact { visual: VisualSpec; revision: number; payload: RenderPayload; generation: number; cache_generation: number; stream_state: "partial" | "complete"; }

export interface RenderArtifactV2 {
  artifact_version: 2;
  visual_id: string;
  generation: number;
  revision: number;
  stream_state: "partial" | "complete";
  work_id?: string;
  identity: RenderIdentityContract;
}

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
  #artifactsByGeneration = new Map<string, RenderArtifact>();
  #artifactPromises = new Map<string, Promise<RenderArtifact>>();
  #artifactGenerations = new Map<string, number>();
  #streamArtifactGenerations = new Map<string, number>();
  #traces = new Map<string, PerformanceTrace>();
  #queryArtifacts = new QueryArtifactStore();
  #persistence?: Persistence;
  #pointLimit: number;

  constructor(scene: Scene, persistence?: Persistence, historySeed?: HistoryStoreSeed, options: RuntimeOptions = {}) {
    this.#store = new SceneStore(scene, historySeed);
    this.#engine = options.engine ?? new DuckDbEngine();
    this.#persistence = persistence;
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
      const trace = createTrace();
      trace.mark("work_started");
      this.#traces.set(work.id, trace);
      this.#emitWork("work.started", work);
      return this.#workResult(work);
    }
    if (!input.work_id) throw new Error("invalid_work: work_id required");
    if (input.action === "cancel") {
      const cancelled = this.#works.cancel(input.work_id);
      this.#clearWorkArtifacts(cancelled.id);
      this.#queryArtifacts.clearWork(cancelled.id);
      this.#emitWork("work.cancelled", cancelled, undefined, undefined, this.#affectedVisualIds(cancelled));
      this.#traces.delete(cancelled.id);
      return this.#workResult(cancelled);
    }
    const work = this.#works.get(input.work_id);
    const affectedIds = this.#affectedVisualIds(work);
    const durable = this.#store.inspect();
    if (durable.revision !== work.base_revision) throw new RevisionConflictError(work.base_revision, durable.revision);
    const materialized = this.#works.materializeForCommit(work.id, durable);
    const beforeCommit = this.#store.snapshotState();
    this.#works.next(work.id, "committing");
    let mutation: HistoryMutationResult;
    try {
      mutation = this.#store.commitWork(materialized, { work_id: work.id, operation_count: work.overlay.operations }, work.base_revision);
      await this.#persist();
    } catch (error) {
      this.#store.restoreState(beforeCommit);
      const restored = this.#works.next(work.id, "active");
      this.#emitWork("work.failed", restored, undefined, undefined, affectedIds);
      throw error;
    }
    this.#promoteWorkArtifacts(work.id, mutation.revision);
    const completed = this.#works.complete(work.id);
    this.#traces.get(work.id)?.mark("work_committed");
    this.#emitWork("work.completed", completed, undefined, mutation.revision, affectedIds);
    this.#queryArtifacts.clearWork(work.id);
    this.#traces.delete(work.id);
    return { status: "ok", canvas_id: durable.canvas_id, revision: mutation.revision, result: { work_id: completed.id, base_revision: completed.base_revision, sequence: completed.sequence } };
  }

  async dataInspect(id: string, options: InspectOptions = {}, workId?: string): Promise<DatasetInspection> {
    if (!workId) return this.#engine.inspect(this.#dataset(id), options);
    return this.#withActivity(workId, "inspect", `Inspecting ${id}`, () => this.#engine.inspect(this.#dataset(id), options));
  }

  async dataQuery(id: string, query: QuerySpec, workId?: string): Promise<{ columns: string[]; data: JsonObject[]; observation: Observation }> {
    const execute = async () => {
      const artifact = await this.#queryArtifact(id, query, workId);
      return { columns: artifact.columns, data: artifact.rows, observation: artifact.observation };
    };
    return workId ? this.#withActivity(workId, "query", `Querying ${id}`, execute) : execute();
  }

  async renderVisual(id: string, workId?: string, artifactGeneration?: number): Promise<RuntimeResult> {
    const durable = this.#store.inspect();
    const scene = workId ? this.#works.effectiveScene(workId, durable) : durable;
    const visual = scene.visuals[id];
    if (!visual) throw new Error(`not_found: visual ${id}`);
    if (!isCompleteVisual(visual)) return this.#workingResponse(visual, durable.revision);
    const key = this.#artifactKey(id, durable.revision, workId);
    if (artifactGeneration !== undefined) {
      const artifact = this.#artifactsByGeneration.get(this.#artifactGenerationKey(key, artifactGeneration));
      if (!artifact) throw new Error(`not_found: render artifact ${artifactGeneration}`);
      return this.#response(artifact, workId);
    }
    const cacheGeneration = this.#artifactGenerations.get(key) ?? 0;
    if (workId && this.#artifactPromises.has(`${key}@${cacheGeneration}`)) {
      const latest = this.#artifacts.get(key);
      return latest ? this.#response(latest, workId) : this.#workingResponse(visual, durable.revision);
    }
    const artifact = await this.#artifactFor(key, visual, durable.revision, workId);
    return this.#response(artifact, workId);
  }

  async visualCreate(visual: VisualSpec | WorkingVisualDraft, expectedRevision?: number, workId?: string): Promise<RuntimeResult> {
    const explicitWorkId = this.#requireWork(workId);
    this.#assertExpectedRevision(expectedRevision);
    const work = this.#works.createDraft(explicitWorkId, visual, this.#store.inspect());
    this.#clearWorkArtifact(explicitWorkId, visual.id);
    this.#emitWork("work.visual.changed", work, visual.id);
    return this.#renderWorkingVisual(explicitWorkId, visual.id);
  }

  async visualPatch(id: string, patch: VisualPatch, expectedRevision?: number, workId?: string): Promise<RuntimeResult> {
    const explicitWorkId = this.#requireWork(workId);
    this.#assertExpectedRevision(expectedRevision);
    const work = this.#works.patchVisual(explicitWorkId, id, patch, this.#store.inspect());
    this.#clearWorkArtifact(explicitWorkId, id);
    this.#emitWork("work.visual.changed", work, id);
    return this.#renderWorkingVisual(explicitWorkId, id);
  }

  async visualClone(id: string, newId: string, patch?: VisualPatch, expectedRevision?: number, workId?: string): Promise<RuntimeResult> {
    const explicitWorkId = this.#requireWork(workId);
    this.#assertExpectedRevision(expectedRevision);
    const source = this.#works.effectiveScene(explicitWorkId, this.#store.inspect()).visuals[id];
    if (!source) throw new Error(`not_found: visual ${id}`);
    const copy = { ...structuredClone(source), id: newId, derived_from: id } as WorkingVisualDraft;
    let work = this.#works.createDraft(explicitWorkId, copy, this.#store.inspect());
    if (patch) work = this.#works.patchVisual(explicitWorkId, newId, patch, this.#store.inspect());
    this.#clearWorkArtifact(explicitWorkId, newId);
    this.#emitWork("work.visual.changed", work, newId);
    return this.#renderWorkingVisual(explicitWorkId, newId);
  }

  async canvasCompose(input: ComposeInput, expectedRevision?: number, workId?: string): Promise<{ status: "ok"; canvas_id: string; revision: number }> {
    const affectedObjects: CanvasObjectRef[] = (input.layout_updates ?? (input.target ? [{ target: { kind: "visual", id: input.target }, layout: input.layout! }] : []))
      .map((update) => structuredClone(update.target));
    const affectedVisualIds = affectedObjects.filter((target) => target.kind === "visual").map((target) => target.id);
    if (workId) {
      const work = this.#works.compose(workId, input, this.#store.inspect());
      for (const id of affectedVisualIds) this.#clearWorkArtifact(workId, id);
      this.#emitWork("work.visual.changed", work, input.target, undefined, affectedVisualIds);
      return { status: "ok", canvas_id: this.#store.inspect().canvas_id, revision: this.#store.inspect().revision };
    }
    const mutation = this.#store.compose(input, expectedRevision);
    await this.#persist();
    const scene = this.#store.inspect();
    if (input.action === "focus") this.#events.emit({ type: "focus.changed", canvas_id: scene.canvas_id, revision: mutation.revision, visual_id: input.target });
    else if (input.action === "delete") this.#events.emit({ type: "visual.removed", canvas_id: scene.canvas_id, revision: mutation.revision, visual_id: input.target });
    else this.#events.emit({ type: "layout.changed", canvas_id: scene.canvas_id, revision: mutation.revision, affected_ids: affectedVisualIds.length ? affectedVisualIds : input.targets ?? [], affected_objects: affectedObjects });
    return { status: "ok", canvas_id: scene.canvas_id, revision: mutation.revision };
  }

  async canvasAnnotate(input: AnnotationMutation, expectedRevision?: number, workId?: string): Promise<{ status: "ok"; canvas_id: string; revision: number }> {
    if (input.mode === "patch") {
      if (workId) {
        const work = this.#works.patchAnnotation(workId, input.id, input.patch, this.#store.inspect());
        this.#emitWork("work.visual.changed", work);
        return { status: "ok", canvas_id: this.#store.inspect().canvas_id, revision: this.#store.inspect().revision };
      }
      const mutation = this.#store.patchAnnotation(input.id, input.patch, expectedRevision);
      await this.#persist();
      const scene = this.#store.inspect();
      this.#events.emit({ type: "annotation.changed", canvas_id: scene.canvas_id, revision: mutation.revision, annotation_id: input.id, affected_objects: [{ kind: "annotation", id: input.id }] });
      return { status: "ok", canvas_id: scene.canvas_id, revision: mutation.revision };
    }
    const annotation: AnnotationSpec = { id: input.id ?? `a${Object.keys(this.#store.inspect().annotations).length + 1}`, target: input.target, text: input.text, anchor: input.anchor, layout: input.layout, style: input.style, created_at: new Date().toISOString() };
    if (workId) {
      const work = this.#works.annotate(workId, annotation, this.#store.inspect());
      this.#emitWork("work.visual.changed", work, annotation.target);
      return { status: "ok", canvas_id: this.#store.inspect().canvas_id, revision: this.#store.inspect().revision };
    }
    const mutation = this.#store.annotate(annotation, expectedRevision);
    await this.#persist();
    const scene = this.#store.inspect();
    this.#events.emit({ type: "annotation.created", canvas_id: scene.canvas_id, revision: mutation.revision, annotation_id: annotation.id, affected_objects: [{ kind: "annotation", id: annotation.id }] });
    return { status: "ok", canvas_id: scene.canvas_id, revision: scene.revision };
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
    return this.#response(artifact, workId);
  }

  async #artifactFor(key: string, visual: VisualSpec, revision: number, workId?: string): Promise<RenderArtifact> {
    const generation = this.#artifactGenerations.get(key) ?? 0;
    const cached = this.#artifacts.get(key);
    if (cached?.cache_generation === generation) return cached;
    const requestKey = `${key}@${generation}`;
    const inFlight = this.#artifactPromises.get(requestKey);
    if (inFlight) return inFlight;
    const promise = (async () => {
      if (workId) return this.#withActivity(workId, "render", `Streaming ${visual.id}`, () => this.#renderStream(key, visual, revision, workId), visual.id);
      const payload = await this.#render(visual);
      const artifact = { visual: structuredClone(visual), revision, payload, generation: this.#nextStreamArtifactGeneration(key), cache_generation: generation, stream_state: "complete" as const };
      this.#storeArtifact(key, artifact);
      return artifact;
    })();
    this.#artifactPromises.set(requestKey, promise);
    try {
      return await promise;
    } finally {
      this.#artifactPromises.delete(requestKey);
    }
  }

  async #withActivity<T>(workId: string, kind: WorkActivity["kind"], label: string, operation: () => Promise<T>, visualId?: string): Promise<T> {
    if (kind === "query") this.#traces.get(workId)?.mark("query_started");
    const activity = { kind, status: "started" as const, label, ...(visualId ? { visual_id: visualId } : {}) };
    const started = this.#works.setActivity(workId, activity);
    this.#emitWork("work.activity", started, visualId);
    try {
      const result = await operation();
      if (kind === "query") this.#traces.get(workId)?.mark("query_completed");
      const completed = this.#works.setActivity(workId, { ...activity, status: "completed" });
      this.#emitWork("work.activity", completed, visualId);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = this.#works.setActivity(workId, { ...activity, status: "failed", error: message });
      this.#emitWork("work.failed", failed, visualId);
      throw error;
    }
  }

  #affectedVisualIds(work: WorkSession): string[] {
    return [...new Set([...Object.keys(work.overlay.visuals), ...work.overlay.removed_visual_ids])];
  }

  #emitWork(type: Extract<SceneEvent["type"], `work.${string}`>, work: WorkSession, visualId?: string, revision = this.#store.inspect().revision, affectedIds?: string[], payload?: Record<string, unknown>): void {
    let effective: EffectiveScene | undefined;
    if (type !== "work.completed" && type !== "work.cancelled") {
      try { effective = this.#works.effectiveScene(work.id, this.#store.inspect()); } catch { /* terminal session has no overlay */ }
    }
    const trace = this.#traces.get(work.id);
    this.#events.emit({ type, canvas_id: this.#store.inspect().canvas_id, revision, visual_id: visualId, ...(affectedIds?.length ? { affected_ids: affectedIds } : {}), ...(payload ? { payload } : {}), work_id: work.id, base_revision: work.base_revision, sequence: work.sequence, activity: work.activity, work, effective_scene: effective, ...(trace ? { trace_id: trace.id, timing: trace.snapshot() } : {}) });
  }

  async #renderStream(key: string, visual: VisualSpec, revision: number, workId: string): Promise<RenderArtifact> {
    const queryArtifact = await this.#queryArtifact(visual.source, visual.query, workId);
    const artifact = this.#streamArtifact(key, visual, revision, queryArtifact.rows, queryArtifact.columns, "complete");
    const changed = this.#works.next(workId);
    this.#emitWork("work.render.chunk", changed, visual.id, undefined, undefined, {
      artifact_generation: artifact.generation,
      chunk_index: 1,
      row_count: queryArtifact.rows.length
    });
    return artifact;
  }

  #streamArtifact(key: string, visual: VisualSpec, revision: number, rows: JsonObject[], columns: string[], streamState: RenderArtifact["stream_state"]): RenderArtifact {
    const numericFields = (visual.query.measures ?? []).map((measure) => measure.alias);
    const categoryFields = (visual.query.dimensions ?? []).map((dimension) => dimension.alias ?? (dimension.time_grain ? `${dimension.field}_${dimension.time_grain}` : dimension.field));
    const payload = { rows: structuredClone(rows), columns: structuredClone(columns), plot: compilePlot(visual, rows), observation: observe(rows, { numericFields, categoryFields, orderField: categoryFields[0] }) };
    const artifact = { visual: structuredClone(visual), revision, payload, generation: this.#nextStreamArtifactGeneration(key), cache_generation: this.#artifactGenerations.get(key) ?? 0, stream_state: streamState };
    this.#storeArtifact(key, artifact);
    return artifact;
  }

  async #render(visual: VisualSpec): Promise<RenderPayload> {
    const result = await this.#queryArtifact(visual.source, visual.query);
    return { rows: result.rows, columns: result.columns, plot: compilePlot(visual, result.rows), observation: result.observation };
  }

  async #queryArtifact(datasetId: string, querySpec: QuerySpec, workId?: string): Promise<QueryArtifact> {
    const dataset = this.#dataset(datasetId);
    const fingerprint = await this.#engine.fingerprint(dataset);
    const execute = async () => {
      const columns = await this.#engine.describeSchema(dataset);
      this.#traces.get(workId ?? "")?.mark("schema_ready", { cache_hit: false });
      const compiled = compileQuery(dataset.id, columns.map((column) => column.name), querySpec);
      this.#traces.get(workId ?? "")?.mark("query_started");
      const result = querySpec.sql
        ? await this.#engine.queryRawGuarded(dataset, compiled.sql, this.#pointLimit)
        : await this.#engine.queryGuarded(dataset, compiled, this.#pointLimit);
      if (result.exceeded) assertRenderable(this.#pointLimit + 1, this.#pointLimit, querySpec.sample);
      const numericFields = (querySpec.measures ?? []).map((measure) => measure.alias);
      const categoryFields = (querySpec.dimensions ?? []).map((dimension) => dimension.alias ?? (dimension.time_grain ? `${dimension.field}_${dimension.time_grain}` : dimension.field));
      const observation = observe(result.rows, { numericFields, categoryFields, orderField: categoryFields[0] });
      this.#traces.get(workId ?? "")?.mark("query_completed", { output_rows: result.rows.length });
      return { columns: result.columns, rows: result.rows, observation };
    };
    if (workId) return this.#queryArtifacts.getOrExecute(workId, fingerprint.key, querySpec, execute);
    const result = await execute();
    return { ...result, dataset_fingerprint: fingerprint.key, query_key: JSON.stringify(querySpec), state: "complete" };
  }

  #dataset(id: string): DatasetSpec {
    const dataset = this.#store.inspect().datasets[id];
    if (!dataset) throw new Error(`not_found: dataset ${id}`);
    return dataset;
  }
  #requireWork(workId: string | undefined): string {
    if (!workId) throw new Error("work_required: explicit work.apply begin is required");
    return workId;
  }
  #assertExpectedRevision(expectedRevision: number | undefined): void {
    const currentRevision = this.#store.inspect().revision;
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) throw new RevisionConflictError(expectedRevision, currentRevision);
  }
  #response(artifact: RenderArtifact, workId?: string): RuntimeResult {
    const { visual, revision, payload, generation, stream_state } = artifact;
    const artifactV2: RenderArtifactV2 = {
      artifact_version: 2,
      visual_id: visual.id,
      generation,
      revision,
      stream_state,
      ...(workId ? { work_id: workId } : {}),
      identity: payload.plot.identity ?? { visual_key: `visual:${visual.id}`, marks: [] }
    };
    return { status: "rendered", canvas_id: this.#store.inspect().canvas_id, revision, result: { visual, rows: payload.rows.length, columns: payload.columns, plot: payload.plot, artifact: artifactV2 }, observation: payload.observation };
  }
  #workingResponse(visual: WorkingVisual, revision: number): RuntimeResult {
    const identity = { visual_key: `visual:${visual.id}`, marks: [] };
    return { status: "working", canvas_id: this.#store.inspect().canvas_id, revision, result: { visual, rows: 0, columns: [], plot: { data: [], marks: [], identity }, artifact: { artifact_version: 2, visual_id: visual.id, generation: 0, revision, stream_state: "partial", identity } }, observation: emptyObservation() };
  }
  #workResult(work: WorkSession): { status: "ok"; canvas_id: string; revision: number; result: { work_id: string; base_revision: number; sequence: number } } {
    return { status: "ok", canvas_id: this.#store.inspect().canvas_id, revision: this.#store.inspect().revision, result: { work_id: work.id, base_revision: work.base_revision, sequence: work.sequence } };
  }
  #artifactKey(id: string, revision: number, workId?: string): string { return workId ? `work:${workId}:${id}` : `scene:${revision}:${id}`; }
  #artifactGenerationKey(key: string, generation: number): string { return `${key}@${generation}`; }
  #nextStreamArtifactGeneration(key: string): number {
    const generation = (this.#streamArtifactGenerations.get(key) ?? 0) + 1;
    this.#streamArtifactGenerations.set(key, generation);
    return generation;
  }
  #storeArtifact(key: string, artifact: RenderArtifact): void {
    this.#artifacts.set(key, artifact);
    this.#artifactsByGeneration.set(this.#artifactGenerationKey(key, artifact.generation), artifact);
  }
  #clearWorkArtifact(workId: string, id: string): void {
    const key = this.#artifactKey(id, this.#store.inspect().revision, workId);
    this.#artifacts.delete(key);
    for (const artifactKey of this.#artifactsByGeneration.keys()) if (artifactKey.startsWith(`${key}@`)) this.#artifactsByGeneration.delete(artifactKey);
    this.#streamArtifactGenerations.delete(key);
    this.#artifactGenerations.set(key, (this.#artifactGenerations.get(key) ?? 0) + 1);
  }

  #clearWorkArtifacts(workId: string): void {
    for (const key of this.#artifacts.keys()) if (key.startsWith(`work:${workId}:`)) this.#artifacts.delete(key);
    for (const key of this.#artifactsByGeneration.keys()) if (key.startsWith(`work:${workId}:`)) this.#artifactsByGeneration.delete(key);
    for (const key of this.#artifactGenerations.keys()) if (key.startsWith(`work:${workId}:`)) this.#artifactGenerations.delete(key);
    for (const key of this.#streamArtifactGenerations.keys()) if (key.startsWith(`work:${workId}:`)) this.#streamArtifactGenerations.delete(key);
  }
  #promoteWorkArtifacts(workId: string, revision: number): void {
    for (const [key, artifact] of this.#artifacts) if (key.startsWith(`work:${workId}:`)) {
      const id = key.slice(`work:${workId}:`.length);
      this.#artifacts.set(this.#artifactKey(id, revision), { ...artifact, revision, generation: 0, cache_generation: 0 });
      this.#artifacts.delete(key);
    }
  }
  async #persist(): Promise<void> {
    if (!this.#persistence) return;
    await this.#persistence.saveRuntimeState({
      scene: this.#store.inspect(),
      history: this.#store.historyRecords(),
      snapshots: this.#store.historySnapshots(),
      metadata: { checkpoints: this.#store.historyCheckpoints(), forks: this.#store.historyForks() }
    });
  }
  #historyResult(mutation: HistoryMutationResult): { checkpoint?: string; parent_revision?: number; branch_id?: string } | undefined {
    const result: { checkpoint?: string; parent_revision?: number; branch_id?: string } = {};
    if (mutation.checkpoint) result.checkpoint = mutation.checkpoint;
    if (mutation.parent_revision !== undefined) result.parent_revision = mutation.parent_revision;
    if (mutation.branch_id) result.branch_id = mutation.branch_id;
    return Object.keys(result).length ? result : undefined;
  }
}
