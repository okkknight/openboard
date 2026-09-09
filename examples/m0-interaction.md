# M0 interaction trace

Use this exact scenario for the first end-to-end acceptance test.

## Step 1 — inspect data

User intent:

> 看一下这批订单最近一个月各渠道的失败情况。

Expected agent operations:

1. `data.inspect(dataset="orders")`
2. `visual.create(...)`

The initial visual should group by `channel` and expose an order count and failure-rate measure. A bar mark is acceptable.

Record returned visual id as `V`.

## Step 2 — mutate the same object

User intent:

> 不看渠道排名了，改成最近30天每天的失败率趋势。

Expected operation:

`visual.patch(id=V, ...)`

Acceptance:

- returned visual id is still `V`;
- scene revision increments once;
- browser updates without full page reload;
- no new visual is created;
- no HTML/CSS/React source appears in the operation/history payload.

## Step 3 — branch only when comparison is useful

User intent:

> B渠道保留，旁边单独按城市展开。

Expected:

1. `visual.clone(id=V, placement="right")`
2. patch clone query to filter `channel=B` and group by `city`.

The original remains visible for comparison.
