import fs from "node:fs";

export type Theme = "default" | "vivid" | "mono";

export type Feed = {
  name: string;
  url: string;
};

export type StoredFeeds = {
  feeds: Feed[];
};

export type AppConfig = {
  flatWidth?: number;
  flatMaxLength?: number;
  flat?: boolean;
  titlesOnly?: boolean;
  noEmpty?: boolean;
  compact?: boolean;
  highlightToday?: boolean;
  forceHyperlinks?: boolean;
  theme?: Theme;
  icons?: boolean;
};

export const DEFAULT_CONFIG: Required<AppConfig> = {
  flatWidth: 30,
  flatMaxLength: 160,
  flat: false,
  titlesOnly: false,
  noEmpty: false,
  compact: false,
  highlightToday: true,
  forceHyperlinks: false,
  theme: "default",
  icons: true,
};

export const loadConfig = (configPath: string, required = false): Required<AppConfig> => {
  if (!fs.existsSync(configPath)) {
    if (required) {
      throw new Error(`Config file not found at ${configPath}`);
    }
    return { ...DEFAULT_CONFIG };
  }
  const content = fs.readFileSync(configPath, "utf-8");
  const parsed = JSON.parse(content) as AppConfig;
  return { ...DEFAULT_CONFIG, ...parsed };
};

export const truncateText = (value: string, maxLength: number) => {
  if (maxLength <= 0) return "";
  if (value.length <= maxLength) return value;
  if (maxLength === 1) return "…";
  return `${value.slice(0, maxLength - 1)}…`;
};

export const parseItemDate = (value?: string): Date | null => {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return new Date(timestamp);
};

export const mostRecentItemDate = (items: Array<{ published?: string; updated?: string }>): Date | null => {
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

export const normalizeOpmlAttr = (outline: Record<string, unknown>, keys: string[]): string | undefined => {
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

export const resolveOpmlFeedUrl = (outline: Record<string, unknown>): string | undefined => {
  const xmlUrl = normalizeOpmlAttr(outline, ["xmlUrl", "xmlurl", "feedUrl", "feedurl"]);
  if (xmlUrl) return xmlUrl;
  const type = normalizeOpmlAttr(outline, ["type"])?.toLowerCase();
  const url = normalizeOpmlAttr(outline, ["url"]);
  if (url && (type === "rss" || type === "atom" || type === "feed")) {
    return url;
  }
  return undefined;
};

export type OpmlImportState = {
  feeds: Feed[];
  skipped: number;
};

export const collectOpmlFeeds = (nodes: unknown, state: OpmlImportState) => {
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

export type ExtractedItem = {
  title?: string;
  link?: string;
  published?: string;
  updated?: string;
};

export const extractItemsFromXml = async (xml: string): Promise<ExtractedItem[]> => {
  const { extractFromXml } = await import("@extractus/feed-extractor");
  const parsed = await extractFromXml(xml) as unknown as { items?: ExtractedItem[]; entries?: ExtractedItem[] };
  const entries = (parsed.items ?? parsed.entries ?? []) as ExtractedItem[];
  return entries.map((item) => ({
    title: item.title,
    link: item.link,
    published: item.published,
    updated: item.updated,
  }));
};

export type FlatRenderOptions = {
  feedName: string;
  title: string;
  date: string;
  link: string;
  maxWidth: number;
  maxContentLength?: number;
  titlesOnly: boolean;
};

export type FlatRenderParts = {
  feedLabel: string;
  title: string;
  date: string;
  link: string;
};

export const computeFlatParts = (params: {
  title: string;
  date: string;
  link: string;
  maxContentLength?: number;
  titlesOnly: boolean;
}) => {
  const rawTitle = params.title;
  const rawDate = params.date;
  const rawLink = params.link;
  const maxContentLength = params.maxContentLength;

  let titleBudget = rawTitle.length;
  let datePart = rawDate;
  let linkPart = rawLink ? ` ${rawLink}` : "";

  if (maxContentLength !== undefined) {
    if (params.titlesOnly) {
      titleBudget = Math.max(1, Math.min(rawTitle.length, maxContentLength));
      datePart = "";
      linkPart = "";
    } else {
      titleBudget = Math.max(1, Math.min(rawTitle.length, maxContentLength));
      let remaining = maxContentLength - titleBudget;

      if (datePart && remaining >= datePart.length) {
        remaining -= datePart.length;
      } else {
        datePart = "";
      }

      if (linkPart && remaining >= linkPart.length) {
        remaining -= linkPart.length;
      } else {
        linkPart = "";
      }
    }
  }

  return {
    title: truncateText(rawTitle, titleBudget),
    date: datePart,
    link: linkPart,
  };
};

export const computeFlatRenderParts = (options: FlatRenderOptions): FlatRenderParts => {
  const truncatedFeed = options.feedName.length > options.maxWidth
    ? `${options.feedName.slice(0, Math.max(0, options.maxWidth - 1))}…`
    : options.feedName;
  const feedLabel = truncatedFeed.padEnd(options.maxWidth);

  const maxContentLength = options.maxContentLength
    ? Math.max(0, options.maxContentLength - (feedLabel.length + 3))
    : undefined;

  const parts = computeFlatParts({
    title: options.title,
    date: options.date,
    link: options.link,
    maxContentLength,
    titlesOnly: options.titlesOnly,
  });

  return {
    feedLabel,
    title: parts.title,
    date: parts.date,
    link: parts.link,
  };
};

