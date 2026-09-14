import test from "node:test";
import assert from "node:assert/strict";
import { acceptWorkEvent } from "../dist/web/work-event-order.js";

test("accepts a newer work event and rejects a stale event for the same work", () => {
  const lastSequence = new Map([["work_1", 5]]);

  assert.equal(acceptWorkEvent(lastSequence, { work_id: "work_1", sequence: 6 }), true);
  assert.equal(lastSequence.get("work_1"), 6);
  assert.equal(acceptWorkEvent(lastSequence, { work_id: "work_1", sequence: 4 }), false);
  assert.equal(lastSequence.get("work_1"), 6);
});
