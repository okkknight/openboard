import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const scene = JSON.parse(await readFile(new URL("../contracts/scene.schema.json", import.meta.url), "utf8"));
const tools = JSON.parse(await readFile(new URL("../contracts/tool-surface.json", import.meta.url), "utf8"));
const output = JSON.parse(await readFile(new URL("../contracts/tool-output.schema.json", import.meta.url), "utf8"));
const events = JSON.parse(await readFile(new URL("../contracts/events.schema.json", import.meta.url), "utf8"));

assert.equal(scene.title, "Data Canvas Scene");
assert.equal(output.title, "Data Canvas Tool Output");
assert.equal(events.title, "Data Canvas Scene Event");
assert.equal(tools.tool_count, 9);
assert.equal(tools.tools.length, 9);
const names = tools.tools.map((tool) => tool.name);
assert.deepEqual(names, [
  "canvas.inspect",
  "data.inspect",
  "data.query",
  "visual.create",
  "visual.patch",
  "visual.clone",
  "canvas.compose",
  "canvas.annotate",
  "history.apply"
]);
assert.equal(new Set(names).size, names.length);
console.log("contracts ok: scene + outputs + events, 9 unique tools");
