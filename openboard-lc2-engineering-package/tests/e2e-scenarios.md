# Required End-to-End Scenarios

## Scenario A — Retained categorical update

1. Create `orders by channel` bar visual with A/B/C.
2. Record SVG root and A/B/C geometry node references.
3. Patch query/filter so result becomes A/C/D.
4. Assert SVG root retained.
5. Assert A and C node object identity retained.
6. Observe B exit motion and removal after finish.
7. Observe D enter motion.
8. Assert no whole-SVG replacement on compatible update path.

## Scenario B — Live analysis construction

Run an analysis expected to take multiple semantic operations:

```text
analyze last 30 days by product; identify the most anomalous product; expand it by region; leave a concise annotation
```

Record timeline:

- `work.begin`;
- draft visual visible;
- first query completes;
- first mark construction;
- anomaly/highlight patch;
- derived regional visual spatially appears;
- regional marks construct;
- annotation appears;
- `work.commit`.

The sequence must be execution-driven. No delayed replay is acceptable.

## Scenario C — Cross-mark transition

1. Start with channel bar chart.
2. Patch same Visual to pie/donut representation.
3. Shared `channel` identities must be available to the transition planner.
4. Bars exit/collapse and arcs sweep enter; a hard instantaneous replacement fails acceptance.
5. Patch donut inner radius; same slice nodes should update where primitive geometry permits.

## Scenario D — Race

1. Trigger generation N render with artificial test latency.
2. Trigger generation N+1 render that resolves first.
3. N+1 paints.
4. N later resolves and is discarded.
5. Canvas must never visually rewind.

## Scenario E — Spatial layout only

1. Move/resize a visual card.
2. Count DuckDB calls before/after.
3. Assert no new data query solely from layout change.
4. Assert visual SVG root and mark nodes survive.
