import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  collectOpmlFeeds,
  computeFlatParts,
  computeFlatRenderParts,
  extractItemsFromXml,
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

describe("computeFlatParts", () => {
  it("keeps title and drops date/link when space is tight", () => {
    const parts = computeFlatParts({
      title: "A long title",
      date: " • 2026-03-08",
      link: "https://example.com",
      maxContentLength: 10,
      titlesOnly: false,
    });
    expect(parts.title.length).toBeGreaterThan(0);
    expect(parts.date).toBe("");
    expect(parts.link).toBe("");
  });

  it("preserves date and link when space allows", () => {
    const parts = computeFlatParts({
      title: "Short",
      date: " • 2026-03-08",
      link: "https://example.com",
      maxContentLength: 80,
      titlesOnly: false,
    });
    expect(parts.title).toBe("Short");
    expect(parts.date).toBe(" • 2026-03-08");
    expect(parts.link).toBe(" https://example.com");
  });

  it("respects titlesOnly", () => {
    const parts = computeFlatParts({
      title: "Hello world",
      date: " • 2026-03-08",
      link: "https://example.com",
      maxContentLength: 6,
      titlesOnly: true,
    });
    expect(parts.title).toBe("Hello…");
    expect(parts.date).toBe("");
    expect(parts.link).toBe("");
  });
});

describe("computeFlatRenderParts", () => {
  it("pads and truncates feed labels", () => {
    const parts = computeFlatRenderParts({
      feedName: "Very Long Feed Name",
      title: "Title",
      date: "",
      link: "",
      maxWidth: 10,
      maxContentLength: 50,
      titlesOnly: true,
    });
    expect(parts.feedLabel.length).toBe(10);
    expect(parts.feedLabel).toContain("…");
  });

  it("honors maxContentLength", () => {
    const parts = computeFlatRenderParts({
      feedName: "Feed",
      title: "A very long title that should be truncated",
      date: "",
      link: "",
      maxWidth: 10,
      maxContentLength: 20,
      titlesOnly: true,
    });
    expect(parts.title.length).toBeLessThanOrEqual(20);
  });
});

describe("extractItemsFromXml", () => {
  it("extracts items from Atom entries", async () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Example</title>
        <entry>
          <title>Item 1</title>
          <link href="https://example.com/1" />
          <published>2026-03-08T00:00:00Z</published>
        </entry>
      </feed>`;
    const items = await extractItemsFromXml(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Item 1");
  });
});
