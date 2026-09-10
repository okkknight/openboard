import test from "node:test";
import assert from "node:assert/strict";
import { compilePrimitive } from "../dist/render/primitive-compiler.js";

test("compiles polar arc sectors from an angle encoding", () => {
  const layer = compilePrimitive({
    id: "slices", renderer: "primitive", type: "arc",
    encoding: { angle: { field: "orders" }, color: { field: "channel" } }
  }, [{ channel: "A", orders: 3 }, { channel: "B", orders: 1 }], { type: "polar" });
  assert.equal(layer.values.length, 2);
  assert.equal(layer.values[0].innerRadius, 0);
  assert.equal(layer.values[0].outerRadius, 1);
  assert.ok(Number(layer.values[0].endAngle) > Number(layer.values[0].startAngle));
  assert.equal(layer.values[1].color, "B");
});

test("patching innerRadius changes only the primitive geometry", () => {
  const layer = compilePrimitive({
    id: "slices", renderer: "primitive", type: "arc",
    encoding: { angle: { field: "orders" }, innerRadius: { constant: 0.55 } }
  }, [{ orders: 4 }], { type: "polar" });
  assert.equal(layer.values[0].innerRadius, 0.55);
  assert.equal(layer.values[0].outerRadius, 1);
});

test("radial encoding normalizes radius without a rose chart type", () => {
  const layer = compilePrimitive({
    id: "rose", renderer: "primitive", type: "arc",
    encoding: { angle: { field: "orders" }, radius: { field: "orders" } }
  }, [{ orders: 2 }, { orders: 8 }], { type: "polar" });
  assert.equal(layer.values[0].outerRadius, 0.25);
  assert.equal(layer.values[1].outerRadius, 1);
});

test("allows a derived encoding to reference a precomputed query result", () => {
  const layer = compilePrimitive({ id: "c", renderer: "primitive", type: "circle", encoding: { radius: { derived: "scaled_orders" } } }, [{ scaled_orders: 7 }]);
  assert.equal(layer.values[0]._radius, 7);
});

test("compiles safe path, circle, and text primitives", () => {
  const rows = [{ x: 10, y: 20, label: "hello" }];
  assert.equal(compilePrimitive({ id: "p", renderer: "primitive", type: "path", options: { d: "M0 0 L10 10 Z" } }, rows).values.length, 1);
  assert.equal(compilePrimitive({ id: "c", renderer: "primitive", type: "circle", encoding: { x: { field: "x" }, y: { field: "y" }, radius: { constant: 4 } } }, rows).values[0]._radius, 4);
  assert.equal(compilePrimitive({ id: "t", renderer: "primitive", type: "text", encoding: { x: { field: "x" }, y: { field: "y" }, text: { field: "label" } } }, rows).values[0]._text, "hello");
});

test("rejects unsafe path data and invalid primitive encoding", () => {
  assert.throws(() => compilePrimitive({ id: "p", renderer: "primitive", type: "path", options: { d: "M0 0 <script>" } }, []), /invalid_path|unsafe/);
  assert.throws(() => compilePrimitive({ id: "c", renderer: "primitive", type: "circle", encoding: { x: { field: "missing" } } }, [{ x: 1 }]), /invalid_encoding/);
});
