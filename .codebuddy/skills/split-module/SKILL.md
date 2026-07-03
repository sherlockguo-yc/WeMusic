---
name: Split Module
description: >
  Use when splitting a large source file into multiple smaller modules, or creating new source files
  from existing code. Triggers on actions like: "split stats.js", "extract this function to its own file",
  "break up this module", "refactor into separate files".
  This skill prevents the most common bug: forgetting to import symbols that the original file used.
---

## Module Splitting Workflow

When splitting a source file into multiple smaller files, **never manually write import headers**. Every time this has been done by hand, at least 2-3 imports were missed, causing `ReferenceError` at runtime.

### Step 1: Read the project graph

```
Read .project-graph.json → find the module entry for the file being split
```

This gives you the exact list of symbols the original module imports and uses.

### Step 2: Map symbols to new files

For each function/block being extracted into a new file, check which of the original imports it actually references. Use grep or AST inspection — not guesswork.

### Step 3: Generate imports programmatically

Do NOT write import headers by hand. Instead:

1. List all external symbols used by the extracted code
2. Cross-reference with `.project-graph.json` to find which module exports each symbol
3. Generate the `import { ... } from './module.js'` lines from this data

### Step 4: Immediate verification

```bash
npm run deploy
```

Check for:
- 0 build errors (syntax, missing imports)
- 0 runtime `ReferenceError` in console
- The split views actually render (click through them)

### Known failure pattern (do NOT repeat)

When `src/stats.js` (900+ lines) was split into `discover.js`, `report.js`, `likes.js`, `albums.js`:

- `report.js`: missed `timeLabel`, `albumCover` → `ReferenceError`
- `discover.js`: missed `setTooltip`, `renderSongList` → `ReferenceError`
- `report.js`: missed `albumCover` in imports → `ReferenceError`

All three were caused by manually writing import headers instead of extracting them from the original file's actual usage.
