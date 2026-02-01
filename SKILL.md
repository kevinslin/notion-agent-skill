---
name: notion
description: This skill should be used when the user wants to do anything with notion. should always be used before calling notion mcp
---

## When to Use This Skill
Use this skill when the user wants to:
- Add entries to Notion databases
- Create new Notion pages with structured data
- Save content from Dendron notes to Notion
- Track daily stories, tasks, lessons, or other personal data in Notion

## Using the CLI

Read ./scripts/notion/USAGE.md for usage guide

## Setup

1. Make sure that NOTION_TOKEN is set. If not, stop and tell user to set it.
2. Check that $HOME/.notion-cache.production.json is accessible. If not, run `notion sync-meta and verify that the file is created

## Shortcuts

### add-block
1. User will supply a database and a block. If this is missing or you're not sure, ask user to confirm before proceeding.
2. Use CLI `parseBlock` to extract strucutred output
**Important**: Default to `printf` pipeline for parse operations in restricted shells, and validate parse output before reporting it
3. Use the CLI `create` command with structured output to create a new entry