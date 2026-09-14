# LC2 implementation report

## Delivered architecture

- Render artifacts carry typed deterministic mark identity and semantic render keys.
- Observable Plot remains the detached geometry producer; the browser retains one SVG viewport and reconciles keyed mark descendants while replacing axes separately.
- Primitive SVG layers use the same key contract. Browser probes verified strict DOM-reference retention for a channel-A bar and arc slice across compatible visual patches.
- Browser request generations reject stale responses. Motion is derived from reconciliation operations and reduced-motion preserves the final semantic state without decorative movement.
- Spatial layout events update retained cards with FLIP-style geometry only; they do not call the visual-render endpoint.
- Cross-family planning handles bar/dot, bar/arc, and bar/line via coordinated exit/enter; unsupported pairs use the same visible fallback.

## Verification

- `npm run verify:core` on 2026-09-14: 105 passed, 0 failed; contracts validated.
- Browser DOM probe: root SVG and channel-A `barY` element compared `===` after a same-visual patch; exactly one SVG root remained.
- Browser DOM probe: a primitive channel-A arc path compared `===` after a compatible patch.
- Reconciliation planner mean wall time over 100 runs: 10 marks 0.006 ms; 100 marks 0.025 ms; 1000 marks 0.186 ms. These are local planner measurements, not end-to-end browser timing claims.
- Construction-pattern audit found no runtime fake progress/staged replay. The sole browser `setTimeout` is WebSocket reconnect backoff; test-only waits remain in test files.

## Remaining acceptance evidence to collect

- Automated browser regression coverage for A/B/C → A/C/D EXIT completion ordering and the visual bar→pie transition.
- A timed 5s+ WorkSession browser recording and an instrumented DuckDB query-count assertion for layout-only motion.

The runtime behavior and unit/integration coverage are in place, but these browser-level evidence artifacts remain intentionally listed rather than claimed as completed.
