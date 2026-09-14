# LC2 Acceptance Matrix

| ID | Scenario | Required evidence |
|---|---|---|
| ID-01 | bar A/B/C -> A/C/D | A and C DOM nodes retained; B EXIT; D ENTER |
| ID-02 | reorder C/A/B | all surviving datum nodes retained despite order change |
| ID-03 | value A 100 -> 160 | A node retained, geometry UPDATE |
| ID-04 | line series values change | line series node/layer identity retained |
| ID-05 | primitive donut innerRadius changes | slice paths retain per-datum identity |
| RACE-01 | generation 8 response arrives after 9 | generation 8 does zero DOM writes |
| AXIS-01 | domain changes | axis subtree may replace; mark continuity remains |
| WORK-01 | WorkSession draft -> marks -> patch | motion occurs on real working states; no replay |
| WORK-02 | work.commit | retained working DOM converges to durable scene without restart animation |
| WORK-03 | work.cancel | durable state restored; no persistent history pollution |
| LAYOUT-01 | move one card | no DuckDB query; unrelated plot DOM untouched |
| SPACE-01 | derived visual creation | new card originates near parent then constructs its marks |
| XMARK-01 | bar -> pie | no hard cut; defined exit+enter/cross strategy |
| REDUCE-01 | reduced motion | identical semantic end states, minimal/no decorative motion |
| REG-01 | existing open grammar | bar/line/area/dot/rule/text/arc/path/mixed layers pass |
| PERF-01 | 100 marks | reconcile measured, no intentional fake delay |
| PERF-02 | 1000 marks | stagger degrades/disabled; no animation explosion |
