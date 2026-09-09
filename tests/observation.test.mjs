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
