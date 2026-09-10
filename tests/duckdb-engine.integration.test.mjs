import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { DuckDbEngine } from "../dist/data/duckdb-engine.js";
import { compileQuery } from "../dist/core/query-compiler.js";

const orders = { id: "orders", path: resolve("examples/orders.csv"), format: "csv" };

test("inspects a CSV and executes a parameterized structured query", async () => {
  const engine = new DuckDbEngine();
  const profile = await engine.inspect(orders);
  assert.equal(profile.row_count, 20);
  assert.ok(profile.columns.some((column) => column.name === "channel"));

  const query = compileQuery("orders", profile.columns.map((column) => column.name), {
    filters: [{ field: "channel", op: "eq", value: "B" }],
    dimensions: [{ field: "channel" }],
    measures: [{ agg: "count", alias: "orders" }]
  });
  const result = await engine.query(orders, query);
  assert.deepEqual(result.rows, [{ channel: "B", orders: 12 }]);
  engine.close();
});

test("rejects mutating raw SQL", async () => {
  const engine = new DuckDbEngine();
  await assert.rejects(() => engine.queryRaw(orders, "DELETE FROM orders"), /query_rejected/);
  await assert.rejects(() => engine.queryRaw(orders, "SELECT * FROM orders; DELETE FROM orders"), /query_rejected/);
  await assert.rejects(() => engine.queryRaw(orders, "-- explain\nCREATE TABLE bad(x int)"), /query_rejected/);
  engine.close();
});
