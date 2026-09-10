export interface SceneEvent {
  type: "scene.loaded" | "visual.created" | "visual.changed" | "visual.removed" | "annotation.created" | "annotation.removed" | "focus.changed" | "layout.changed" | "history.changed";
  canvas_id: string;
  revision: number;
  visual_id?: string;
  annotation_id?: string;
  affected_ids?: string[];
  payload?: Record<string, unknown>;
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
