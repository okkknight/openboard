import type { CanvasObjectRef, EffectiveScene, WorkActivity, WorkSession } from "../core/types.js";
import type { TraceSnapshot } from "./performance-trace.js";

export interface SceneEvent {
  type: "scene.loaded" | "visual.created" | "visual.changed" | "visual.removed" | "annotation.created" | "annotation.changed" | "annotation.removed" | "focus.changed" | "layout.changed" | "history.changed" | "work.started" | "work.activity" | "work.visual.changed" | "work.render.chunk" | "work.completed" | "work.cancelled" | "work.failed" | "work.snapshot";
  canvas_id: string;
  revision: number;
  visual_id?: string;
  annotation_id?: string;
  affected_ids?: string[];
  affected_objects?: CanvasObjectRef[];
  work_id?: string;
  base_revision?: number;
  sequence?: number;
  activity?: WorkActivity;
  work?: WorkSession;
  effective_scene?: EffectiveScene;
  payload?: Record<string, unknown>;
  trace_id?: string;
  timing?: TraceSnapshot;
}

export class EventBus {
  #listeners = new Set<(event: SceneEvent) => void>();
  on(listener: (event: SceneEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  emit(event: SceneEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
