import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { DatasetRegistry, validateDatasetsInsideRoot } from "./data/dataset-registry.js";
import { createMcpServer } from "./mcp/server.js";
import { DataCanvasRuntime } from "./runtime/data-canvas-runtime.js";
import { Persistence } from "./runtime/persistence.js";
import { createWebServer } from "./web/server.js";

const root = resolve(process.env.OPENBOARD_ROOT ?? process.cwd());
const dataRoot = join(root, "data");
const sourceRoot = await access(dataRoot).then(() => dataRoot).catch(() => join(root, "examples"));
const persistence = new Persistence(root);
const restored = await persistence.loadScene();
const datasets = restored
  ? await validateDatasetsInsideRoot(sourceRoot, restored.datasets)
  : Object.fromEntries((await new DatasetRegistry().discover(sourceRoot)).map((dataset) => [dataset.id, dataset]));
const seed = restored ? {
  records: await persistence.loadHistory(),
  snapshots: (await Promise.all((await persistence.listSnapshotRevisions()).map((revision) => persistence.loadSnapshot(revision)))).filter((snapshot): snapshot is NonNullable<typeof snapshot> => Boolean(snapshot)),
  ...(await persistence.loadMetadata())
} : undefined;
const runtime = new DataCanvasRuntime(restored ? { ...restored, datasets } : { canvas_id: "openboard", revision: 0, datasets, visuals: {}, annotations: {}, canvas: {} }, persistence, seed);
const mcpTransport = process.env.OPENBOARD_MCP_TRANSPORT ?? "stdio";
const basePath = process.env.OPENBOARD_BASE_PATH;
const mcpToken = process.env.OPENBOARD_MCP_TOKEN;
const mcpPath = process.env.OPENBOARD_MCP_PATH ?? "/mcp";
const mcp = mcpTransport === "stdio" ? createMcpServer(runtime) : undefined;
const mcpHandler = mcpTransport === "http"
  ? (() => {
      if (!mcpToken) throw new Error("OPENBOARD_MCP_TOKEN is required when OPENBOARD_MCP_TRANSPORT=http");
      return createMcpHandler(() => createMcpServer(runtime), { legacy: "stateless" });
    })()
  : undefined;
if (mcpTransport !== "stdio" && mcpTransport !== "http") throw new Error(`unsupported OPENBOARD_MCP_TRANSPORT: ${mcpTransport}`);
const web = await createWebServer(runtime, Number(process.env.OPENBOARD_PORT ?? 3000), mcpHandler, { basePath, mcpPath, mcpToken });
if (mcp) await mcp.connect(new StdioServerTransport());
console.error(`OpenBoard web viewport: http://127.0.0.1:${web.port}`);
process.on("SIGINT", async () => { await web.close(); await mcpHandler?.close(); await mcp?.close(); runtime.close(); process.exit(0); });
