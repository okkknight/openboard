import test from "node:test";
import assert from "node:assert/strict";
import { summarizeSamples } from "../scripts/benchmark-streaming-latency.mjs";

test("summarizes successful latency samples with literal p50 and p95", () => {
  const summary = summarizeSamples([
    { ok: true, status: 200, ms: 10 },
    { ok: true, status: 200, ms: 20 },
    { ok: true, status: 200, ms: 30 },
    { ok: false, status: 500, ms: 40 }
  ]);
  assert.deepEqual(summary, {
    count: 4,
    successes: 3,
    failures: 1,
    min_ms: 10,
    p50_ms: 20,
    p95_ms: 30,
    max_ms: 30,
    statuses: { "200": 3, "500": 1 }
  });
});
