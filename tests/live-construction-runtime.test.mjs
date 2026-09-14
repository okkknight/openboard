import test from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DataCanvasRuntime } from "../dist/runtime/data-canvas-runtime.js";
import { DuckDbEngine } from "../dist/data/duckdb-engine.js";
import { Persistence } from "../dist/runtime/persistence.js";

function deferred() {
  let release;
  const promise = new Promise((resolvePromise) => { release = resolvePromise; });
  return { promise, release };
}

async function waitFor(check) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  }
  throw new Error("timed out waiting for condition");
}

class SlowQueryEngine extends DuckDbEngine {
  constructor(gate) { super(); this.gate = gate; this.queries = 0; }
  async query(dataset, compiled) {
    this.queries += 1;
    await this.gate.promise;
    return super.query(dataset, compiled);
  }
}

class CountingQueryEngine extends DuckDbEngine {
  constructor() { super(); this.queries = 0; }
  async query(dataset, compiled) { this.queries += 1; return super.query(dataset, compiled); }
}

function scene(revision = 20) {
  return { canvas_id: "live", revision, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} };
}

function fullVisual(id = "channel-orders") {
  return {
    id, kind: "plot", title: "Orders by channel", source: "orders",
    query: { dimensions: [{ field: "channel" }], measures: [{ agg: "count", alias: "orders" }] },
    marks: [{ id: "bars", type: "barY", x: "channel", y: "orders" }],
    layout: { x: 0, y: 0, w: 480, h: 320 }
  };
}

test("emits a working visual before its real query resolves", async () => {
  const gate = deferred();
  const engine = new SlowQueryEngine(gate);
  const runtime = new DataCanvasRuntime(scene(), undefined, undefined, { engine });
  const events = [];
  runtime.onEvent((event) => events.push(event));

  const work = await runtime.workApply({ action: "begin" });
  const pending = runtime.visualCreate(fullVisual(), undefined, work.result.work_id);
  await Promise.resolve();

  assert.equal(runtime.inspect().revision, 20);
  assert.equal(runtime.inspect().visuals["channel-orders"], undefined);
  assert.ok(events.some((event) => event.type === "work.visual.changed"));
  assert.equal(events.some((event) => event.type === "work.activity" && event.activity?.kind === "render" && event.activity?.status === "completed"), false);

  gate.release();
  await pending;
  assert.equal(engine.queries, 1);
  runtime.close();
});

test("commits multiple work operations as one durable revision and cancels without mutation", async () => {
  const runtime = new DataCanvasRuntime(scene());
  const first = await runtime.workApply({ action: "begin" });
  const firstId = first.result.work_id;
  await runtime.visualCreate(fullVisual(), undefined, firstId);
  await runtime.visualPatch("channel-orders", { set: { title: "Orders by channel, verified" } }, undefined, firstId);
  await runtime.canvasAnnotate({ id: "note", target: "channel-orders", text: "Real observation", created_at: "2026-09-14T00:00:00.000Z" }, undefined, firstId);

  assert.equal(runtime.inspect().revision, 20);
  assert.equal(runtime.inspect().visuals["channel-orders"], undefined);
  assert.equal(runtime.inspect().annotations.note, undefined);

  const committed = await runtime.workApply({ action: "commit", work_id: firstId });
  assert.equal(committed.revision, 21);
  assert.equal(runtime.inspect().visuals["channel-orders"].title, "Orders by channel, verified");
  assert.equal(runtime.inspect().annotations.note.text, "Real observation");

  const second = await runtime.workApply({ action: "begin" });
  await runtime.visualPatch("channel-orders", { set: { title: "Discarded" } }, undefined, second.result.work_id);
  await runtime.workApply({ action: "cancel", work_id: second.result.work_id });
  assert.equal(runtime.inspect().revision, 21);
  assert.equal(runtime.inspect().visuals["channel-orders"].title, "Orders by channel, verified");
  runtime.close();
});

test("keeps persisted scene and history untouched until one work commit", async () => {
  const root = await mkdtemp(join(tmpdir(), "openboard-live-work-"));
  const initial = scene();
  const persistence = new Persistence(root);
  await persistence.saveScene(initial);
  try {
    const runtime = new DataCanvasRuntime(initial, persistence);
    const work = await runtime.workApply({ action: "begin" });
    await runtime.visualCreate(fullVisual(), undefined, work.result.work_id);
    assert.deepEqual(await persistence.loadScene(), initial);
    assert.deepEqual(await persistence.loadHistory(), []);

    await runtime.workApply({ action: "commit", work_id: work.result.work_id });
    assert.equal((await persistence.loadScene()).revision, 21);
    const history = await persistence.loadHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].operation, "work.commit");
    runtime.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("emits query activity only around a real work query", async () => {
  const runtime = new DataCanvasRuntime(scene());
  const events = [];
  runtime.onEvent((event) => events.push(event));
  const work = await runtime.workApply({ action: "begin" });

  const result = await runtime.dataQuery("orders", { dimensions: [{ field: "channel" }], measures: [{ agg: "count", alias: "orders" }] }, work.result.work_id);

  const activity = events.filter((event) => event.type === "work.activity" && event.activity?.kind === "query");
  assert.equal(result.data.length, 4);
  assert.deepEqual(activity.map((event) => event.activity.status), ["started", "completed"]);
  assert.ok(activity[0].sequence < activity[1].sequence);
  runtime.close();
});

test("returns a work render artifact without issuing a second DuckDB query", async () => {
  const engine = new CountingQueryEngine();
  const runtime = new DataCanvasRuntime(scene(), undefined, undefined, { engine });
  const work = await runtime.workApply({ action: "begin" });

  await runtime.visualCreate(fullVisual(), undefined, work.result.work_id);
  assert.equal(engine.queries, 1);
  const cached = await runtime.renderVisual("channel-orders", work.result.work_id);

  assert.equal(cached.status, "rendered");
  assert.equal(engine.queries, 1);
  runtime.close();
});

test("shares an in-flight work artifact with a browser render request", async () => {
  const gate = deferred();
  const engine = new SlowQueryEngine(gate);
  const runtime = new DataCanvasRuntime(scene(), undefined, undefined, { engine });
  const work = await runtime.workApply({ action: "begin" });

  const create = runtime.visualCreate(fullVisual(), undefined, work.result.work_id);
  await waitFor(() => engine.queries === 1);
  const browserRender = runtime.renderVisual("channel-orders", work.result.work_id);
  await new Promise(setImmediate);
  await new Promise(setImmediate);

  assert.equal(engine.queries, 1);
  gate.release();
  const [created, rendered] = await Promise.all([create, browserRender]);
  assert.equal(created.status, "rendered");
  assert.equal(rendered.status, "rendered");
  assert.equal(engine.queries, 1);
  runtime.close();
});

test("rejects incomplete and conflicted work commits without overwriting durable state", async () => {
  const runtime = new DataCanvasRuntime(scene());
  const incomplete = await runtime.workApply({ action: "begin" });
  await runtime.visualCreate({ id: "draft", title: "Incomplete" }, undefined, incomplete.result.work_id);
  await assert.rejects(() => runtime.workApply({ action: "commit", work_id: incomplete.result.work_id }), /invalid_work_draft/);
  assert.equal(runtime.inspect().revision, 20);

  const conflicted = await runtime.workApply({ action: "begin" });
  await runtime.visualCreate(fullVisual(), undefined, conflicted.result.work_id);
  await runtime.visualCreate({ ...fullVisual("outside"), title: "Outside change" });
  await assert.rejects(() => runtime.workApply({ action: "commit", work_id: conflicted.result.work_id }), /revision_conflict/);
  assert.equal(runtime.inspect().revision, 21);
  assert.equal(runtime.inspect().visuals.outside.title, "Outside change");
  runtime.close();
});
