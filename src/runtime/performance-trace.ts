import { randomUUID } from "node:crypto";

export type TraceMilestoneName =
  | "request_received"
  | "work_started"
  | "schema_ready"
  | "query_started"
  | "query_first_chunk"
  | "query_completed"
  | "visual_first_paint"
  | "visual_settled"
  | "work_committed";

export interface TraceMilestone {
  name: TraceMilestoneName;
  at_ms: number;
  metrics?: Record<string, number | boolean | string>;
}

export interface TraceSnapshot {
  trace_id: string;
  milestones: TraceMilestone[];
  durations: Record<string, number>;
}

export interface PerformanceTrace {
  readonly id: string;
  mark(name: TraceMilestoneName, metrics?: Record<string, unknown>): void;
  snapshot(): TraceSnapshot;
}

const SAFE_METRICS = new Set(["cache_hit", "query_key", "output_rows", "chunk_index", "limit", "elapsed_ms"]);

function safeMetrics(metrics?: Record<string, unknown>): Record<string, number | boolean | string> | undefined {
  if (!metrics) return undefined;
  const safe: Record<string, number | boolean | string> = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (!SAFE_METRICS.has(key) || !["number", "boolean", "string"].includes(typeof value)) throw new Error(`unsafe_trace_metric: ${key}`);
    safe[key] = value as number | boolean | string;
  }
  return Object.keys(safe).length ? safe : undefined;
}

export function createTrace(clock: () => number = () => performance.now(), id = randomUUID()): PerformanceTrace {
  const milestones: TraceMilestone[] = [];
  const seen = new Set<TraceMilestoneName>();
  return {
    id,
    mark(name, metrics) {
      if (seen.has(name)) return;
      const checked = safeMetrics(metrics);
      seen.add(name);
      milestones.push({ name, at_ms: clock(), ...(checked ? { metrics: checked } : {}) });
    },
    snapshot() {
      const at = new Map(milestones.map((milestone) => [milestone.name, milestone.at_ms]));
      const durations: Record<string, number> = {};
      if (at.has("query_started") && at.has("query_completed")) durations.query_ms = at.get("query_completed")! - at.get("query_started")!;
      if (at.has("work_started") && at.has("work_committed")) durations.work_ms = at.get("work_committed")! - at.get("work_started")!;
      return { trace_id: id, milestones: structuredClone(milestones), durations };
    }
  };
}
