#!/usr/bin/env node

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import chalk from "chalk";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import {
  DEFAULT_CONFIG,
  Feed,
  OpmlImportState,
  StoredFeeds,
  Theme,
  collectOpmlFeeds,
  computeFlatRenderParts,
  extractItemsFromXml,
  loadConfig,
  mostRecentItemDate,
  parseItemDate,
  resolveRenderSettings,
} from "./lib";

const program = new Command();

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
  highlight: (text: string) => string;
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
    highlight: noColor ? (text: string) => text : chalk.bold,
  };
};

const withIcon = (icon: string, text: string) => (icon ? `${icon} ${text}` : text);

const formatLink = (label: string, url: string, enabled: boolean) => {
  if (!enabled) return label;
  const escaped = url.replace(/\u001b/g, "");
  return `\u001b]8;;${escaped}\u001b\\${label}\u001b]8;;\u001b\\`;
};

const sanitizeUrl = (value: string) => value.trim();

const flagPresent = (flag: string) => process.argv.includes(flag);

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
const xmlBuilder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@_", format: true });

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


const APP_DIR = path.join(os.homedir(), ".agregato");
const FEEDS_FILE = path.join(APP_DIR, "feeds.json");
const CONFIG_FILE = path.join(APP_DIR, "config.json");

type FetchResult = {
  feed: Feed;
  items: Array<{ title?: string; link?: string; pubDate?: string; published?: string; updated?: string }>;
  error?: string;
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


const readConfigForProgram = (): ReturnType<typeof loadConfig> => {
  const configIndex = process.argv.indexOf("--config");
  const configPath = configIndex >= 0 ? process.argv[configIndex + 1] : undefined;
  if (configIndex >= 0 && !configPath) {
    console.error(chalk.red("❌ --config requires a path"));
    process.exit(1);
  }
  try {
    return loadConfig(configPath ? path.resolve(configPath) : CONFIG_FILE, Boolean(configPath));
  } catch (error) {
    console.error(chalk.red(`❌ ${(error as Error).message}`));
    process.exit(1);
  }
};

const configDefaults = readConfigForProgram();

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
        Connection: "close",
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
    const entries = await extractItemsFromXml(xml);
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
    flatMaxLength?: number;
    highlightToday: boolean;
  },
) => {
  if (result.error) {
    if (!options.verbose) return;
    if (options.flat) {
      const message = `${withIcon(ui.icons.error, result.feed.name)}: ${result.error}`;
      console.log(ui.error(message));
      return;
    }
    console.log(chalk.reset(ui.header(`\n${withIcon(ui.icons.feed, result.feed.name)}`)));
    console.log(chalk.reset(ui.header("-".repeat(result.feed.name.length + (ui.icons.feed ? 2 : 0)))));
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
    console.log(chalk.reset(ui.header(`\n${withIcon(ui.icons.feed, result.feed.name)}`)));
    console.log(chalk.reset(ui.header("-".repeat(result.feed.name.length + (ui.icons.feed ? 2 : 0)))));
    console.log(ui.warn(withIcon(ui.icons.warn, "No items found.")));
    return;
  }

  if (!options.flat) {
    console.log(chalk.reset(ui.header(`\n${withIcon(ui.icons.feed, result.feed.name)}`)));
    console.log(chalk.reset(ui.header("-".repeat(result.feed.name.length + (ui.icons.feed ? 2 : 0)))));
  }

  result.items.forEach((item) => {
    const titleText = item.title ?? "(untitled)";
    const parsedDate = parseItemDate(item.pubDate);
    const isToday = options.highlightToday
      && parsedDate
      && parsedDate.toDateString() === new Date().toDateString();
    const title = isToday ? ui.highlight(ui.title(titleText)) : ui.title(titleText);
    const date = item.pubDate ? ui.date(` • ${item.pubDate}`) : "";
    const link = item.link
      ? formatLink(item.link, item.link, options.hyperlinksEnabled)
      : "";
    const maxLineLength = options.flatMaxLength;

    if (options.flat) {
      const maxWidth = options.flatWidth ?? result.feed.name.length;
      const rawTitle = titleText;
      const rawDate = item.pubDate ? ` • ${item.pubDate}` : "";
      const rawLink = item.link ? sanitizeUrl(item.link) : "";

      const flatParts = computeFlatRenderParts({
        feedName: result.feed.name,
        title: rawTitle,
        date: rawDate,
        link: rawLink,
        maxWidth,
        maxContentLength: maxLineLength,
        titlesOnly: options.titlesOnly,
      });

      const feedLabel = chalk.reset(ui.header(flatParts.feedLabel));
      const styledTitleBase = isToday
        ? ui.highlight(ui.title(flatParts.title))
        : ui.title(flatParts.title);
      const styledTitle = options.titlesOnly && rawLink && options.hyperlinksEnabled
        ? formatLink(styledTitleBase, rawLink, true)
        : styledTitleBase;
      const styledDate = flatParts.date ? ui.date(flatParts.date) : "";
      const styledLink = flatParts.link
        ? ui.link(formatLink(flatParts.link, rawLink, options.hyperlinksEnabled))
        : "";

      const content = options.titlesOnly
        ? styledTitle
        : `${styledTitle}${styledDate}${styledLink}`;
      console.log(chalk.reset(`${feedLabel} | ${content}`));
      return;
    }

    if (options.titlesOnly) {
      const linkedTitle = item.link && options.hyperlinksEnabled
        ? formatLink(title, item.link, true)
        : title;
      console.log(`- ${linkedTitle}`);
      return;
    }

    const linkLine = link
      ? ui.link(`\n  ${withIcon(ui.icons.link, link)}`)
      : "";
    console.log(chalk.reset(`- ${title}${date}${linkLine}`));
  });
};

program
  .name("agregato")
  .description("Slick command-line RSS feed aggregator")
  .version("1.0.0")
  .option("--no-icons", "Disable icon output")
  .option("--theme <theme>", "Color theme (default|vivid|mono)", configDefaults.theme)
  .option("--force-hyperlinks", "Force OSC-8 clickable hyperlinks")
  .option("--no-highlight-today", "Disable highlighting today's items")
  .option("--config <path>", "Path to config file (default ~/.agregato/config.json)");

const getUi = () => {
  const opts = program.opts<{ theme?: Theme }>();
  const theme = (opts.theme ?? configDefaults.theme ?? "default") as Theme;
  if (!(["default", "vivid", "mono"] as Theme[]).includes(theme)) {
    console.error(chalk.red(`❌ Invalid theme '${theme}'. Use default, vivid, or mono.`));
    process.exit(1);
  }
  const iconsEnabled = flagPresent("--no-icons")
    ? false
    : (configDefaults.icons ?? true);
  const hyperlinksEnabled = flagPresent("--force-hyperlinks")
    ? true
    : (configDefaults.forceHyperlinks ?? false);
  const allowBold = flagPresent("--no-highlight-today")
    ? false
    : (configDefaults.highlightToday ?? true);
  return { ui: createUiStyle(theme, iconsEnabled), hyperlinksEnabled, allowBold };
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
    const { ui } = getUi();
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
  .command("config")
  .description("Manage configuration")
  .command("init")
  .description("Create a default config file")
  .option("-f, --force", "Overwrite existing config", false)
  .action((options) => {
    const configPath = CONFIG_FILE;
    if (fs.existsSync(configPath) && !options.force) {
      console.error(chalk.red(`❌ Config already exists at ${configPath}. Use --force to overwrite.`));
      process.exit(1);
    }
    ensureStorage();
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
    console.log(chalk.green(`✅ Wrote config to ${configPath}.`));
  });

program
  .command("fetch")
  .description("Fetch latest items from all feeds")
  .option("-l, --limit <number>", "Max items per feed", "5")
  .option("-j, --json", "Output JSON instead of plain text", false)
  .option("-v, --verbose", "Show errors for feeds that fail to fetch")
  .option("-s, --stream", "Stream results as each feed completes")
  .option("--titles-only", "Show only item titles")
  .option("--flat", "Show one item per line across feeds")
  .option("--no-empty", "Hide feeds with no items")
  .option("--compact", "Shortcut for --flat --titles-only --no-empty")
  .option("--flat-width <number>", "Max feed name width in flat mode")
  .option("--flat-max-length <number>", "Max line length in flat mode")
  .action(async (options) => {
    const { ui, hyperlinksEnabled, allowBold } = getUi();
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

    let renderSettings;
    try {
      renderSettings = resolveRenderSettings(options, configDefaults);
    } catch (error) {
      console.error(ui.error(withIcon(ui.icons.error, (error as Error).message)));
      process.exit(1);
    }

    if (options.json && (renderSettings.flat || renderSettings.titlesOnly || renderSettings.noEmpty)) {
      console.error(ui.error(withIcon(ui.icons.error, "--json cannot be combined with --flat, --titles-only, --no-empty, or --compact.")));
      process.exit(1);
    }

    const renderOptions = {
      hyperlinksEnabled,
      verbose: options.verbose ?? false,
      flat: renderSettings.flat,
      titlesOnly: renderSettings.titlesOnly,
      noEmpty: renderSettings.noEmpty,
      flatWidth: renderSettings.flatWidth,
      flatMaxLength: renderSettings.flatMaxLength,
      highlightToday: allowBold,
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
