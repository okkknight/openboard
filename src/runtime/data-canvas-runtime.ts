import { observe, type Observation } from "../core/observation.js";
import { compileQuery } from "../core/query-compiler.js";
import { SceneStore } from "../core/scene-store.js";
import type { JsonObject, Scene, VisualPatch, VisualSpec } from "../core/types.js";
import { DuckDbEngine } from "../data/duckdb-engine.js";
import { compilePlot, type PlotConfig } from "../render/plot-compiler.js";
import { EventBus, type SceneEvent } from "./event-bus.js";

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

  constructor(scene: Scene) { this.#store = new SceneStore(scene); }
  onEvent(listener: (event: SceneEvent) => void): () => void { return this.#events.on(listener); }
  inspect(): Scene { return this.#store.inspect(); }
  close(): void { this.#engine.close(); }

  async visualCreate(visual: VisualSpec, expectedRevision?: number): Promise<RuntimeResult> {
    const payload = await this.#render(visual);
    const mutation = this.#store.createVisual(visual, expectedRevision);
    const response = this.#response(mutation.visual, mutation.revision, payload);
    this.#events.emit({ type: "visual.created", canvas_id: response.canvas_id, revision: response.revision, visual_id: visual.id });
    return response;
  }

  async visualPatch(id: string, patch: VisualPatch, expectedRevision?: number): Promise<RuntimeResult> {
    const preview = this.#store.previewPatch(id, patch);
    const payload = await this.#render(preview);
    const mutation = this.#store.patchVisual(id, patch, expectedRevision);
    const response = this.#response(mutation.visual, mutation.revision, payload);
    this.#events.emit({ type: "visual.changed", canvas_id: response.canvas_id, revision: response.revision, visual_id: id });
    return response;
  }

  async #render(visual: VisualSpec): Promise<{ rows: JsonObject[]; columns: string[]; plot: PlotConfig; observation: Observation }> {
    const dataset = this.#store.inspect().datasets[visual.source];
    if (!dataset) throw new Error(`not_found: dataset ${visual.source}`);
    const profile = await this.#engine.inspect(dataset);
    const query = compileQuery(dataset.id, profile.columns?.map((column) => column.name) ?? [], visual.query);
    const result = await this.#engine.query(dataset, query);
    const numericFields = (visual.query.measures ?? []).map((measure) => measure.alias);
    const categoryFields = (visual.query.dimensions ?? []).map((dimension) => dimension.alias ?? (dimension.time_grain ? `${dimension.field}_${dimension.time_grain}` : dimension.field));
    return { rows: result.rows, columns: result.columns, plot: compilePlot(visual, result.rows), observation: observe(result.rows, { numericFields, categoryFields, orderField: categoryFields[0] }) };
  }

  #response(visual: VisualSpec, revision: number, payload: { rows: JsonObject[]; columns: string[]; plot: PlotConfig; observation: Observation }): RuntimeResult {
    return { status: "rendered", canvas_id: this.#store.inspect().canvas_id, revision, result: { visual, rows: payload.rows.length, columns: payload.columns, plot: payload.plot }, observation: payload.observation };
  }
}
