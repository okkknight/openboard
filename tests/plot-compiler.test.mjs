import test from "node:test";
import assert from "node:assert/strict";
import { compilePlot } from "../dist/render/plot-compiler.js";

const visual = {
  id: "trend",
  kind: "plot",
  source: "orders",
  query: {},
  layout: { x: 0, y: 0, w: 480, h: 320 },
  marks: [
    { id: "area", type: "areaY", x: "day", y: "failure_rate" },
    { id: "line", type: "lineY", x: "day", y: "failure_rate" },
    { id: "threshold", type: "ruleY", y: 0.2 }
  ]
};

test("compiles supported layered marks in input order", () => {
  const config = compilePlot(visual, [{ day: "2026-08-01", failure_rate: 0.1 }]);
  assert.deepEqual(config.marks.map((mark) => mark.type), ["areaY", "lineY", "ruleY"]);
  assert.equal(config.marks[1].options.x, "day");
});

test("rejects unsupported mark types instead of ignoring them", () => {
  assert.throws(() => compilePlot({ ...visual, marks: [{ id: "bad", type: "pie" }] }, []), /unsupported_visual_feature/);
});

test("keeps table and KPI payloads on the same disposable render contract", () => {
  const rows = [{ channel: "A", orders: 3 }];
  assert.deepEqual(compilePlot({ ...visual, kind: "table", marks: [] }, rows), { data: rows, marks: [] });
  assert.deepEqual(compilePlot({ ...visual, kind: "kpi", marks: [] }, rows), { data: rows, marks: [] });
});

test("accepts every frozen initial mark type", () => {
  const markTypes = ["barX", "barY", "lineX", "lineY", "areaX", "areaY", "dot", "rect", "cell", "ruleX", "ruleY", "text", "tickX", "tickY", "boxX", "boxY"];
  const compiled = compilePlot({ ...visual, marks: markTypes.map((type, index) => ({ id: `m${index}`, type, x: "day", y: "value" })) }, [{ day: "2026-01-01", value: 1 }]);
  assert.deepEqual(compiled.marks.map((mark) => mark.type), markTypes);
});
