import test from "node:test";
import assert from "node:assert/strict";
import { createVisualRenderCache } from "../web/visual-render-cache.js";

const payload = () => ({ status: "rendered", result: { rows: 4, plot: { data: [{ channel: "A", orders: 2 }] }, visual: { id: "orders" } } });

test("reflows from the last payload without fetching visual data", () => {
  const cache = createVisualRenderCache();
  cache.remember("orders", payload());
  const calls = [];
  cache.reflow("orders", { x: 0, y: 0, w: 640, h: 360 }, (value, layout) => calls.push({ value, layout }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].layout.w, 640);
  assert.equal(cache.get("orders").result.rows, 4);
});

test("stores only successful rendered payloads and removes stale entries", () => {
  const cache = createVisualRenderCache();
  assert.equal(cache.remember("working", { status: "working", result: {} }), false);
  assert.equal(cache.get("working"), undefined);
  assert.equal(cache.remember("orders", payload()), true);
  cache.remove("orders");
  assert.equal(cache.get("orders"), undefined);
});
