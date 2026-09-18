import test from "node:test";
import assert from "node:assert/strict";
import { DatasetMetadataCache } from "../dist/data/dataset-metadata-cache.js";

const orders = { id: "orders", path: "/data/orders.csv", format: "csv" };

test("reuses schema while path size and mtime are unchanged", async () => {
  let reads = 0;
  const cache = new DatasetMetadataCache({ stat: async () => ({ size: 20, mtimeMs: 40 }) });
  const load = async () => { reads += 1; return [{ name: "channel", type: "VARCHAR", nullable: true }]; };

  const first = await cache.schema(orders, load);
  const second = await cache.schema(orders, load);

  assert.deepEqual(second, first);
  assert.equal(reads, 1);
});

test("invalidates schema and registration after the source fingerprint changes", async () => {
  let mtimeMs = 40;
  let reads = 0;
  const cache = new DatasetMetadataCache({ stat: async () => ({ size: 20, mtimeMs }) });
  await cache.schema(orders, async () => { reads += 1; return []; });
  cache.markRegistered((await cache.fingerprint(orders)).key);
  assert.equal(await cache.isRegistered(orders), true);

  mtimeMs = 41;
  await cache.schema(orders, async () => { reads += 1; return []; });

  assert.equal(reads, 2);
  assert.equal(await cache.isRegistered(orders), false);
});

test("does not retain a failed schema loader", async () => {
  let attempts = 0;
  const cache = new DatasetMetadataCache({ stat: async () => ({ size: 20, mtimeMs: 40 }) });
  await assert.rejects(() => cache.schema(orders, async () => { attempts += 1; throw new Error("bad schema"); }), /bad schema/);
  const columns = await cache.schema(orders, async () => { attempts += 1; return []; });
  assert.deepEqual(columns, []);
  assert.equal(attempts, 2);
});
