import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { DataCanvasRuntime } from "../dist/runtime/data-canvas-runtime.js";
import { createInWork, cloneInWork, patchInWork } from "./work-helpers.mjs";

test("completes the local M1 analysis workflow with lineage", async () => {
  const runtime = new DataCanvasRuntime({
    canvas_id: "m1",
    revision: 0,
    datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } },
    visuals: {}, annotations: {}, canvas: {}
  });
  const original = await createInWork(runtime, {
    id: "failure-by-channel", kind: "plot", title: "Failure by channel", source: "orders",
    query: { dimensions: [{ field: "channel" }], measures: [{ agg: "count", alias: "orders" }, { expr: "avg(case when status='FAILED' then 1 else 0 end)", alias: "failure_rate" }] },
    marks: [{ id: "bars", type: "barY", x: "channel", y: "failure_rate" }], layout: { x: 0, y: 0, w: 480, h: 320 }
  });
  const clone = await cloneInWork(runtime, "failure-by-channel", "channel-b", { set: { title: "Channel B", "query.filters": [{ field: "channel", op: "eq", value: "B" }] } });
  await patchInWork(runtime, "channel-b", { set: { "query.dimensions": [{ field: "region" }] } });
  await runtime.canvasCompose({ action: "arrange", targets: ["failure-by-channel", "channel-b"], arrangement: "row" });
  await runtime.canvasAnnotate({ id: "note", target: "channel-b", text: "B channel needs regional follow-up", created_at: "2026-09-10T00:00:00.000Z" });
  const checkpoint = await runtime.historyApply({ action: "checkpoint", label: "regional-breakdown" });
  await patchInWork(runtime, "channel-b", { set: { title: "Later hypothesis" } });
  const restored = await runtime.historyApply({ action: "goto", label: "regional-breakdown" });
  assert.equal(restored.revision, checkpoint.revision);
  assert.equal(runtime.inspect().visuals["channel-b"].title, "Channel B");
  const fork = await runtime.historyApply({ action: "fork", revision: checkpoint.revision });
  assert.equal(fork.result.parent_revision, checkpoint.revision);
  assert.match(fork.result.branch_id, /^m1\/fork\//);
  assert.equal(runtime.inspect().visuals["channel-b"].derived_from, "failure-by-channel");
  assert.equal(runtime.inspect().annotations.note.text, "B channel needs regional follow-up");
  runtime.close();
});
