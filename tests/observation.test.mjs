import test from "node:test";
import assert from "node:assert/strict";
import { observe } from "../dist/core/observation.js";

test("summarizes numeric values, categories, and ordered change deterministically", () => {
  const observation = observe([
    { day: "2026-08-01", channel: "B", failure_rate: 0.1 },
    { day: "2026-08-02", channel: "B", failure_rate: 0.3 },
    { day: "2026-08-03", channel: "A", failure_rate: 0.2 }
  ], { numericFields: ["failure_rate"], categoryFields: ["channel"], orderField: "day" });

  assert.equal(observation.row_count, 3);
  assert.equal(observation.numeric.failure_rate.min, 0.1);
  assert.equal(observation.numeric.failure_rate.max, 0.3);
  assert.ok(Math.abs(observation.numeric.failure_rate.mean - 0.2) < Number.EPSILON);
  assert.equal(observation.numeric.failure_rate.median, 0.2);
  assert.deepEqual(observation.categories.channel.top, [{ value: "B", count: 2 }, { value: "A", count: 1 }]);
  assert.deepEqual(observation.ordered.failure_rate, { first: 0.1, last: 0.2, absolute_change: 0.1, relative_change: 1 });
});

test("reports missing values, extrema keys, and Tukey outlier candidates", () => {
  const observation = observe([
    { day: "2026-01-01", value: 1, group: "A" },
    { day: "2026-01-02", value: null, group: "A" },
    { day: "2026-01-03", value: 2, group: "B" },
    { day: "2026-01-04", value: 3, group: "B" },
    { day: "2026-01-05", value: 4, group: "B" },
    { day: "2026-01-06", value: 5, group: "B" },
    { day: "2026-01-07", value: 6, group: "B" },
    { day: "2026-01-08", value: 100, group: "B" }
  ], { numericFields: ["value"], categoryFields: ["group"], orderField: "day" });
  assert.equal(observation.missing.value, 1);
  assert.deepEqual(observation.numeric.value.argmin, { value: 1, index: 0 });
  assert.deepEqual(observation.numeric.value.argmax, { value: 100, index: 7 });
  assert.deepEqual(observation.outliers, [{ field: "value", value: 100, index: 7, lower: -4, upper: 12 }]);
});
