#!/usr/bin/env node

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import chalk from "chalk";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { extractFromXml } from "@extractus/feed-extractor";

const program = new Command();

type Theme = "default" | "vivid" | "mono";

type UiStyle = {
  icons: {
    success: string;
    warn: string;
    error: string;
    feed: string;
    link: string;
  };
  success: (text: string) => string;
  warn: (text: string) => string;
  error: (text: string) => string;
  header: (text: string) => string;
  title: (text: string) => string;
  date: (text: string) => string;
  link: (text: string) => string;
};

const createUiStyle = (theme: Theme, iconsEnabled: boolean): UiStyle => {
  const noColor = theme === "mono";
  const colorize = (fn: (text: string) => string) => (noColor ? (text: string) => text : fn);
  const palette = theme === "vivid"
    ? {
        success: chalk.greenBright,
        warn: chalk.yellowBright,
        error: chalk.redBright,
        header: chalk.cyanBright,
        title: chalk.whiteBright,
        date: chalk.gray,
        link: chalk.blueBright,
      }
    : {
        success: chalk.green,
        warn: chalk.yellow,
        error: chalk.red,
        header: chalk.cyan,
        title: chalk.white,
        date: chalk.gray,
        link: chalk.blue,
      };

  return {
    icons: {
      success: iconsEnabled ? "✅" : "",
      warn: iconsEnabled ? "⚠️" : "",
      error: iconsEnabled ? "❌" : "",
      feed: iconsEnabled ? "📰" : "",
      link: iconsEnabled ? "🔗" : "",
    },
    success: colorize(palette.success),
    warn: colorize(palette.warn),
    error: colorize(palette.error),
    header: colorize(palette.header),
    title: colorize(palette.title),
    date: colorize(palette.date),
    link: colorize(palette.link),
  };
};

const withIcon = (icon: string, text: string) => (icon ? `${icon} ${text}` : text);

const formatLink = (label: string, url: string, enabled: boolean) => {
  if (!enabled) return label;
  const escaped = url.replace(/\u001b/g, "");
  return `\u001b]8;;${escaped}\u001b\\${label}\u001b]8;;\u001b\\`;
};

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
const xmlBuilder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@_", format: true });

const normalizeOpmlAttr = (outline: Record<string, unknown>, keys: string[]): string | undefined => {
  const candidates = new Map<string, unknown>();
  Object.entries(outline).forEach(([key, value]) => {
    candidates.set(key.toLowerCase(), value);
  });
  for (const key of keys) {
    const direct = outline[key];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    const prefixed = outline[`@_${key}`];
    if (typeof prefixed === "string" && prefixed.trim()) return prefixed.trim();
    const lower = candidates.get(key.toLowerCase());
    if (typeof lower === "string" && lower.trim()) return lower.trim();
  }
  return undefined;
};

type OpmlImportState = {
  feeds: Feed[];
  skipped: number;
};

const resolveOpmlFeedUrl = (outline: Record<string, unknown>): string | undefined => {
  const xmlUrl = normalizeOpmlAttr(outline, ["xmlUrl", "xmlurl", "feedUrl", "feedurl"]);
  if (xmlUrl) return xmlUrl;
  const type = normalizeOpmlAttr(outline, ["type"])?.toLowerCase();
  const url = normalizeOpmlAttr(outline, ["url"]);
  if (url && (type === "rss" || type === "atom" || type === "feed")) {
    return url;
  }
  return undefined;
};

const collectOpmlFeeds = (nodes: unknown, state: OpmlImportState) => {
  if (!nodes) return;
  if (Array.isArray(nodes)) {
    nodes.forEach((node) => collectOpmlFeeds(node, state));
    return;
  }
  if (typeof nodes === "object") {
    const outline = nodes as Record<string, unknown>;
    const xmlUrl = resolveOpmlFeedUrl(outline);
    const title = normalizeOpmlAttr(outline, ["title", "text", "name"])
      ?? normalizeOpmlAttr(outline, ["htmlUrl", "htmlurl"]);
    if (xmlUrl) {
      state.feeds.push({ name: title ?? xmlUrl, url: xmlUrl });
    } else if (normalizeOpmlAttr(outline, ["outline", "text", "title", "name"]) || outline["outline"]) {
      state.skipped += 1;
    }
    const children = outline["outline"] as unknown;
    if (children) {
      collectOpmlFeeds(children, state);
    }
  }
};

const buildOpml = (feeds: Feed[]): string => {
  const outlines = feeds.map((feed) => ({
    "@_text": feed.name,
    "@_title": feed.name,
    "@_type": "rss",
    "@_xmlUrl": feed.url,
  }));

  const opml = {
    opml: {
      "@_version": "2.0",
      head: {
        title: "Agregato Feeds",
      },
      body: {
        outline: outlines,
      },
    },
  };

  return xmlBuilder.build(opml);
};

const parseItemDate = (value?: string): Date | null => {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return new Date(timestamp);
};

const mostRecentItemDate = (items: Array<{ published?: string; updated?: string }>): Date | null => {
  let mostRecent: Date | null = null;
  for (const item of items) {
    const candidate = parseItemDate(item.published) ?? parseItemDate(item.updated);
    if (!candidate) continue;
    if (!mostRecent || candidate > mostRecent) {
      mostRecent = candidate;
    }
  }
  return mostRecent;
};

const APP_DIR = path.join(os.homedir(), ".agregato");
const FEEDS_FILE = path.join(APP_DIR, "feeds.json");

type Feed = {
  name: string;
  url: string;
};

type FetchResult = {
  feed: Feed;
  items: Array<{ title?: string; link?: string; pubDate?: string; published?: string; updated?: string }>;
  error?: string;
};

type StoredFeeds = {
  feeds: Feed[];
};

const ensureStorage = () => {
  if (!fs.existsSync(APP_DIR)) {
    fs.mkdirSync(APP_DIR, { recursive: true });
  }
  if (!fs.existsSync(FEEDS_FILE)) {
    const initial: StoredFeeds = { feeds: [] };
    fs.writeFileSync(FEEDS_FILE, JSON.stringify(initial, null, 2));
  }
};

const loadFeeds = (): StoredFeeds => {
  ensureStorage();
  const content = fs.readFileSync(FEEDS_FILE, "utf-8");
  return JSON.parse(content) as StoredFeeds;
};

const saveFeeds = (feeds: StoredFeeds) => {
  ensureStorage();
  fs.writeFileSync(FEEDS_FILE, JSON.stringify(feeds, null, 2));
};

const resolveFeedIdentifier = (feeds: Feed[], identifier: string): Feed | null => {
  const byName = feeds.find((feed) => feed.name === identifier);
  if (byName) return byName;
  const byUrl = feeds.find((feed) => feed.url === identifier);
  return byUrl ?? null;
};

const fetchFeed = async (feed: Feed): Promise<FetchResult> => {
  try {
    const response = await fetch(feed.url, {
      headers: {
        "User-Agent": "Agregato/0.1 (+https://example.com)",
        Accept: "application/rss+xml, application/atom+xml, text/xml, application/xml;q=0.9, */*;q=0.8",
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const xml = await response.text();
    if (!xml.trim().startsWith("<") && !contentType.includes("xml")) {
      throw new Error("Response was not XML");
    }
    const parsed = await extractFromXml(xml);
    const entries = (parsed.items ?? parsed.entries ?? []) as Array<{ title?: string; link?: string; published?: string; updated?: string }>;
    const items = entries.map((item) => ({
      title: item.title,
      link: item.link,
      pubDate: item.published ?? item.updated,
      published: item.published,
      updated: item.updated,
    }));
    return { feed, items };
  } catch (error) {
    return { feed, items: [], error: (error as Error).message };
  }
};

const renderFetchResult = (
  result: FetchResult,
  ui: UiStyle,
  options: {
    hyperlinksEnabled: boolean;
    verbose: boolean;
    flat: boolean;
    titlesOnly: boolean;
    noEmpty: boolean;
    flatWidth?: number;
  },
) => {
  if (result.error) {
    if (!options.verbose) return;
    if (options.flat) {
      const message = `${withIcon(ui.icons.error, result.feed.name)}: ${result.error}`;
      console.log(ui.error(message));
      return;
    }
    console.log(ui.header(`\n${withIcon(ui.icons.feed, result.feed.name)}`));
    console.log(ui.header("-".repeat(result.feed.name.length + (ui.icons.feed ? 2 : 0))));
    console.log(ui.error(withIcon(ui.icons.error, result.error)));
    return;
  }

  if (result.items.length === 0) {
    if (options.noEmpty) return;
    if (options.flat) {
      const message = `${withIcon(ui.icons.warn, result.feed.name)}: No items found.`;
      console.log(ui.warn(message));
      return;
    }
    console.log(ui.header(`\n${withIcon(ui.icons.feed, result.feed.name)}`));
    console.log(ui.header("-".repeat(result.feed.name.length + (ui.icons.feed ? 2 : 0))));
    console.log(ui.warn(withIcon(ui.icons.warn, "No items found.")));
    return;
  }

  if (!options.flat) {
    console.log(ui.header(`\n${withIcon(ui.icons.feed, result.feed.name)}`));
    console.log(ui.header("-".repeat(result.feed.name.length + (ui.icons.feed ? 2 : 0))));
  }

  result.items.forEach((item) => {
    const titleText = item.title ?? "(untitled)";
    const title = ui.title(titleText);
    const date = item.pubDate ? ui.date(` • ${item.pubDate}`) : "";
    const link = item.link
      ? formatLink(item.link, item.link, options.hyperlinksEnabled)
      : "";

    if (options.flat) {
      const maxWidth = options.flatWidth ?? result.feed.name.length;
      const truncated = result.feed.name.length > maxWidth
        ? `${result.feed.name.slice(0, Math.max(0, maxWidth - 1))}…`
        : result.feed.name;
      const rawLabel = truncated.padEnd(maxWidth);
      const feedLabel = ui.header(rawLabel);
      const separator = " | ";
      const flatLine = options.titlesOnly
        ? `${feedLabel}${separator}${title}`
        : `${feedLabel}${separator}${title}${date}${link ? ` ${link}` : ""}`;
      console.log(flatLine);
      return;
    }

    if (options.titlesOnly) {
      console.log(`- ${title}`);
      return;
    }

    const linkLine = link
      ? ui.link(`\n  ${withIcon(ui.icons.link, link)}`)
      : "";
    console.log(`- ${title}${date}${linkLine}`);
  });
};

program
  .name("agregato")
  .description("Slick command-line RSS feed aggregator")
  .version("1.0.0")
  .option("--no-icons", "Disable icon output")
  .option("--theme <theme>", "Color theme (default|vivid|mono)", "default")
  .option("--force-hyperlinks", "Force OSC-8 clickable hyperlinks");

const getUi = () => {
  const opts = program.opts<{ icons: boolean; theme: Theme; forceHyperlinks: boolean }>();
  const theme = (opts.theme ?? "default") as Theme;
  if (!(["default", "vivid", "mono"] as Theme[]).includes(theme)) {
    console.error(chalk.red(`❌ Invalid theme '${theme}'. Use default, vivid, or mono.`));
    process.exit(1);
  }
  const iconsEnabled = opts.icons !== false;
  const hyperlinksEnabled = opts.forceHyperlinks === true;
  return { ui: createUiStyle(theme, iconsEnabled), hyperlinksEnabled };
};

program
  .command("add")
  .description("Add a feed by name + url")
  .requiredOption("-n, --name <name>", "Feed name")
  .requiredOption("-u, --url <url>", "Feed URL")
  .action((options) => {
    const { ui, hyperlinksEnabled } = getUi();
    const feeds = loadFeeds();
    if (feeds.feeds.find((feed) => feed.name === options.name || feed.url === options.url)) {
      console.error(ui.error(withIcon(ui.icons.error, "Feed already exists with that name or URL.")));
      process.exit(1);
    }
    feeds.feeds.push({ name: options.name, url: options.url });
    saveFeeds(feeds);
    const url = formatLink(options.url, options.url, hyperlinksEnabled);
    console.log(ui.success(withIcon(ui.icons.success, `Added ${options.name} (${url}).`)));
  });

program
  .command("remove")
  .description("Remove a feed by name or url")
  .argument("<identifier>", "Feed name or url")
  .action((identifier) => {
    const { ui, hyperlinksEnabled } = getUi();
    const feeds = loadFeeds();
    const target = resolveFeedIdentifier(feeds.feeds, identifier);
    if (!target) {
      console.error(ui.error(withIcon(ui.icons.error, "Feed not found.")));
      process.exit(1);
    }
    feeds.feeds = feeds.feeds.filter((feed) => feed !== target);
    saveFeeds(feeds);
    const url = formatLink(target.url, target.url, hyperlinksEnabled);
    console.log(ui.warn(withIcon(ui.icons.warn, `Removed ${target.name} (${url}).`)));
  });

program
  .command("list")
  .description("List saved feeds")
  .action(() => {
    const { ui, hyperlinksEnabled } = getUi();
    const feeds = loadFeeds();
    if (feeds.feeds.length === 0) {
      console.log(ui.warn(withIcon(ui.icons.warn, "No feeds saved yet. Add one with 'agregato add'.")));
      return;
    }
    feeds.feeds.forEach((feed) => {
      const url = formatLink(feed.url, feed.url, hyperlinksEnabled);
      console.log(`- ${feed.name} (${url})`);
    });
  });

program
  .command("import-opml")
  .description("Import feeds from an OPML file")
  .argument("<file>", "Path to OPML file")
  .option("--merge", "Merge with existing feeds instead of replacing", false)
  .action((file, options) => {
    const ui = getUi();
    const content = fs.readFileSync(file, "utf-8");
    const parsed = xmlParser.parse(content) as Record<string, unknown>;
    const opml = parsed?.opml as Record<string, unknown> | undefined;
    const outlines = opml?.body as Record<string, unknown> | undefined;
    const state: OpmlImportState = { feeds: [], skipped: 0 };
    collectOpmlFeeds(outlines?.outline ?? outlines ?? opml, state);
    if (state.feeds.length === 0) {
      console.log(ui.warn(withIcon(ui.icons.warn, "No feeds found in OPML.")));
      return;
    }

    const existing = loadFeeds();
    const merged = options.merge ? [...existing.feeds] : [];
    const seen = new Set(merged.map((feed) => `${feed.name}|${feed.url}`));
    let added = 0;

    for (const feed of state.feeds) {
      const key = `${feed.name}|${feed.url}`;
      if (seen.has(key)) continue;
      merged.push(feed);
      seen.add(key);
      added += 1;
    }

    saveFeeds({ feeds: merged });
    console.log(ui.success(withIcon(ui.icons.success, `Imported ${added} feeds (skipped ${state.skipped} outlines).`)));
  });

program
  .command("export-opml")
  .description("Export feeds to an OPML file")
  .argument("<file>", "Path to OPML file")
  .action((file) => {
    const { ui, hyperlinksEnabled } = getUi();
    const feeds = loadFeeds();
    if (feeds.feeds.length === 0) {
      console.log(ui.warn(withIcon(ui.icons.warn, "No feeds saved yet. Add one with 'agregato add'.")));
      return;
    }
    const xml = buildOpml(feeds.feeds);
    fs.writeFileSync(file, xml);
    const resolved = path.resolve(file);
    const fileLink = formatLink(resolved, `file://${resolved}`, hyperlinksEnabled);
    console.log(ui.success(withIcon(ui.icons.success, `Exported ${feeds.feeds.length} feeds to ${fileLink}.`)));
  });

program
  .command("fetch")
  .description("Fetch latest items from all feeds")
  .option("-l, --limit <number>", "Max items per feed", "5")
  .option("-j, --json", "Output JSON instead of plain text", false)
  .option("-v, --verbose", "Show errors for feeds that fail to fetch", false)
  .option("-s, --stream", "Stream results as each feed completes", false)
  .option("--titles-only", "Show only item titles", false)
  .option("--flat", "Show one item per line across feeds", false)
  .option("--no-empty", "Hide feeds with no items", false)
  .option("--compact", "Shortcut for --flat --titles-only --no-empty", false)
  .option("--flat-width <number>", "Max feed name width in flat mode", "30")
  .action(async (options) => {
    const { ui, hyperlinksEnabled } = getUi();
    const feeds = loadFeeds();
    if (feeds.feeds.length === 0) {
      console.log(ui.warn(withIcon(ui.icons.warn, "No feeds saved yet. Add one with 'agregato add'.")));
      return;
    }

    const limit = Number(options.limit ?? 5);
    if (Number.isNaN(limit) || limit <= 0) {
      console.error(ui.error(withIcon(ui.icons.error, "Limit must be a positive number.")));
      process.exit(1);
    }

    const compact = options.compact === true;
    const flat = options.flat || compact;
    const titlesOnly = options.titlesOnly || compact;
    const noEmpty = options.noEmpty || compact;

    if (options.json && (flat || titlesOnly || noEmpty)) {
      console.error(ui.error(withIcon(ui.icons.error, "--json cannot be combined with --flat, --titles-only, --no-empty, or --compact.")));
      process.exit(1);
    }

    const flatWidth = flat
      ? feeds.feeds.reduce((max, feed) => Math.max(max, feed.name.length), 0)
      : undefined;

    const maxFlatWidth = Number(options.flatWidth ?? 30);
    if (Number.isNaN(maxFlatWidth) || maxFlatWidth <= 0) {
      console.error(ui.error(withIcon(ui.icons.error, "--flat-width must be a positive number.")));
      process.exit(1);
    }

    const renderOptions = {
      hyperlinksEnabled,
      verbose: options.verbose,
      flat,
      titlesOnly,
      noEmpty,
      flatWidth: maxFlatWidth,
    };

    const results: FetchResult[] = [];

    for (const feed of feeds.feeds) {
      const result = await fetchFeed(feed);
      if (result.items.length > 0) {
        result.items = result.items.slice(0, limit);
      }

      if (options.stream) {
        if (options.json) {
          console.log(JSON.stringify(result));
        } else {
          renderFetchResult(result, ui, renderOptions);
        }
      }

      results.push(result);
    }

    if (options.stream) {
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    for (const result of results) {
      renderFetchResult(result, ui, renderOptions);
    }
  });

program
  .command("prune")
  .description("Retire inactive feeds based on activity level")
  .option("-l, --level <level>", "Prune level (light|medium|hard)", "medium")
  .option("-d, --dry-run", "Preview which feeds would be removed", false)
  .action(async (options) => {
    const { ui } = getUi();
    const feeds = loadFeeds();
    if (feeds.feeds.length === 0) {
      console.log(ui.warn(withIcon(ui.icons.warn, "No feeds saved yet. Add one with 'agregato add'.")));
      return;
    }

    const level = (options.level ?? "medium").toLowerCase();
    if (!(["light", "medium", "hard"] as const).includes(level as "light" | "medium" | "hard")) {
      console.error(ui.error(withIcon(ui.icons.error, `Invalid level '${options.level}'. Use light, medium, or hard.`)));
      process.exit(1);
    }

    const thresholds = {
      light: { staleDays: null as number | null, requireItems: false },
      medium: { staleDays: 180, requireItems: false },
      hard: { staleDays: 90, requireItems: true },
    }[level as "light" | "medium" | "hard"];

    const now = Date.now();
    const failures: Feed[] = [];
    const stale: Feed[] = [];
    const empty: Feed[] = [];

    for (const feed of feeds.feeds) {
      const result = await fetchFeed(feed);
      if (result.error) {
        failures.push(feed);
        continue;
      }

      const items = result.items.map((item) => ({
        published: item.published ?? item.pubDate,
        updated: item.updated ?? item.pubDate,
      }));

      if (thresholds.requireItems && items.length === 0) {
        empty.push(feed);
        continue;
      }

      if (thresholds.staleDays !== null) {
        const mostRecent = mostRecentItemDate(items);
        if (!mostRecent) {
          if (thresholds.requireItems) {
            empty.push(feed);
          }
          continue;
        }
        const ageDays = (now - mostRecent.getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays > thresholds.staleDays) {
          stale.push(feed);
        }
      }
    }

    const toRemove = new Set<Feed>();
    for (const feed of failures) {
      toRemove.add(feed);
    }
    for (const feed of stale) {
      toRemove.add(feed);
    }
    for (const feed of empty) {
      toRemove.add(feed);
    }

    const removalList = feeds.feeds.filter((feed) => toRemove.has(feed));
    if (removalList.length === 0) {
      console.log(ui.success(withIcon(ui.icons.success, "No feeds to prune.")));
      return;
    }

    if (options.dryRun) {
      console.log(ui.warn(withIcon(ui.icons.warn, `Dry run: ${removalList.length} feeds would be removed.`)));
      removalList.forEach((feed) => {
        console.log(`- ${feed.name} (${feed.url})`);
      });
      return;
    }

    const remaining = feeds.feeds.filter((feed) => !toRemove.has(feed));
    saveFeeds({ feeds: remaining });
    console.log(ui.success(withIcon(ui.icons.success, `Pruned ${removalList.length} feeds.`)));
  });

program.parseAsync(process.argv);
