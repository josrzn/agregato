# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]
### Added
- `prune` command to retire inactive feeds with `light`, `medium`, and `hard` levels.

## [0.1] - 2026-03-06
### Added
- Initial CLI with add/remove/list/fetch commands.
- Colored output, icon defaults, and theming (`--no-icons`, `--theme`).
- OPML import/export commands.

### Changed
- Switched RSS parsing to `@extractus/feed-extractor` for modern WHATWG URL handling.
