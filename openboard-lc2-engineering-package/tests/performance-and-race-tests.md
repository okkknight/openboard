# Performance and Race Test Requirements

## Race correctness

Use a fake/delayed visual endpoint or test render adapter so two generations resolve out of order. Correctness is decided by generation, not completion order.

## Mark count probes

Measure reconciliation planning + DOM application for representative:

- 10 marks;
- 100 marks;
- 1000 marks.

Do not turn these into brittle universal timing assertions. Record measurements and enforce architectural limits:

- no O(N²) datum matching;
- use maps keyed by `render_key`;
- no stagger proportional to thousands of marks;
- stale generation does no reconciliation work after detection.

## Query count probe

Layout-only motion: zero query calls.

Compatible style-only retained update: no extra query beyond what runtime semantics actually require.
Browser fetch of cached artifact: no duplicate DuckDB execution.
