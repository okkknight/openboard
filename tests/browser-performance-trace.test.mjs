import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserTrace } from "../web/performance-trace.js";

function fakePerformance() {
  const marks = [];
  return {
    marks,
    mark(name) { marks.push({ name, startTime: marks.length * 10 }); },
    clearMarks(name) { for (let index = marks.length - 1; index >= 0; index -= 1) if (marks[index].name === name) marks.splice(index, 1); }
  };
}

test("records browser milestones under one trace without canvas content", () => {
  const api = fakePerformance();
  const traces = createBrowserTrace({ performanceApi: api });
  traces.begin("trace-1");
  traces.mark("trace-1", "draft_visible");
  traces.mark("trace-1", "visual_first_paint");
  traces.mark("trace-1", "visual_settled");
  traces.mark("trace-1", "work_committed");

  assert.deepEqual(traces.snapshot("trace-1").map((item) => item.name), ["draft_visible", "visual_first_paint", "visual_settled", "work_committed"]);
  assert.ok(api.marks.every((item) => item.name.startsWith("openboard:trace-1:")));
});

test("keeps only the most recent trace ids", () => {
  const traces = createBrowserTrace({ performanceApi: fakePerformance(), maxTraces: 2 });
  traces.begin("trace-1");
  traces.begin("trace-2");
  traces.begin("trace-3");
  assert.deepEqual(traces.traceIds(), ["trace-2", "trace-3"]);
});

test("clears every concrete performance mark when a trace expires", () => {
  const api = fakePerformance();
  const traces = createBrowserTrace({ performanceApi: api, maxTraces: 1 });
  traces.mark("trace-1", "draft_visible");
  traces.mark("trace-1", "visual_first_paint");
  traces.begin("trace-2");
  assert.deepEqual(api.marks, []);
});
