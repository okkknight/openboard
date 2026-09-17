import test from "node:test";
import assert from "node:assert/strict";
import { WorkSessionStore } from "../dist/runtime/work-session-store.js";

function durableScene(revision = 20) {
  return {
    canvas_id: "work-test",
    revision,
    datasets: {},
    visuals: {},
    annotations: {},
    canvas: {}
  };
}

function visual(id = "v1") {
  return {
    id,
    kind: "plot",
    source: "orders",
    query: {},
    marks: [],
    layout: { x: 0, y: 0, w: 320, h: 200 }
  };
}

test("begin records an ephemeral base revision without changing the durable scene", () => {
  const durable = durableScene();
  const before = structuredClone(durable);
  const works = new WorkSessionStore();

  const work = works.begin(durable);

  assert.equal(work.base_revision, 20);
  assert.equal(work.sequence, 1);
  assert.equal(work.status, "active");
  assert.deepEqual(durable, before);
  assert.deepEqual(works.effectiveScene(work.id, durable), before);
});

test("a title-only draft is immediately visible in the effective scene but never durable", () => {
  const durable = durableScene();
  const works = new WorkSessionStore();
  const work = works.begin(durable);

  works.createDraft(work.id, { id: "channel-failures", title: "Channel failures" }, durable);

  assert.equal(durable.visuals["channel-failures"], undefined);
  const effective = works.effectiveScene(work.id, durable);
  assert.equal(effective.visuals["channel-failures"].title, "Channel failures");
  assert.throws(() => works.materializeForCommit(work.id, durable), /invalid_work_draft/);
});

test("work drafts cannot overwrite a durable visual and work patches preserve immutable fields", () => {
  const durable = durableScene();
  durable.visuals.v1 = visual();
  const works = new WorkSessionStore();
  const work = works.begin(durable);

  assert.throws(() => works.createDraft(work.id, visual("v1"), durable), /already_exists: visual v1/);
  assert.throws(() => works.patchVisual(work.id, "v1", { set: { id: "hijacked" } }, durable), /immutable_path: id/);
  assert.throws(() => works.patchVisual(work.id, "v1", { set: { derived_from: "other" } }, durable), /immutable_path: derived_from/);
  assert.equal(works.effectiveScene(work.id, durable).visuals.v1.id, "v1");
});

test("work annotations reject duplicate ids and unknown visual targets before commit", () => {
  const durable = durableScene();
  durable.visuals.v1 = visual();
  durable.annotations.note = { id: "note", text: "Existing", created_at: "2026-09-15T00:00:00.000Z" };
  const works = new WorkSessionStore();
  const work = works.begin(durable);

  assert.throws(() => works.annotate(work.id, { id: "note", text: "Duplicate", created_at: "2026-09-15T00:00:00.000Z" }, durable), /already_exists: annotation note/);
  assert.throws(() => works.annotate(work.id, { id: "missing-target", target: "missing", text: "Bad", created_at: "2026-09-15T00:00:00.000Z" }, durable), /not_found: visual missing/);
});
