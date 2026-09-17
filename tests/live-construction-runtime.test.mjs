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
  async *stream(dataset, compiled) {
    this.queries += 1;
    await this.gate.promise;
    yield* super.stream(dataset, compiled);
  }
}

class CountingQueryEngine extends DuckDbEngine {
  constructor() { super(); this.queries = 0; }
  async *stream(dataset, compiled) { this.queries += 1; yield* super.stream(dataset, compiled); }
}

class GatedStreamingEngine extends DuckDbEngine {
  constructor(gate) { super(); this.gate = gate; }
  async *stream() {
    yield { columns: ["channel", "orders"], rows: [{ channel: "A", orders: 8 }] };
    await this.gate.promise;
    yield { columns: ["channel", "orders"], rows: [{ channel: "B", orders: 12 }] };
  }
}

class FailingCommitPersistence extends Persistence {
  async saveRuntimeState() { throw new Error("simulated_disk_failure"); }
}

class FailsOnceCommitPersistence extends Persistence {
  attempts = 0;
  async saveRuntimeState(state) {
    this.attempts += 1;
    if (this.attempts === 1) throw new Error("simulated_disk_failure");
    return super.saveRuntimeState(state);
  }
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

test("direct visual creation also exposes working state before a slow render", async () => {
  const gate = deferred();
  const engine = new SlowQueryEngine(gate);
  const runtime = new DataCanvasRuntime(scene(), undefined, undefined, { engine });
  const events = [];
  runtime.onEvent((event) => events.push(event));

  const work = await runtime.workApply({ action: "begin" });
  const pending = runtime.visualCreate(fullVisual(), undefined, work.result.work_id);
  await waitFor(() => events.some((event) => event.type === "work.visual.changed"));
  assert.equal(runtime.inspect().visuals["channel-orders"], undefined);
  assert.equal(events.some((event) => event.type === "work.activity" && event.activity?.kind === "render" && event.activity?.status === "completed"), false);

  gate.release();
  const result = await pending;
  assert.equal(result.revision, 20);
  assert.equal(runtime.inspect().visuals["channel-orders"], undefined);
  await runtime.workApply({ action: "cancel", work_id: work.result.work_id });
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

test("rolls back a work commit when atomically persisting its durable state fails", async () => {
  const runtime = new DataCanvasRuntime(scene(), new FailingCommitPersistence("/tmp/openboard-failing-commit"));
  const events = [];
  runtime.onEvent((event) => events.push(event));
  const work = await runtime.workApply({ action: "begin" });
  await runtime.visualCreate(fullVisual(), undefined, work.result.work_id);

  await assert.rejects(() => runtime.workApply({ action: "commit", work_id: work.result.work_id }), /simulated_disk_failure/);

  assert.equal(runtime.inspect().revision, 20);
  assert.equal(runtime.inspect().visuals["channel-orders"], undefined);
  assert.equal(runtime.inspectWorkSnapshots().find((entry) => entry.work.id === work.result.work_id)?.work.status, "active");
  assert.equal(events.some((event) => event.type === "work.completed"), false);
  runtime.close();
});

test("retries a rolled-back work commit after persistence recovers", async () => {
  const root = await mkdtemp(join(tmpdir(), "openboard-retry-commit-"));
  try {
    const persistence = new FailsOnceCommitPersistence(root);
    const runtime = new DataCanvasRuntime(scene(), persistence);
    const work = await runtime.workApply({ action: "begin" });
    await runtime.visualCreate(fullVisual(), undefined, work.result.work_id);

    await assert.rejects(() => runtime.workApply({ action: "commit", work_id: work.result.work_id }), /simulated_disk_failure/);
    const committed = await runtime.workApply({ action: "commit", work_id: work.result.work_id });

    assert.equal(committed.revision, 21);
    assert.equal(runtime.inspect().visuals["channel-orders"].title, "Orders by channel");
    assert.equal((await persistence.loadScene()).revision, 21);
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

test("work render activity and completion identify only their affected visuals", async () => {
  const runtime = new DataCanvasRuntime(scene());
  const events = [];
  runtime.onEvent((event) => events.push(event));
  const work = await runtime.workApply({ action: "begin" });

  await runtime.visualCreate(fullVisual("affected"), undefined, work.result.work_id);
  await runtime.workApply({ action: "commit", work_id: work.result.work_id });

  const renderActivity = events.find((event) => event.type === "work.activity" && event.activity?.kind === "render");
  const completed = events.find((event) => event.type === "work.completed");
  assert.equal(renderActivity.activity.visual_id, "affected");
  assert.deepEqual(completed.affected_ids, ["affected"]);
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

test("publishes a renderable work artifact for each real DuckDB stream chunk", async () => {
  const gate = deferred();
  const runtime = new DataCanvasRuntime(scene(), undefined, undefined, { engine: new GatedStreamingEngine(gate) });
  const events = [];
  runtime.onEvent((event) => events.push(event));
  const work = await runtime.workApply({ action: "begin" });
  const creating = runtime.visualCreate(fullVisual(), undefined, work.result.work_id);

  await waitFor(() => events.some((event) => event.type === "work.render.chunk"));
  const chunk = events.find((event) => event.type === "work.render.chunk");
  const partial = await runtime.renderVisual("channel-orders", work.result.work_id, chunk.payload.artifact_generation);
  assert.equal(partial.result.rows, 1);
  assert.equal(events.some((event) => event.type === "work.activity" && event.activity?.status === "completed"), false);

  gate.release();
  const completed = await creating;
  assert.equal(completed.result.rows, 2);
  assert.equal(events.filter((event) => event.type === "work.render.chunk").length, 2);
  runtime.close();
});

test("streams the real orders aggregation as progressive artifacts before the final render", async () => {
  const runtime = new DataCanvasRuntime(scene());
  const events = [];
  runtime.onEvent((event) => events.push(event));
  const work = await runtime.workApply({ action: "begin" });
  const result = await runtime.visualCreate(fullVisual(), undefined, work.result.work_id);
  const chunks = events.filter((event) => event.type === "work.render.chunk");

  const rowCounts = chunks.map((event) => event.payload.row_count);
  assert.ok(rowCounts.length > 1);
  assert.equal(rowCounts.at(-1), 4);
  assert.ok(rowCounts.every((count, index) => index === 0 || count > rowCounts[index - 1]));
  assert.equal(result.result.rows, 4);
  const finalChanged = events.findLastIndex((event) => event.type === "work.visual.changed");
  assert.ok(chunks.at(-1).sequence < events[finalChanged].sequence);
  runtime.close();
});

test("moving a rendered card does not issue another DuckDB query", async () => {
  const engine = new CountingQueryEngine();
  const runtime = new DataCanvasRuntime(scene(), undefined, undefined, { engine });
  const work = await runtime.workApply({ action: "begin" });
  await runtime.visualCreate(fullVisual(), undefined, work.result.work_id);
  const before = engine.queries;

  await runtime.canvasCompose({ action: "move", target: "channel-orders", layout: { x: 120, y: 48, w: 520, h: 340 } }, undefined, work.result.work_id);

  assert.equal(engine.queries, before);
  await runtime.workApply({ action: "commit", work_id: work.result.work_id });
  assert.deepEqual(runtime.inspect().visuals["channel-orders"].layout, { x: 120, y: 48, w: 520, h: 340 });
  runtime.close();
});

test("keeps a five-second work session as execution-driven construction through commit", async () => {
  const gate = deferred();
  const engine = new SlowQueryEngine(gate);
  const runtime = new DataCanvasRuntime(scene(), undefined, undefined, { engine });
  const events = [];
  runtime.onEvent((event) => events.push({ at: performance.now(), ...event }));
  const begun = await runtime.workApply({ action: "begin" });
  const create = runtime.visualCreate(fullVisual(), undefined, begun.result.work_id);

  await waitFor(() => events.some((event) => event.type === "work.visual.changed"));
  const workingAt = events.find((event) => event.type === "work.visual.changed").at;
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 5100));
  gate.release();
  await create;
  await runtime.visualClone("channel-orders", "regional-orders", { set: { title: "Regional follow-up", layout: { x: 520, y: 0, w: 480, h: 320 } } }, undefined, begun.result.work_id);
  await runtime.canvasAnnotate({ id: "finding", target: "channel-orders", text: "Execution-backed finding", created_at: "2026-09-14T00:00:00.000Z" }, undefined, begun.result.work_id);
  await runtime.workApply({ action: "commit", work_id: begun.result.work_id });

  const completed = events.find((event) => event.type === "work.completed");
  assert.ok(completed.at - workingAt >= 5000);
  assert.equal(runtime.inspect().visuals["regional-orders"].derived_from, "channel-orders");
  assert.equal(runtime.inspect().annotations.finding.text, "Execution-backed finding");
  assert.equal(events.at(-1).type, "work.completed");
  runtime.close();
});

test("returns a working response to the browser while a shared work stream is in flight", async () => {
  const gate = deferred();
  const engine = new SlowQueryEngine(gate);
  const runtime = new DataCanvasRuntime(scene(), undefined, undefined, { engine });
  const work = await runtime.workApply({ action: "begin" });

  const create = runtime.visualCreate(fullVisual(), undefined, work.result.work_id);
  await waitFor(() => engine.queries === 1);
  const browserRender = runtime.renderVisual("channel-orders", work.result.work_id);
  try {
    const pending = Symbol("pending");
    const rendered = await Promise.race([browserRender, new Promise((resolvePromise) => setImmediate(() => resolvePromise(pending)))]);
    assert.notEqual(rendered, pending);
    assert.equal(rendered.status, "working");
    assert.equal(engine.queries, 1);
  } finally {
    gate.release();
  }
  const created = await create;
  const final = await runtime.renderVisual("channel-orders", work.result.work_id);
  assert.equal(created.status, "rendered");
  assert.equal(final.status, "rendered");
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
  const outside = await runtime.workApply({ action: "begin" });
  await runtime.visualCreate({ ...fullVisual("outside"), title: "Outside change" }, undefined, outside.result.work_id);
  await runtime.workApply({ action: "commit", work_id: outside.result.work_id });
  await assert.rejects(() => runtime.workApply({ action: "commit", work_id: conflicted.result.work_id }), /revision_conflict/);
  assert.equal(runtime.inspect().revision, 21);
  assert.equal(runtime.inspect().visuals.outside.title, "Outside change");
  runtime.close();
});

test("rejects every chart and data operation that omits an explicit work session", async () => {
  const runtime = new DataCanvasRuntime(scene(0));
  await assert.rejects(() => runtime.visualCreate(fullVisual()), /work_required/);
  await assert.rejects(() => runtime.visualPatch("missing", { set: { title: "No bypass" } }), /work_required/);
  await assert.rejects(() => runtime.visualClone("missing", "copy"), /work_required/);
  assert.equal(runtime.inspect().revision, 0);
  assert.deepEqual(Object.keys(runtime.inspect().visuals), []);
  runtime.close();
});
