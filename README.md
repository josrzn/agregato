# Agregato

A slick, command-line RSS feed aggregator built with TypeScript.

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

## Build

```bash
npm run build
```

Then run:

```bash
npm start -- fetch
```

Feeds are stored in `~/.agregato/feeds.json`.
