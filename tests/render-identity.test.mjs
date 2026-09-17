import test from "node:test";
import assert from "node:assert/strict";
import { compilePlot } from "../dist/render/plot-compiler.js";
import { canonicalRenderKey } from "../dist/render/render-identity.js";
import { resolve } from "node:path";
import { DataCanvasRuntime } from "../dist/runtime/data-canvas-runtime.js";
import { createInWork } from "./work-helpers.mjs";

const visual = {
  id: "orders-by-channel",
  kind: "plot",
  source: "orders",
  query: {
    dimensions: [{ field: "channel" }],
    measures: [{ field: "amount", agg: "sum", alias: "revenue" }]
  },
  marks: [{ id: "bars", type: "barY", x: "channel", y: "revenue" }],
  layout: { x: 0, y: 0, w: 400, h: 240 }
};

test("compiles deterministic datum identity independently of row order", () => {
  const first = compilePlot(visual, [
    { channel: "A", revenue: 100 },
    { channel: "B", revenue: 80 }
  ]);
  const reordered = compilePlot(visual, [
    { channel: "B", revenue: 80 },
    { channel: "A", revenue: 100 }
  ]);

  assert.deepEqual(first.identity, {
    visual_key: "visual:orders-by-channel",
    marks: [{
      mark_id: "bars",
      renderer: "plot",
      mark_type: "barY",
      identity_mode: "datum",
      key_fields: ["channel"],
      layer_key: "plot:bars"
    }]
  });
  assert.deepEqual(first.marks[0].render_keys, [
    'mark=bars|key=[["string","A"]]',
    'mark=bars|key=[["string","B"]]'
  ]);
  assert.deepEqual(reordered.marks[0].render_keys, [
    'mark=bars|key=[["string","B"]]',
    'mark=bars|key=[["string","A"]]'
  ]);
});

test("rejects duplicate semantic datum keys instead of using row index", () => {
  assert.throws(() => compilePlot(visual, [
    { channel: "A", revenue: 100 },
    { channel: "A", revenue: 160 }
  ]), /duplicate_render_key: bars/);
});

test("keeps surviving datum keys stable after filtering rows", () => {
  const full = compilePlot(visual, [
    { channel: "A", revenue: 100 },
    { channel: "B", revenue: 80 },
    { channel: "C", revenue: 60 }
  ]);
  const filtered = compilePlot(visual, [
    { channel: "A", revenue: 100 },
    { channel: "C", revenue: 60 }
  ]);
  assert.deepEqual(filtered.marks[0].render_keys, [
    full.marks[0].render_keys[0],
    full.marks[0].render_keys[2]
  ]);
});

test("canonical keys preserve scalar types, null, and Date values", () => {
  const key = canonicalRenderKey("marks", ["string", "number", "missing", "date"], {
    string: "1",
    number: 1,
    missing: null,
    date: new Date("2026-09-14T00:00:00.000Z")
  });
  assert.equal(key, 'mark=marks|key=[["string","1"],["number",1],["null",null],["date","2026-09-14T00:00:00.000Z"]]');
});

test("uses series identity for compatible line layers", () => {
  const line = compilePlot({
    ...visual,
    id: "daily-revenue",
    query: {
      dimensions: [{ field: "day" }, { field: "channel" }],
      measures: [{ field: "amount", agg: "sum", alias: "revenue" }]
    },
    marks: [{ id: "trend", type: "lineY", x: "day", y: "revenue", color: "channel" }]
  }, [
    { day: "2026-09-13", channel: "A", revenue: 10 },
    { day: "2026-09-14", channel: "A", revenue: 12 },
    { day: "2026-09-13", channel: "B", revenue: 8 }
  ]);

  assert.deepEqual(line.identity.marks[0], {
    mark_id: "trend",
    renderer: "plot",
    mark_type: "lineY",
    identity_mode: "series",
    key_fields: ["channel"],
    series_fields: ["channel"],
    layer_key: "plot:trend"
  });
  assert.deepEqual(line.marks[0].render_keys, [
    'mark=trend|key=[["string","A"]]',
    'mark=trend|key=[["string","A"]]',
    'mark=trend|key=[["string","B"]]'
  ]);
});

test("attaches primitive datum identity to every compiled value", () => {
  const donut = compilePlot({
    ...visual,
    id: "channel-donut",
    coordinate: { type: "polar" },
    marks: [{ id: "slices", renderer: "primitive", type: "arc", encoding: { angle: { field: "revenue" }, color: { field: "channel" } } }]
  }, [
    { channel: "A", revenue: 100 },
    { channel: "B", revenue: 80 }
  ]);

  assert.deepEqual(donut.identity.marks[0], {
    mark_id: "slices",
    renderer: "primitive",
    mark_type: "arc",
    identity_mode: "datum",
    key_fields: ["channel"],
    layer_key: "primitive:slices"
  });
  assert.deepEqual(donut.primitives[0].values.map((value) => value.render_key), [
    'mark=slices|key=[["string","A"]]',
    'mark=slices|key=[["string","B"]]'
  ]);
});

test("exposes a versioned render artifact identity contract to browser callers", async () => {
  const runtime = new DataCanvasRuntime({
    canvas_id: "identity-runtime",
    revision: 0,
    datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } },
    visuals: {}, annotations: {}, canvas: {}
  });
  try {
    await createInWork(runtime, visual);
    const rendered = await runtime.renderVisual("orders-by-channel");
    assert.deepEqual(rendered.result.artifact, {
      artifact_version: 2,
      visual_id: "orders-by-channel",
      generation: 0,
      revision: 1,
      stream_state: "complete",
      identity: rendered.result.plot.identity
    });
  } finally {
    runtime.close();
  }
});
