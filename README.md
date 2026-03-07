# Agregato

A slick, command-line RSS feed aggregator built with TypeScript.

Built for Node.js 18+ and uses the WHATWG URL API via `@extractus/feed-extractor`.

## Setup

```bash
npm install
```

## Usage

### Add a feed

```bash
npm run dev -- add -n "NYTimes" -u "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"
```

### List feeds

```bash
npm run dev -- list
```

### Remove a feed

```bash
npm run dev -- remove "NYTimes"
```

### Fetch latest items

```bash
npm run dev -- fetch --limit 5
```

### JSON output

```bash
npm run dev -- fetch --json
```

### Themes and icons

```bash
# Disable icons
npm run dev -- --no-icons fetch

# Vivid colors
npm run dev -- --theme vivid fetch

# Monochrome (no colors)
npm run dev -- --theme mono fetch
```

### OPML import/export

```bash
# Import feeds (replace existing)
npm run dev -- import-opml ./feeds.opml

# Import feeds (merge with existing)
npm run dev -- import-opml ./feeds.opml --merge

# Export feeds
npm run dev -- export-opml ./feeds.opml
```

### Prune inactive feeds

```bash
# Preview what would be removed
npm run dev -- prune --level medium --dry-run

# Remove inactive feeds
npm run dev -- prune --level hard
```

Levels:
- **light**: remove feeds that fail to fetch.
- **medium**: light + no items within 180 days (feeds with no date are skipped).
- **hard**: medium + remove feeds with zero items.

## Build

```bash
npm run build
```

Then run:

```bash
npm start -- fetch
```

Feeds are stored in `~/.agregato/feeds.json`.
