import { observe, type Observation } from "../core/observation.js";
import { compileQuery } from "../core/query-compiler.js";
import { SceneStore } from "../core/scene-store.js";
import type { AnnotationSpec, ComposeInput, DatasetSpec, HistoryApplyInput, JsonObject, QuerySpec, Scene, VisualPatch, VisualSpec } from "../core/types.js";
import { DuckDbEngine } from "../data/duckdb-engine.js";
import { compilePlot, type PlotConfig } from "../render/plot-compiler.js";
import { EventBus, type SceneEvent } from "./event-bus.js";
import { Persistence } from "./persistence.js";

export interface RuntimeResult {
  status: "rendered";
  canvas_id: string;
  revision: number;
  result: { visual: VisualSpec; rows: number; columns: string[]; plot: PlotConfig };
  observation: Observation;
}

export class DataCanvasRuntime {
  #store: SceneStore;
  #engine = new DuckDbEngine();
  #events = new EventBus();
  #persistence?: Persistence;
  #persistedHistoryLength = 0;

  constructor(scene: Scene, persistence?: Persistence) { this.#store = new SceneStore(scene); this.#persistence = persistence; }
  onEvent(listener: (event: SceneEvent) => void): () => void { return this.#events.on(listener); }
  inspect(): Scene { return this.#store.inspect(); }
  close(): void { this.#engine.close(); }

  async dataInspect(id: string): Promise<DatasetSpec> {
    return this.#engine.inspect(this.#dataset(id));
  }

  async dataQuery(id: string, query: QuerySpec): Promise<{ columns: string[]; data: JsonObject[]; observation: Observation }> {
    const dataset = this.#dataset(id);
    const profile = await this.#engine.inspect(dataset);
    const result = query.sql
      ? await this.#engine.queryRaw(dataset, query.sql)
      : await this.#engine.query(dataset, compileQuery(dataset.id, profile.columns?.map((column) => column.name) ?? [], query));
    const numericFields = (query.measures ?? []).map((measure) => measure.alias);
    const categoryFields = (query.dimensions ?? []).map((dimension) => dimension.alias ?? (dimension.time_grain ? `${dimension.field}_${dimension.time_grain}` : dimension.field));
    return { columns: result.columns, data: result.rows, observation: observe(result.rows, { numericFields, categoryFields, orderField: categoryFields[0] }) };
  }

  async visualCreate(visual: VisualSpec, expectedRevision?: number): Promise<RuntimeResult> {
    const payload = await this.#render(visual);
    const mutation = this.#store.createVisual(visual, expectedRevision);
    await this.#persist();
    const response = this.#response(mutation.visual, mutation.revision, payload);
    this.#events.emit({ type: "visual.created", canvas_id: response.canvas_id, revision: response.revision, visual_id: visual.id });
    return response;
  }

  async visualPatch(id: string, patch: VisualPatch, expectedRevision?: number): Promise<RuntimeResult> {
    const preview = this.#store.previewPatch(id, patch);
    const payload = await this.#render(preview);
    const mutation = this.#store.patchVisual(id, patch, expectedRevision);
    await this.#persist();
    const response = this.#response(mutation.visual, mutation.revision, payload);
    this.#events.emit({ type: "visual.changed", canvas_id: response.canvas_id, revision: response.revision, visual_id: id });
    return response;
  }

  async visualClone(id: string, newId: string, patch?: VisualPatch, expectedRevision?: number): Promise<RuntimeResult> {
    const preview = this.#store.previewClone(id, newId, patch);
    const payload = await this.#render(preview);
    const mutation = this.#store.cloneVisual(id, newId, patch, expectedRevision);
    await this.#persist();
    const response = this.#response(mutation.visual, mutation.revision, payload);
    this.#events.emit({ type: "visual.created", canvas_id: response.canvas_id, revision: response.revision, visual_id: newId });
    return response;
  }

  async canvasCompose(input: ComposeInput, expectedRevision?: number): Promise<{ status: "ok"; canvas_id: string; revision: number }> {
    const mutation = this.#store.compose(input, expectedRevision);
    await this.#persist();
    const scene = this.#store.inspect();
    return { status: "ok", canvas_id: scene.canvas_id, revision: mutation.revision };
  }

  async canvasAnnotate(annotation: AnnotationSpec, expectedRevision?: number): Promise<{ status: "ok"; canvas_id: string; revision: number }> {
    const mutation = this.#store.annotate(annotation, expectedRevision);
    await this.#persist();
    const scene = this.#store.inspect();
    return { status: "ok", canvas_id: scene.canvas_id, revision: mutation.revision };
  }

  async historyApply(input: HistoryApplyInput): Promise<{ status: "ok"; canvas_id: string; revision: number }> {
    const mutation = this.#store.applyHistory(input);
    await this.#persist();
    const scene = this.#store.inspect();
    return { status: "ok", canvas_id: scene.canvas_id, revision: mutation.revision };
  }

  async #render(visual: VisualSpec): Promise<{ rows: JsonObject[]; columns: string[]; plot: PlotConfig; observation: Observation }> {
    const dataset = this.#dataset(visual.source);
    const profile = await this.#engine.inspect(dataset);
    const query = compileQuery(dataset.id, profile.columns?.map((column) => column.name) ?? [], visual.query);
    const result = await this.#engine.query(dataset, query);
    const numericFields = (visual.query.measures ?? []).map((measure) => measure.alias);
    const categoryFields = (visual.query.dimensions ?? []).map((dimension) => dimension.alias ?? (dimension.time_grain ? `${dimension.field}_${dimension.time_grain}` : dimension.field));
    return { rows: result.rows, columns: result.columns, plot: compilePlot(visual, result.rows), observation: observe(result.rows, { numericFields, categoryFields, orderField: categoryFields[0] }) };
  }

  #dataset(id: string): DatasetSpec {
    const dataset = this.#store.inspect().datasets[id];
    if (!dataset) throw new Error(`not_found: dataset ${id}`);
    return dataset;
  }

  #response(visual: VisualSpec, revision: number, payload: { rows: JsonObject[]; columns: string[]; plot: PlotConfig; observation: Observation }): RuntimeResult {
    return { status: "rendered", canvas_id: this.#store.inspect().canvas_id, revision, result: { visual, rows: payload.rows.length, columns: payload.columns, plot: payload.plot }, observation: payload.observation };
  }

  async #persist(): Promise<void> {
    if (!this.#persistence) return;
    await this.#persistence.saveScene(this.#store.inspect());
    const records = this.#store.historyRecords();
    for (const record of records.slice(this.#persistedHistoryLength)) await this.#persistence.appendHistory(record);
    this.#persistedHistoryLength = records.length;
  }
}
