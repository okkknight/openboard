# LC2 Phase 2 — Retained reconciliation

## Implementation

- Plot is now a detached geometry producer. The browser normalizes its output into a stable SVG viewport with replaceable axes and keyed mark layers.
- Keys come only from the versioned render artifact. Plot layers are annotated by a trusted `render` wrapper; primitive SVG values carry their compiler-provided `render_key`.
- Compatible keyed elements are reconciled by maps as `ENTER`, `UPDATE`, and `EXIT`; nonretainable or type-changed layers use explicit `replace-layer`.
- A per-visual request-generation tracker ignores an older response before it can mutate the DOM.

## Automated evidence

`npm run verify:core` passed on 2026-09-14: contracts validated and 100 tests passed, 0 failed.

Focused reconciliation coverage verifies keyed A/B/C -> A/C/D planning, nonretainable replacement, mark-type replacement, and stale-generation rejection. The web smoke coverage confirms the browser receives the reconciliation asset and generation guard.

## Browser evidence

A local browser probe rendered a `barY` visual, captured the SVG root and channel-A bar references through the browser debugger, then applied a same-visual patch. Both references compared equal after the update; the card title changed and exactly one SVG root remained.

The same probe rendered a primitive polar `arc` visual and applied a patch. The channel-A arc path reference compared equal after the update.

The earlier direct-child lookup bug exposed by this probe was fixed by indexing keyed descendants within a mark layer rather than assuming Observable Plot has no internal grouping.
