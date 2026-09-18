import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
  await assert.rejects(() => engine.queryRaw(orders, 'WITH x AS (SELECT 1) UPDATE "orders" SET channel = channel'), /query_rejected/);
  engine.close();
});

test("streams DuckDB result chunks before the entire raw result is materialized", async () => {
  const engine = new DuckDbEngine();
  try {
    const chunks = [];
    for await (const chunk of engine.streamRaw(orders, 'SELECT a.channel AS a, b.channel AS b, c.channel AS c FROM "orders" a CROSS JOIN "orders" b CROSS JOIN "orders" c')) {
      chunks.push(chunk);
    }
    assert.ok(chunks.length > 1);
    assert.deepEqual(chunks[0].columns, ["a", "b", "c"]);
    assert.equal(chunks.reduce((count, chunk) => count + chunk.rows.length, 0), 8_000);
  } finally { engine.close(); }
});

test("describes schema independently and refreshes a registered view after the file changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "openboard-metadata-"));
  const path = join(root, "changing.csv");
  const engine = new DuckDbEngine();
  try {
    await writeFile(path, "name,value\nA,1\n", "utf8");
    const dataset = { id: "changing", path, format: "csv" };
    const first = await engine.describeSchema(dataset);
    assert.deepEqual(first.map((column) => column.name), ["name", "value"]);

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
    await writeFile(path, "name,value,group\nA,1,x\nB,2,y\n", "utf8");
    const second = await engine.describeSchema(dataset);
    assert.deepEqual(second.map((column) => column.name), ["name", "value", "group"]);
    const profile = await engine.inspectProfile(dataset, { fields: ["group"], sample_rows: 1 });
    assert.equal(profile.row_count, 2);
    assert.equal(profile.sample_rows.length, 1);
  } finally {
    engine.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("guards query output with limit plus one and never returns truncated rows", async () => {
  const engine = new DuckDbEngine();
  try {
    const profile = await engine.describeSchema(orders);
    const compiled = compileQuery("orders", profile.map((column) => column.name), {});
    const exceeded = await engine.queryGuarded(orders, compiled, 3);
    assert.equal(exceeded.exceeded, true);
    assert.deepEqual(exceeded.rows, []);

    const safeQuery = compileQuery("orders", profile.map((column) => column.name), { limit: 3 });
    const safe = await engine.queryGuarded(orders, safeQuery, 3);
    assert.equal(safe.exceeded, false);
    assert.equal(safe.rows.length, 3);
  } finally { engine.close(); }
});
