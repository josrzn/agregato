import { describe, expect, it, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const stripAnsi = (value: string) => value.replace(/\u001b\[[0-9;]*m/g, "");

const runCli = (args: string[], env: NodeJS.ProcessEnv) => {
  const node = process.execPath;
  const script = path.join(process.cwd(), "dist", "index.js");
  const result = spawnSync(node, [script, ...args], {
    env,
    encoding: "utf-8",
    timeout: 20000,
    stdio: "pipe",
  });
  if (result.error) {
    throw result.error;
  }
  return {
    status: result.status ?? 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

describe("CLI integration", () => {
  const feedXml = `<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <title>Test Feed</title>
        <item>
          <title>Hello World</title>
          <link>https://example.com/hello</link>
          <pubDate>Sat, 08 Mar 2026 00:00:00 GMT</pubDate>
        </item>
      </channel>
    </rss>`;
  const feedUrl = `data:application/rss+xml,${encodeURIComponent(feedXml)}`;

  it("adds and fetches feeds", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "agregato-home-"));
    const env = {
      ...process.env,
      HOME: home,
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      ALL_PROXY: "",
      NO_PROXY: "127.0.0.1,localhost",
    };

    const build = spawnSync("npm", ["run", "build"], {
      env,
      encoding: "utf-8",
      timeout: 20000,
      stdio: "pipe",
    });
    if (build.status !== 0) {
      throw new Error(`Build failed:\n${build.stderr}`);
    }

    const add = runCli(["add", "-n", "Test", "-u", feedUrl], env);
    expect(add.status).toBe(0);

    const fetch = runCli([
      "fetch",
      "--flat",
      "--titles-only",
      "--flat-width",
      "10",
      "--flat-max-length",
      "120",
      "--no-highlight-today",
      "--force-hyperlinks",
    ], env);
    if (fetch.status !== 0) {
      throw new Error(`Fetch failed (status ${fetch.status}):\n${fetch.stderr}`);
    }
    const output = stripAnsi(fetch.stdout);
    if (!output.includes("Test") || !output.includes("Hello World")) {
      throw new Error(`Unexpected output:\n${output}\nSTDERR:\n${fetch.stderr}`);
    }
    if (!fetch.stdout.includes("\u001b]8;;https://example.com/hello\u001b\\")) {
      throw new Error(`Missing OSC-8 hyperlink:\n${fetch.stdout}`);
    }
  });

  it("exports and imports opml", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "agregato-home-"));
    const env = {
      ...process.env,
      HOME: home,
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      ALL_PROXY: "",
      NO_PROXY: "127.0.0.1,localhost",
    };

    const build = spawnSync("npm", ["run", "build"], {
      env,
      encoding: "utf-8",
      timeout: 20000,
      stdio: "pipe",
    });
    if (build.status !== 0) {
      throw new Error(`Build failed:\n${build.stderr}`);
    }

    const add = runCli(["add", "-n", "Test", "-u", feedUrl], env);
    expect(add.status).toBe(0);

    const opmlPath = path.join(home, "feeds.opml");
    const exportResult = runCli(["export-opml", opmlPath], env);
    expect(exportResult.status).toBe(0);

    const remove = runCli(["remove", "Test"], env);
    expect(remove.status).toBe(0);

    const importResult = runCli(["import-opml", opmlPath], env);
    expect(importResult.status).toBe(0);

    const list = runCli(["list"], env);
    expect(stripAnsi(list.stdout)).toContain("Test");
  });
});
