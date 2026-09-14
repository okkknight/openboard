# LC2 Phase 1 — identity contract evidence

## Implemented boundary

- `RenderIdentityContract` and `MarkIdentityDescriptor` are compiler/runtime-only types; they do not enter Scene, history, or persistence.
- `compilePlot` emits identity descriptors and deterministic `render_keys` for Plot marks.
- Primitive compiled values receive `render_key` when their identity mode is retainable.
- Runtime responses expose a versioned `RenderArtifactV2` containing artifact generation and the identity contract.
- Browser code receives that artifact through a focused registry module. Future reconciliation can inspect mark descriptors and keys without parsing DOM order or ARIA labels.

## Identity rules verified

- Datum keys derive from semantic dimension fields and remain stable through row reorder and filtering.
- Typed canonical keys distinguish string `"1"`, number `1`, null, and Date values.
- Duplicate datum keys fail with `duplicate_render_key`; no row-index fallback exists.
- Line/area marks use series identity when a non-axis grouping field is available, otherwise singleton identity.
- Primitive datum values carry the same canonical key surface.

## Commands and results

```text
npm run build:core && node --test tests/browser-identity-registry.test.mjs tests/render-identity.test.mjs tests/web-smoke.test.mjs
```

Result: 22 tests passed, 0 failures.

```text
npm run verify:core
```

Result before the final focused coverage additions: 93 tests passed, 0 failures. Phase 2 must rerun the full suite after retained reconciliation changes.

## Deliberate boundary

This phase does not retain or reconcile SVG nodes. Existing completed plots still rebuild through `replaceChildren(svg)`. That behavior is Phase 2's explicit RED condition.
