"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  pathKey,
  which,
  npmCmd,
  versionOf,
  firstExisting,
  runChecks,
  AGENT_CLIS,
} = require("../src/envcheck");

describe("envcheck helpers", () => {
  it("finds PATH regardless of case and locates binaries on it", () => {
    assert.equal(pathKey({ PATH: "/bin" }), "PATH");
    assert.equal(pathKey({ Path: "C\\\\Windows" }), "Path");
    const env = { ...process.env };
    const git = which("git", env);
    if (git) assert.equal(fs.existsSync(git), true);
    assert.equal(which("definitely-not-a-loopforge-bin-xyz", { PATH: "/tmp" }), "");
  });

  it("builds npm install commands and parses versions", () => {
    assert.equal(npmCmd("@deepseek-ai/dsh", false), "npm install -g @deepseek-ai/dsh");
    assert.equal(
      npmCmd("@deepseek-ai/dsh", true),
      "npm install -g @deepseek-ai/dsh --registry=https://registry.npmmirror.com",
    );
    assert.equal(versionOf("git version 2.47.0"), "2.47.0");
    assert.equal(firstExisting(["/no/such/file", __filename]), __filename);
  });

  it("keeps optional CLI homepage links on https", () => {
    for (const cli of AGENT_CLIS) {
      if (cli.url) assert.match(cli.url, /^https:\/\//);
    }
  });

  it("reports a writable data dir and a warning when the local service is not up", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "loopforge-envcheck-"));
    try {
      const report = await runChecks({
        env: process.env,
        dataDir,
        gitDir: "",
        nodeDir: "",
        pythonDir: "",
        serverUrl: "",
        mirror: false,
      });
      const ids = report.results.map((row) => row.id);
      assert.ok(ids.includes("datadir"));
      assert.ok(ids.includes("server"));
      assert.ok(ids.includes("git"));
      assert.ok(ids.includes("node"));
      const data = report.results.find((row) => row.id === "datadir");
      const server = report.results.find((row) => row.id === "server");
      assert.equal(data.status, "ok");
      assert.equal(server.status, "warn");
      assert.equal(typeof report.summary.requiredOk, "boolean");
      assert.equal(typeof report.summary.anyAgent, "boolean");
      assert.equal(report.summary.requiredOk, false);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
