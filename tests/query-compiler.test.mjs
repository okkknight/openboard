import test from "node:test";
import assert from "node:assert/strict";
import { assertRenderable, compileQuery } from "../dist/core/query-compiler.js";

test("quotes identifiers and parameterizes filter values", () => {
  const q = compileQuery("orders", ["channel", "amount"], {
    filters: [{ field: "channel", op: "eq", value: "A" }],
    dimensions: [{ field: "channel" }],
    measures: [{ field: "amount", agg: "sum", alias: "revenue" }]
  });
  assert.match(q.sql, /"channel"/);
  assert.match(q.sql, /SUM\("amount"\)/);
  assert.deepEqual(q.params, ["A"]);
  assert.ok(!q.sql.includes("'A'"));
});

test("rejects unknown columns", () => {
  assert.throws(
    () => compileQuery("orders", ["channel"], { filters: [{ field: "secret", op: "eq", value: "x" }] }),
    /unknown_column: secret/
  );
});

test("time grain produces a dated dimension alias", () => {
  const q = compileQuery("orders", ["created_at"], {
    dimensions: [{ field: "created_at", time_grain: "day", alias: "day" }]
  });
  assert.match(q.sql, /date_trunc\('day', "created_at"\) AS "day"/);
  assert.match(q.sql, /GROUP BY 1/);
});

test("raw sql cannot be mixed with structured fields", () => {
  assert.throws(
    () => compileQuery("orders", ["channel"], { sql: "select * from orders", dimensions: [{ field: "channel" }] }),
    /mixed_raw_sql/
  );
});

test("rejects an over-limit raw result unless the caller explicitly samples", () => {
  assert.throws(
    () => assertRenderable(50_001, 50_000),
    (error) => error.code === "render_limit_exceeded" && error.requested_rows === 50_001 && error.limit === 50_000
  );
  assert.doesNotThrow(() => assertRenderable(50_001, 50_000, { method: "reservoir", size: 20_000 }));
});
