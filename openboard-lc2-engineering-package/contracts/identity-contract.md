# Render Identity Contract

## Objective

Give every retainable visual layer and renderable semantic unit a deterministic identity before browser geometry is reconciled.

## Required levels

1. `visual_id` — stable existing VisualSpec id.
2. `mark_id` — stable VisualSpec mark id, preserved through compile and browser artifact.
3. `layer_key` — deterministic mark-layer key such as `<renderer>:<mark_id>`.
4. `render_key` — datum or series identity within a retainable layer.

## Modes

- `datum`: one retained geometry node per semantic datum.
- `series`: one retained geometry node per semantic series/group.
- `singleton`: exactly one node/layer instance under `mark_id`.
- `nonretainable`: identity cannot be proven; reconcile only at layer granularity.

## Key derivation

Key fields come from semantic dimensions/grouping, not array position. Canonicalization must preserve types:

```json
[["string","B"],["date","2026-09-14"],["null",null]]
```

DOM-safe key encoding may hash this canonical tuple, but tests must prove deterministic output and collision resistance for the repository's supported scalar types.

## Series rules

For line/area, key by series/group fields, not every point. Single-series line/area may use a singleton key under its mark id.

## Validation

Tests must cover:

- reordered rows produce same keys;
- filtered rows preserve surviving keys;
- string `"1"` differs from number `1`;
- null differs from empty string;
- date canonicalization is stable;
- duplicate datum keys are detected;
- no fallback to current array index for a declared retainable mark.
