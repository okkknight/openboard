export interface SceneEvent {
  type: "visual.created" | "visual.changed";
  canvas_id: string;
  revision: number;
  visual_id: string;
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
