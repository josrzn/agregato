#!/usr/bin/env node

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Parser from "rss-parser";
import chalk from "chalk";

const program = new Command();
const parser = new Parser();

const APP_DIR = path.join(os.homedir(), ".agregato");
const FEEDS_FILE = path.join(APP_DIR, "feeds.json");

type Feed = {
  name: string;
  url: string;
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

program
  .name("agregato")
  .description("Slick command-line RSS feed aggregator")
  .version("1.0.0");

program
  .command("add")
  .description("Add a feed by name + url")
  .requiredOption("-n, --name <name>", "Feed name")
  .requiredOption("-u, --url <url>", "Feed URL")
  .action((options) => {
    const feeds = loadFeeds();
    if (feeds.feeds.find((feed) => feed.name === options.name || feed.url === options.url)) {
      console.error(chalk.red("❌ Feed already exists with that name or URL."));
      process.exit(1);
    }
    feeds.feeds.push({ name: options.name, url: options.url });
    saveFeeds(feeds);
    console.log(chalk.green(`✅ Added ${options.name} (${options.url}).`));
  });

program
  .command("remove")
  .description("Remove a feed by name or url")
  .argument("<identifier>", "Feed name or url")
  .action((identifier) => {
    const feeds = loadFeeds();
    const target = resolveFeedIdentifier(feeds.feeds, identifier);
    if (!target) {
      console.error(chalk.red("❌ Feed not found."));
      process.exit(1);
    }
    feeds.feeds = feeds.feeds.filter((feed) => feed !== target);
    saveFeeds(feeds);
    console.log(chalk.yellow(`⚠️ Removed ${target.name} (${target.url}).`));
  });

program
  .command("list")
  .description("List saved feeds")
  .action(() => {
    const feeds = loadFeeds();
    if (feeds.feeds.length === 0) {
      console.log(chalk.yellow("⚠️ No feeds saved yet. Add one with 'agregato add'."));
      return;
    }
    feeds.feeds.forEach((feed) => {
      console.log(`- ${feed.name} (${feed.url})`);
    });
  });

program
  .command("fetch")
  .description("Fetch latest items from all feeds")
  .option("-l, --limit <number>", "Max items per feed", "5")
  .option("-j, --json", "Output JSON instead of plain text", false)
  .action(async (options) => {
    const feeds = loadFeeds();
    if (feeds.feeds.length === 0) {
      console.log(chalk.yellow("⚠️ No feeds saved yet. Add one with 'agregato add'."));
      return;
    }

    const limit = Number(options.limit ?? 5);
    if (Number.isNaN(limit) || limit <= 0) {
      console.error(chalk.red("❌ Limit must be a positive number."));
      process.exit(1);
    }

    const results = [] as Array<{
      feed: Feed;
      items: Array<{
        title?: string;
        link?: string;
        pubDate?: string;
      }>;
    }>;

    for (const feed of feeds.feeds) {
      try {
        const parsed = await parser.parseURL(feed.url);
        const items = (parsed.items ?? []).slice(0, limit).map((item) => ({
          title: item.title,
          link: item.link,
          pubDate: item.pubDate,
        }));
        results.push({ feed, items });
      } catch (error) {
        console.error(chalk.red(`❌ Failed to fetch ${feed.name}: ${(error as Error).message}`));
        results.push({ feed, items: [] });
      }
    }

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    for (const result of results) {
      console.log(chalk.cyan(`\n📰 ${result.feed.name}`));
      console.log(chalk.cyan("-".repeat(result.feed.name.length + 2)));
      if (result.items.length === 0) {
        console.log(chalk.yellow("⚠️ No items found."));
        continue;
      }
      result.items.forEach((item) => {
        const title = chalk.white(item.title ?? "(untitled)");
        const date = item.pubDate ? chalk.gray(` • ${item.pubDate}`) : "";
        const link = item.link ? chalk.blue(`\n  🔗 ${item.link}`) : "";
        console.log(`- ${title}${date}${link}`);
      });
    }
  });

program.parseAsync(process.argv);
