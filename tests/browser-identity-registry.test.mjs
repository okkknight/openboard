import test from "node:test";
import assert from "node:assert/strict";
import { createRenderIdentityRegistry } from "../web/render-identity-registry.js";

test("exposes browser mark identity without inspecting DOM order or ARIA labels", () => {
  const registry = createRenderIdentityRegistry();
  registry.remember({
    artifact_version: 2,
    visual_id: "orders",
    generation: 3,
    revision: 12,
    identity: {
      visual_key: "visual:orders",
      marks: [{
        mark_id: "bars",
        renderer: "plot",
        mark_type: "barY",
        identity_mode: "datum",
        key_fields: ["channel"],
        layer_key: "plot:bars"
      }]
    }
  }, {
    marks: [{ id: "bars", render_keys: ["mark=bars|key=[[\"string\",\"A\"]]"] }],
    primitives: []
  });

  assert.deepEqual(registry.mark("orders", "bars"), {
    mark_id: "bars",
    renderer: "plot",
    mark_type: "barY",
    identity_mode: "datum",
    key_fields: ["channel"],
    layer_key: "plot:bars",
    render_keys: ["mark=bars|key=[[\"string\",\"A\"]]"]
  });
  assert.equal(registry.generation("orders"), 3);
});
