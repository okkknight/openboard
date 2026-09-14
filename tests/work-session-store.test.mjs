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

  works.createDraft(work.id, { id: "channel-failures", title: "Channel failures" });

  assert.equal(durable.visuals["channel-failures"], undefined);
  const effective = works.effectiveScene(work.id, durable);
  assert.equal(effective.visuals["channel-failures"].title, "Channel failures");
  assert.throws(() => works.materializeForCommit(work.id, durable), /invalid_work_draft/);
});
