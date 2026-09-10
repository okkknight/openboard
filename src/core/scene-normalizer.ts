import type { Scene, VisualSpec } from "./types.js";

/** Adds defaults for the open grammar without changing legacy scene meaning. */
export function normalizeScene(input: Scene): Scene {
  const scene = structuredClone(input);
  for (const visual of Object.values(scene.visuals)) normalizeVisual(visual);
  return scene;
}

export function normalizeVisual(input: VisualSpec): VisualSpec {
  const visual = input;
  visual.coordinate ??= { type: "cartesian" };
  for (const mark of visual.marks) {
    if (!mark.renderer) mark.renderer = "plot";
  }
  return visual;
}
