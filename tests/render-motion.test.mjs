import test from "node:test";
import assert from "node:assert/strict";
import { motionFrames, motionStrategy } from "../web/render-motion.js";

test("maps render operations to explicit mark-family motion strategies", () => {
  assert.deepEqual(motionStrategy("enter", "barY"), { family: "bar", action: "baseline-enter" });
  assert.deepEqual(motionStrategy("update", "dot"), { family: "dot", action: "geometry-update" });
  assert.deepEqual(motionStrategy("exit", "arc"), { family: "arc", action: "collapse-exit" });
  assert.deepEqual(motionStrategy("update", "lineY"), { family: "line", action: "safe-path-or-fade" });
  assert.deepEqual(motionStrategy("enter", "text"), { family: "text", action: "translate-fade-enter" });
});

test("uses a deterministic fade fallback for unsupported mark families", () => {
  assert.deepEqual(motionStrategy("exit", "unknown"), { family: "fallback", action: "fade-exit" });
});

test("does not override an SVG transform attribute while an arc enters", () => {
  assert.deepEqual(motionFrames("enter", "arc", true), [{ opacity: 0 }, { opacity: 1 }]);
  assert.deepEqual(motionFrames("enter", "arc", false), [{ opacity: 0, transform: "translateY(5px)" }, { opacity: 1, transform: "none" }]);
});
