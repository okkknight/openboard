import test from "node:test";
import assert from "node:assert/strict";
import { connectorGeometry, fallbackAnnotationLayout, semanticAnnotationClass } from "../web/annotation-renderer.js";

test("derives a stable legacy annotation layout and nearest-edge connector", () => {
  const visual = { x: 100, y: 100, w: 400, h: 260 };
  assert.deepEqual(fallbackAnnotationLayout({ id: "a", text: "Note", target: "v" }, { v: visual }, 0), { x: 524, y: 100, w: 280, h: 120 });
  assert.deepEqual(connectorGeometry({ x: 524, y: 100, w: 280, h: 120 }, visual), { from: { x: 524, y: 160 }, to: { x: 500, y: 160 } });
});

test("uses anchor and deterministic fallback positions for legacy annotations", () => {
  assert.deepEqual(fallbackAnnotationLayout({ id: "a", text: "A", anchor: { x: 40, y: 70 } }, {}, 0), { x: 40, y: 70, w: 280, h: 120 });
  assert.deepEqual(fallbackAnnotationLayout({ id: "b", text: "B" }, {}, 2), { x: 48, y: 384, w: 320, h: 120 });
});

test("maps only approved semantic annotation variants", () => {
  assert.equal(semanticAnnotationClass({ variant: "callout", align: "center", color_role: "warning" }), "annotation-callout align-center color-warning");
  assert.equal(semanticAnnotationClass({ variant: "unknown", align: "sideways" }), "annotation-body align-start color-default");
});
