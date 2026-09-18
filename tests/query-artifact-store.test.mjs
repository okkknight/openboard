import test from "node:test";
import assert from "node:assert/strict";
import { canonicalQueryKey, QueryArtifactStore } from "../dist/runtime/query-artifact-store.js";

const query = { dimensions: [{ field: "channel" }], measures: [{ agg: "count", alias: "orders" }] };
const result = { columns: ["channel", "orders"], rows: [{ channel: "A", orders: 8 }], observation: { row_count: 1, numeric: {}, categories: {}, ordered: {}, missing: {}, outliers: [] } };

test("canonical query keys ignore object insertion order and preserve array order", () => {
  const first = { dimensions: [{ field: "channel" }], limit: 10 };
  const second = { limit: 10, dimensions: [{ field: "channel" }] };
  const reversed = { dimensions: [{ field: "region" }, { field: "channel" }], limit: 10 };
  assert.equal(canonicalQueryKey(first), canonicalQueryKey(second));
  assert.notEqual(canonicalQueryKey(first), canonicalQueryKey(reversed));
});

test("shares one pending execution inside a work session", async () => {
  const store = new QueryArtifactStore();
  let executions = 0;
  const execute = async () => { executions += 1; await Promise.resolve(); return result; };

  const [first, second] = await Promise.all([
    store.getOrExecute("work_1", "fp_1", query, execute),
    store.getOrExecute("work_1", "fp_1", query, execute)
  ]);

  assert.equal(executions, 1);
  assert.deepEqual(second, first);
});

test("evicts failed executions and clears completed work artifacts", async () => {
  const store = new QueryArtifactStore();
  await assert.rejects(() => store.getOrExecute("work_1", "fp_1", query, async () => { throw new Error("boom"); }), /boom/);
  const recovered = await store.getOrExecute("work_1", "fp_1", query, async () => result);
  assert.equal(recovered.state, "complete");
  store.clearWork("work_1");
  assert.equal(store.sizeForWork("work_1"), 0);
});

test("does not share artifacts across work sessions or dataset fingerprints", async () => {
  const store = new QueryArtifactStore();
  let executions = 0;
  const execute = async () => { executions += 1; return result; };
  await store.getOrExecute("work_1", "fp_1", query, execute);
  await store.getOrExecute("work_2", "fp_1", query, execute);
  await store.getOrExecute("work_1", "fp_2", query, execute);
  assert.equal(executions, 3);
});
