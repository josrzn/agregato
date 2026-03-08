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

Add `--verbose` to show failed feeds:

```bash
npm run dev -- fetch --limit 5 --verbose
```

Stream results as they complete:

```bash
npm run dev -- fetch --stream
```

Alternate display modes:

```bash
# Titles only
npm run dev -- fetch --titles-only

# Flat list across feeds (aligned columns, truncated names)
npm run dev -- fetch --flat

# Override width
npm run dev -- fetch --flat --flat-width 25

# Hide empty feeds
npm run dev -- fetch --no-empty

# Combine options
npm run dev -- fetch --flat --titles-only --no-empty

# Compact preset
npm run dev -- fetch --compact
```

Highlight today's items in bold (disable with `--no-highlight-today`):

```bash
npm run dev -- fetch
npm run dev -- fetch --no-highlight-today
```

Configuration defaults (optional):

Create `~/.agregato/config.json`:

```bash
npm run dev -- config init
```

Or create it manually:

```json
{
  "flatWidth": 30,
  "flatMaxLength": 160,
  "compact": false,
  "highlightToday": true,
  "forceHyperlinks": false,
  "theme": "default",
  "icons": true
}
```

CLI flags always override config values.

If you only see "No items found" for an Atom feed, re-run after updating to the latest version (Atom items live under `entries`).

### JSON output

```bash
npm run dev -- fetch --json
```

### Themes, icons, and hyperlinks

```bash
# Disable icons
npm run dev -- --no-icons fetch

# Force OSC-8 hyperlinks (default is plain URLs)
npm run dev -- --force-hyperlinks fetch

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

# Verify an OPML import
npm run dev -- import-opml ./feeds.opml --merge
npm run dev -- list

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
