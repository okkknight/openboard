import test from "node:test";
import assert from "node:assert/strict";
import { createMotionPolicy } from "../web/motion-policy.js";

const input = { phase: "data-enter", operation: "enter", family: "bar", index: 2, elementCount: 4 };

test("uses restrained timing and a bounded entry stagger", () => {
  const policy = createMotionPolicy({ reduced: () => false, hidden: () => false });
  assert.deepEqual(policy.forOperation(input), {
    animate: true,
    duration: 280,
    delay: 48,
    easing: "cubic-bezier(.2,.8,.2,1)",
    mode: "baseline-enter"
  });
});

test("uses opacity only for reduced motion and skips animation in hidden tabs", () => {
  const reduced = createMotionPolicy({ reduced: () => true, hidden: () => false });
  const reducedDecision = reduced.forOperation(input);
  assert.equal(reducedDecision.mode, "opacity-only");
  assert.equal(reducedDecision.duration, 100);
  assert.equal(reducedDecision.delay, 0);

  const hidden = createMotionPolicy({ reduced: () => false, hidden: () => true });
  assert.equal(hidden.forOperation(input).animate, false);
});

test("replaces per-element animation with one layer transition above the cap", () => {
  const policy = createMotionPolicy({ reduced: () => false, hidden: () => false, maxAnimatedElements: 120 });
  assert.equal(policy.forOperation({ ...input, index: 4, elementCount: 121 }).animate, false);
  assert.deepEqual(policy.forLayer({ phase: "data-enter", elementCount: 121 }), {
    animate: true,
    duration: 280,
    easing: "cubic-bezier(.2,.8,.2,1)",
    mode: "layer-fade"
  });
  assert.equal(policy.forLayer({ phase: "data-enter", elementCount: 120 }).animate, false);
});

test("uses update and layout-settle timing classes", () => {
  const policy = createMotionPolicy({ reduced: () => false, hidden: () => false });
  assert.equal(policy.forOperation({ ...input, phase: "semantic-update", operation: "update" }).duration, 220);
  assert.equal(policy.forOperation({ ...input, phase: "layout-settle", operation: "update" }).duration, 180);
});
