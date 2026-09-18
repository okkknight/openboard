import { pathToFileURL } from "node:url";

const rounded = (value) => Math.round(value * 1000) / 1000;

export function summarizeSamples(samples) {
  const successful = samples.filter((sample) => sample.ok).map((sample) => sample.ms).sort((a, b) => a - b);
  const percentile = (fraction) => successful.length ? successful[Math.max(0, Math.ceil(successful.length * fraction) - 1)] : null;
  const statuses = {};
  for (const sample of samples) statuses[String(sample.status)] = (statuses[String(sample.status)] ?? 0) + 1;
  return {
    count: samples.length,
    successes: successful.length,
    failures: samples.length - successful.length,
    min_ms: successful.length ? rounded(successful[0]) : null,
    p50_ms: percentile(.5) === null ? null : rounded(percentile(.5)),
    p95_ms: percentile(.95) === null ? null : rounded(percentile(.95)),
    max_ms: successful.length ? rounded(successful.at(-1)) : null,
    statuses
  };
}

function options(argv) {
  const value = (name, fallback) => { const index = argv.indexOf(name); return index < 0 ? fallback : argv[index + 1]; };
  return {
    baseUrl: String(value("--base-url", "http://127.0.0.1:4324")).replace(/\/$/, ""),
    runs: Number(value("--runs", "10")),
    dataset: String(value("--dataset", "orders")),
    freshConnections: argv.includes("--fresh-connections")
  };
}

async function sample(url, init) {
  const started = performance.now();
  try {
    const response = await fetch(url, init);
    await response.arrayBuffer();
    return { ok: response.ok, status: response.status, ms: performance.now() - started };
  } catch {
    return { ok: false, status: 0, ms: performance.now() - started };
  }
}

export async function runBenchmark(config) {
  if (!Number.isSafeInteger(config.runs) || config.runs < 1) throw new Error("invalid_runs");
  const connectionHeaders = config.freshConnections ? { connection: "close" } : {};
  const scene = await fetch(`${config.baseUrl}/api/scene`).then((response) => response.json());
  const visualId = Object.keys(scene.visuals ?? {})[0];
  const targets = {
    scene: { url: `${config.baseUrl}/api/scene`, init: { headers: connectionHeaders } },
    query: {
      url: `${config.baseUrl}/api/data/query`,
      init: { method: "POST", headers: { "content-type": "application/json", ...connectionHeaders }, body: JSON.stringify({ dataset: config.dataset, query: { dimensions: [{ field: "channel" }], measures: [{ agg: "count", alias: "orders" }] } }) }
    },
    ...(visualId ? { cached_visual: { url: `${config.baseUrl}/api/visual/${encodeURIComponent(visualId)}`, init: { headers: connectionHeaders } } } : {})
  };
  const report = {};
  for (const [name, target] of Object.entries(targets)) {
    const samples = [];
    for (let run = 0; run < config.runs; run += 1) samples.push(await sample(target.url, target.init));
    report[name] = summarizeSamples(samples);
  }
  return report;
}

async function main() {
  const config = options(process.argv.slice(2));
  const report = await runBenchmark(config);
  console.table(Object.fromEntries(Object.entries(report).map(([name, result]) => [name, { count: result.count, failures: result.failures, p50_ms: result.p50_ms, p95_ms: result.p95_ms, max_ms: result.max_ms }])));
  console.log(JSON.stringify({ config, report }, null, 2));
  if (Object.values(report).some((result) => result.failures)) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
