import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_NAMES } from "../dist/mcp/server.js";

test("exposes exactly the nine frozen MCP tool names", () => {
  assert.deepEqual(TOOL_NAMES, [
    "canvas.inspect", "data.inspect", "data.query", "visual.create", "visual.patch",
    "visual.clone", "canvas.compose", "canvas.annotate", "history.apply"
  ]);
});
