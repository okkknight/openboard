import test from "node:test";
import assert from "node:assert/strict";
import { createSerialTaskQueue } from "../dist/web/work-event-queue.js";

test("keeps a later visual update behind the unresolved draft render", async () => {
  const queue = createSerialTaskQueue();
  const order = [];
  let releaseDraft;
  const draftReady = new Promise((resolve) => { releaseDraft = resolve; });

  const draft = queue.enqueue(async () => {
    order.push("draft:start");
    await draftReady;
    order.push("draft:painted");
  });
  const patch = queue.enqueue(async () => { order.push("patch:render"); });

  await Promise.resolve();
  assert.deepEqual(order, ["draft:start"]);
  releaseDraft();
  await Promise.all([draft, patch]);
  assert.deepEqual(order, ["draft:start", "draft:painted", "patch:render"]);
});
