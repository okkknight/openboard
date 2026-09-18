import test from "node:test";
import assert from "node:assert/strict";
import { createTrace } from "../dist/runtime/performance-trace.js";

test("records milestones once and derives query duration from an injected clock", () => {
  const ticks = [100, 112, 145, 180];
  const trace = createTrace(() => ticks.shift(), "trace-fixed");

  trace.mark("work_started");
  trace.mark("query_started");
  trace.mark("query_completed", { output_rows: 4 });
  trace.mark("query_completed", { output_rows: 99 });

  const snapshot = trace.snapshot();
  assert.equal(snapshot.trace_id, "trace-fixed");
  assert.deepEqual(snapshot.milestones.map((item) => item.name), ["work_started", "query_started", "query_completed"]);
  assert.equal(snapshot.durations.query_ms, 33);
  assert.equal(snapshot.milestones[2].metrics.output_rows, 4);
});

test("rejects trace metrics that could contain user data", () => {
  const trace = createTrace(() => 1, "trace-safe");

  assert.throws(() => trace.mark("query_completed", { rows: [{ secret: "x" }] }), /unsafe_trace_metric/);
  assert.throws(() => trace.mark("draft_visible", { text: "private" }), /unsafe_trace_metric/);
});
