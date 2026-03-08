import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  collectOpmlFeeds,
  loadConfig,
  resolveOpmlFeedUrl,
  truncateText,
} from "../src/lib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const writeTempConfig = (content: object) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agregato-test-"));
  const file = path.join(dir, "config.json");
  fs.writeFileSync(file, JSON.stringify(content, null, 2));
  return file;
};

describe("truncateText", () => {
  it("truncates with ellipsis", () => {
    expect(truncateText("hello", 4)).toBe("hel…");
  });

  it("keeps short strings", () => {
    expect(truncateText("hi", 5)).toBe("hi");
  });
});

describe("loadConfig", () => {
  it("returns defaults when missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agregato-test-"));
    const file = path.join(dir, "missing.json");
    const config = loadConfig(file);
    expect(config.flatMaxLength).toBe(DEFAULT_CONFIG.flatMaxLength);
  });

  it("overrides defaults", () => {
    const file = writeTempConfig({ flatWidth: 25, forceHyperlinks: true });
    const config = loadConfig(file, true);
    expect(config.flatWidth).toBe(25);
    expect(config.forceHyperlinks).toBe(true);
  });
});

describe("OPML parsing", () => {
  it("picks xmlUrl when present", () => {
    const outline = { "@_xmlUrl": "https://example.com/feed.xml" };
    expect(resolveOpmlFeedUrl(outline)).toBe("https://example.com/feed.xml");
  });

  it("uses url when type is rss", () => {
    const outline = { "@_type": "rss", "@_url": "https://example.com/rss" };
    expect(resolveOpmlFeedUrl(outline)).toBe("https://example.com/rss");
  });

  it("collects nested feeds", () => {
    const state = { feeds: [], skipped: 0 };
    collectOpmlFeeds(
      {
        outline: [
          { "@_xmlUrl": "https://example.com/a.xml", "@_title": "A" },
          { outline: { "@_xmlUrl": "https://example.com/b.xml", "@_title": "B" } },
        ],
      },
      state,
    );
    expect(state.feeds).toHaveLength(2);
  });
});
