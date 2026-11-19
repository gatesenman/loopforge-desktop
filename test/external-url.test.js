"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { isAllowedExternalUrl } = require("../src/external-url");

describe("openExternal allow list", () => {
  it("allows https (including OAuth) and loopback http for the local service", () => {
    assert.equal(isAllowedExternalUrl("https://github.com/Tencent/LoopForge"), true);
    assert.equal(isAllowedExternalUrl("https://accounts.google.com/o/oauth2/v2/auth"), true);
    assert.equal(isAllowedExternalUrl("https://cursor.com/cli"), true);
    assert.equal(isAllowedExternalUrl("http://127.0.0.1:18090/"), true);
    assert.equal(isAllowedExternalUrl("http://localhost:18090/"), true);
    assert.equal(
      isAllowedExternalUrl("http://127.0.0.1:18090/", { serverUrl: "http://127.0.0.1:18090" }),
      true,
    );
  });

  it("rejects file, javascript, and non-loopback http", () => {
    assert.equal(isAllowedExternalUrl("file:///etc/passwd"), false);
    assert.equal(isAllowedExternalUrl("javascript:alert(1)"), false);
    assert.equal(isAllowedExternalUrl("http://evil.example/"), false);
    assert.equal(isAllowedExternalUrl("https://user:pass@evil.example/"), false);
  });

  it("adds a :focus-visible ring to first-run and error pages", () => {
    const dir = path.join(__dirname, "..", "src");
    for (const name of ["envcheck.html", "splash.html", "error.html"]) {
      const html = fs.readFileSync(path.join(dir, name), "utf8");
      assert.match(html, /:focus-visible/, name);
    }
  });
});
