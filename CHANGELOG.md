# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]
### Added
- Optional OSC-8 terminal hyperlinks (enable with `--force-hyperlinks`).
- `--stream` option to show feed results as they complete.
- Alternate display modes: `--titles-only`, `--flat` (aligned, truncated), `--no-empty`, and `--compact`.
- Highlight today's items in bold (disable with `--no-highlight-today`).
- Config file support (`~/.agregato/config.json`) and flat line length limits (`--flat-max-length`).
- `config init` command to scaffold the config file.

### Changed
- OSC-8 hyperlink formatting updated for iTerm2 compatibility.

## [0.2] - 2026-03-07
### Added
- `prune` command to retire inactive feeds with `light`, `medium`, and `hard` levels.
- `--verbose` option for fetch to show failed feeds.

### Changed
- Fetching feeds now uses a custom User-Agent and skips failed feeds unless `--verbose` is set.
- Extracted feed items from either `items` or `entries` to support Atom feeds.
- OPML import now normalizes Feedly variants.

## [0.1] - 2026-03-06
### Added
- Initial CLI with add/remove/list/fetch commands.
- Colored output, icon defaults, and theming (`--no-icons`, `--theme`).
- OPML import/export commands.

### Changed
- Switched RSS parsing to `@extractus/feed-extractor` for modern WHATWG URL handling.
