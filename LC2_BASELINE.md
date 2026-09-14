# LC2 baseline and conformance

Date: 2026-09-14

Branch: `codex/lc2-retained-construction`
Base commit: `278323a`

## Verification

```text
npm install
npm run verify:core
```

Result: contract validation passed and the full Node test suite passed: 86 tests, 0 failures, 0 skipped.

The worktree needs its own `node_modules/`: the browser server resolves static Plot and D3 bundles from the active checkout. Before `npm install`, its `/assets/plot.js` request could not resolve the nested worktree path and the web-smoke runner waited on that response. This is setup-only drift, not a product behavior change.

## Renderer baseline confirmed from current source

- `web/index.html` builds a detached `Plot.plot(...)` SVG and calls `plot.replaceChildren(svg)` for every completed plot render.
- `CompiledMark.id` exists in `src/render/plot-compiler.ts`, but `markToPlot` passes only mark type/options to Observable Plot. Browser Plot geometry has no mark id or datum key.
- Primitive layers preserve `data-primitive=<mark.id>` only on their group; individual primitive values are unkeyed.
- `DataCanvasRuntime` already owns artifact caching and work-scoped generations. Work events include increasing work `sequence` values.
- Browser visual fetches have no per-visual response token or abort path. An older fetch can still write after a newer request resolves.
- Work previews currently set `animate = !workId`, so they intentionally skip existing entrance animation.
- `layout.changed` reaches `reloadScene()`, which calls `renderEffectiveScene()` and re-renders every visual.

## Audit currency

`openboard-lc2-engineering-package/source-audits/CURRENT_IMPLEMENTATION_REPORT.md` and `CURRENT_IMPLEMENTATION_MAP.txt` are pre-LC0/LC1 historical records. Their no-WorkSession/render-before-visible-state model is expected drift, not a mismatch with the current runtime.

The renderer audit and DOM map correctly describe the current retained-card/rebuilt-SVG boundary. LC2 begins at the RenderArtifact boundary without changing durable Scene or WorkSession semantics.
