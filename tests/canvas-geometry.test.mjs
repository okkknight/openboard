import test from "node:test";
import assert from "node:assert/strict";
import {
  boundsForLayouts,
  moveLayouts,
  resizeLayouts,
  screenDeltaToCanvas,
  snapLayouts
} from "../web/canvas-geometry.js";

const entries = (...values) => values;
const object = (id, x, y, w, h) => [id, { x, y, w, h }];
const plain = (map) => Object.fromEntries(map);

test("converts screen movement through zoom and bounds multiple objects", () => {
  assert.deepEqual(screenDeltaToCanvas({ x: 24, y: -12 }, 1.5), { x: 16, y: -8 });
  assert.deepEqual(boundsForLayouts(entries(
    object("visual:a", 10, 20, 100, 60),
    object("annotation:b", 140, 10, 80, 100)
  )), { x: 10, y: 10, w: 210, h: 100 });
});

test("moves layouts immutably", () => {
  const input = entries(object("a", 10, 20, 100, 60));
  assert.deepEqual(plain(moveLayouts(input, { x: 5.25, y: -3.5 })), { a: { x: 15.25, y: 16.5, w: 100, h: 60 } });
  assert.deepEqual(input[0][1], { x: 10, y: 20, w: 100, h: 60 });
});

test("resizes southeast and west handles", () => {
  const input = entries(object("a", 10, 20, 100, 60));
  const bounds = boundsForLayouts(input);
  assert.deepEqual(plain(resizeLayouts(input, bounds, "se", { x: 20, y: 10 }, {}, () => ({ w: 20, h: 20 }))).a, { x: 10, y: 20, w: 120, h: 70 });
  assert.deepEqual(plain(resizeLayouts(input, bounds, "w", { x: 20, y: 0 }, {}, () => ({ w: 20, h: 20 }))).a, { x: 30, y: 20, w: 80, h: 60 });
});

test("supports aspect lock and center resize", () => {
  const input = entries(object("a", 0, 0, 100, 50));
  const bounds = boundsForLayouts(input);
  assert.deepEqual(plain(resizeLayouts(input, bounds, "se", { x: 40, y: 2 }, { shiftKey: true }, () => ({ w: 20, h: 20 }))).a, { x: 0, y: 0, w: 140, h: 70 });
  assert.deepEqual(plain(resizeLayouts(input, bounds, "e", { x: 10, y: 0 }, { altKey: true }, () => ({ w: 20, h: 20 }))).a, { x: -10, y: 0, w: 120, h: 50 });
});

test("resizes a multi-selection proportionally", () => {
  const input = entries(object("a", 0, 0, 100, 100), object("b", 100, 0, 100, 100));
  const result = plain(resizeLayouts(input, boundsForLayouts(input), "se", { x: 200, y: 100 }, {}, () => ({ w: 20, h: 20 })));
  assert.deepEqual(result, {
    a: { x: 0, y: 0, w: 200, h: 200 },
    b: { x: 200, y: 0, w: 200, h: 200 }
  });
});

test("enforces type-specific minimum sizes", () => {
  const input = entries(object("plot:a", 0, 0, 100, 80));
  const result = plain(resizeLayouts(input, boundsForLayouts(input), "nw", { x: 90, y: 70 }, {}, () => ({ w: 64, h: 48 })));
  assert.deepEqual(result["plot:a"], { x: 36, y: 32, w: 64, h: 48 });
});

test("snaps edges before grid and keeps a six-screen-pixel threshold across zoom", () => {
  for (const zoom of [0.8, 1, 1.5]) {
    const thresholdDelta = 5.5 / zoom;
    const preview = entries(object("moving", 100 + thresholdDelta, 30, 40, 40));
    const stationary = entries(object("fixed", 0, 0, 100, 100));
    const result = snapLayouts(preview, stationary, { zoom, grid: 10 });
    assert.equal(result.layouts.get("moving").x, 100);
    assert.equal(result.guides[0].kind, "edge");
  }
});

test("does not snap beyond six screen pixels", () => {
  const result = snapLayouts(entries(object("moving", 107, 0, 40, 40)), entries(object("fixed", 0, 0, 100, 100)), { zoom: 1, grid: 0 });
  assert.equal(result.layouts.get("moving").x, 107);
  assert.equal(result.guides.some((guide) => guide.axis === "x"), false);
});

test("uses equal-gap snapping before the grid fallback", () => {
  const stationary = entries(object("left", 0, 0, 40, 40), object("right", 100, 0, 40, 40));
  const result = snapLayouts(entries(object("moving", 64, 60, 20, 20)), stationary, { zoom: 1, grid: 10 });
  assert.equal(result.layouts.get("moving").x, 60);
  assert.equal(result.guides.find((guide) => guide.axis === "x").kind, "gap");
});

test("falls back to grid snapping and Control disables all snapping", () => {
  const preview = entries(object("moving", 23, 27, 20, 20));
  const snapped = snapLayouts(preview, [], { zoom: 1, grid: 10 });
  assert.deepEqual(snapped.layouts.get("moving"), { x: 20, y: 30, w: 20, h: 20 });
  assert.ok(snapped.guides.every((guide) => guide.kind === "grid"));
  const disabled = snapLayouts(preview, [], { zoom: 1, grid: 10, disabled: true });
  assert.deepEqual(disabled.layouts.get("moving"), preview[0][1]);
  assert.deepEqual(disabled.guides, []);
});
