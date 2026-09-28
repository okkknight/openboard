import test from "node:test";
import assert from "node:assert/strict";
import { countRenderableElements, createRenderMotion, finishAnimationAtCurrentState, motionFrames, motionStrategy } from "../web/render-motion.js";

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
  assert.deepEqual(motionFrames("enter", "arc", false), [{ opacity: 0, transform: "scale(.92)" }, { opacity: 1, transform: "scale(1)" }]);
});

test("uses mark-family geometry for entry and exit motion", () => {
  assert.deepEqual(motionFrames("enter", "barY"), [{ opacity: 0.2, transform: "scaleY(0)" }, { opacity: 1, transform: "scaleY(1)" }]);
  assert.deepEqual(motionFrames("exit", "area"), [{ opacity: 1, transform: "scaleY(1)" }, { opacity: 0, transform: "scaleY(0)" }]);
  assert.deepEqual(motionFrames("enter", "dot"), [{ opacity: 0, transform: "scale(0)" }, { opacity: 1, transform: "scale(1)" }]);
  assert.deepEqual(motionFrames("enter", "text"), [{ opacity: 0, transform: "translateY(5px)" }, { opacity: 1, transform: "translateY(0)" }]);
});

test("draws and retracts path-like marks when a path length is available", () => {
  assert.deepEqual(motionFrames("enter", "lineY", false, 42), [
    { opacity: 0.25, strokeDasharray: "42 42", strokeDashoffset: "42" },
    { opacity: 1, strokeDasharray: "42 42", strokeDashoffset: "0" }
  ]);
  assert.deepEqual(motionFrames("exit", "ruleX", false, 42), [
    { opacity: 1, strokeDasharray: "42 42", strokeDashoffset: "0" },
    { opacity: 0.25, strokeDasharray: "42 42", strokeDashoffset: "42" }
  ]);
});

test("commits an interrupted animation before cancellation", () => {
  const calls = [];
  finishAnimationAtCurrentState({ commitStyles() { calls.push("commit"); }, cancel() { calls.push("cancel"); } });
  assert.deepEqual(calls, ["commit", "cancel"]);
});

test("animates a large result as one layer and skips small-result layer motion", async () => {
  const calls = [];
  const layer = {
    animate(frames, options) {
      calls.push({ frames, options });
      const animation = { cancel() { this.oncancel?.(); } };
      queueMicrotask(() => animation.onfinish?.());
      return animation;
    }
  };
  const motion = createRenderMotion();
  motion.begin("v1", 1);
  await motion.applyLayer({ visualId: "v1", generation: 1, element: layer, phase: "data-enter", elementCount: 121 });
  await motion.applyLayer({ visualId: "v1", generation: 1, element: layer, phase: "data-enter", elementCount: 4 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].frames, [{ opacity: 0.82 }, { opacity: 1 }]);
});

test("counts actual keyed SVG elements rather than identity descriptors", () => {
  const svg = { querySelectorAll(selector) {
    assert.equal(selector, '[data-render-key]');
    return Array.from({ length: 121 });
  } };
  assert.equal(countRenderableElements(svg), 121);
});
