import test from "node:test";
import assert from "node:assert/strict";
import { crossMarkTransition } from "../web/cross-mark-transition.js";

test("plans supported family transitions from semantic mark identity", () => {
  assert.deepEqual(crossMarkTransition("barY", "dot"), { kind: "bar-dot", exit: "collapse", enter: "expand" });
  assert.deepEqual(crossMarkTransition("barY", "arc"), { kind: "bar-arc", exit: "collapse", enter: "sweep" });
  assert.deepEqual(crossMarkTransition("barY", "lineY"), { kind: "bar-line", exit: "collapse", enter: "draw" });
});

test("uses visible exit-enter fallback for unsupported cross-family changes", () => {
  assert.deepEqual(crossMarkTransition("areaY", "arc"), { kind: "fallback", exit: "fade", enter: "fade" });
});
