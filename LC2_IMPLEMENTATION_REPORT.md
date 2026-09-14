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
- Browser Scenario A probe: an A/B/C source changed to A/C/D. The SVG root plus A and C elements compared `===`; B was absent after its EXIT, D was present after ENTER, and exactly one SVG root remained.
- Browser DOM probe: a primitive channel-A arc path compared `===` after a compatible patch.
- Reconciliation planner mean wall time over 100 runs: 10 marks 0.006 ms; 100 marks 0.025 ms; 1000 marks 0.186 ms. These are local planner measurements, not end-to-end browser timing claims.
- Construction-pattern audit found no runtime fake progress/staged replay. The sole browser `setTimeout` is WebSocket reconnect backoff; test-only waits remain in test files.
- The runtime suite verifies that a rendered-card `move` keeps DuckDB query count unchanged. Browser layout and removal event paths update retained DOM/metadata rather than re-rendering every visual.

## Scope notes

The live MCP/WebSocket WorkSession end-to-end test covers draft, query activity, visual patch, annotation, ordered events, and commit. Cross-mark family planning is deterministic and the browser transition path waits for an EXIT motion before introducing target arcs; unsupported pairs use the same visible fallback.
