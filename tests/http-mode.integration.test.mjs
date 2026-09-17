import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

async function waitForServer(child) {
  let output = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for HTTP mode startup: ${output}`)), 5000);
    const onData = (chunk) => {
      output += chunk.toString();
      const match = output.match(/127\.0\.0\.1:(\d+)/);
      if (!match) return;
      clearTimeout(timer);
      child.stderr.off("data", onData);
      resolve(Number(match[1]));
    };
    child.stderr.on("data", onData);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => {
      if (code !== null && !output.match(/127\.0\.0\.1:\d+/)) {
        clearTimeout(timer);
        reject(new Error(`HTTP mode exited before startup (${code}): ${output}`));
      }
    });
  });
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGINT");
  await new Promise((resolve) => child.once("exit", resolve));
}

test("starts one shared runtime in HTTP MCP mode", async () => {
  const root = await mkdtemp(join(tmpdir(), "openboard-http-mode-"));
  await mkdir(join(root, "examples"));
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: process.cwd(),
    env: { ...process.env, OPENBOARD_ROOT: root, OPENBOARD_PORT: "0", OPENBOARD_MCP_TRANSPORT: "http", OPENBOARD_MCP_TOKEN: "integration-token" },
    stdio: ["ignore", "ignore", "pipe"]
  });
  try {
    const port = await waitForServer(child);
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).service, "openboard");

    const unauthorized = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "integration", version: "1" } } }) });
    assert.equal(unauthorized.status, 401);

    const authorized = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer integration-token" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "integration", version: "1" } } }) });
    assert.equal(authorized.status, 200);
    const body = await authorized.text();
    assert.match(body, /serverInfo/);
    assert.match(body, /openboard/);
  } finally {
    await stop(child);
  }
});
