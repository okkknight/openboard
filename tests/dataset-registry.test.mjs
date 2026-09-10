import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatasetRegistry } from "../dist/data/dataset-registry.js";
import { DuckDbEngine } from "../dist/data/duckdb-engine.js";

test("discovers only CSV and Parquet files with stable relative-path IDs", async () => {
  const root = await mkdtemp(join(tmpdir(), "openboard-data-"));
  try {
    await mkdir(join(root, "sub"));
    await writeFile(join(root, "orders.csv"), "channel\nA\n");
    await writeFile(join(root, "users.csv"), "user\nlin\n");
    await writeFile(join(root, "notes.txt"), "ignore");
    await writeFile(join(root, "sub", "users.parquet"), "fixture");

    const datasets = await new DatasetRegistry().discover(root);
    assert.deepEqual(datasets.map((dataset) => dataset.id), ["orders", "sub__users", "users"]);
    assert.deepEqual(datasets.map((dataset) => dataset.format), ["csv", "parquet", "csv"]);
    const resolvedRoot = await realpath(root);
    assert.ok(datasets.every((dataset) => dataset.path.startsWith(resolvedRoot)));
    const engine = new DuckDbEngine();
    const profiles = await Promise.all(datasets.filter((dataset) => dataset.id !== "sub__users").map((dataset) => engine.inspect(dataset)));
    assert.deepEqual(profiles.map((profile) => profile.row_count), [1, 1]);
    engine.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
