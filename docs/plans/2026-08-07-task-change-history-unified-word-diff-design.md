# Task Change History Unified Word Diff Design

## Goal

Make task-description Unified diffs easier to scan by highlighting the exact
words changed within paired removed and added lines, as well as retaining the
existing red and green line backgrounds.

## Diff model

Reuse the existing line-oriented diff for ordering, collapse counts, and
bounded large-document behavior. Within each adjacent removed/added line pair,
tokenize text while preserving whitespace and punctuation, then calculate a
word-level longest-common-subsequence diff. Unchanged tokens render normally;
removed tokens receive a stronger red mark and added tokens a stronger green
mark.

Unpaired additions and removals remain full-line changes, so unrelated or
inserted/deleted lines do not get misleading word-level matching. A bounded
per-pair fallback skips token-level work for unusually large lines and retains
the existing readable line-level presentation.

## Rendering and verification

Unified rows render token spans only when line pairs provide word segments.
Inline mode, Markdown source text, and all pagination/observer behavior are
unchanged. Unit tests cover unchanged, added, and removed token segmentation;
the component test confirms the stronger token-level marks render in Unified
mode. Run focused Vitest tests and the frontend production build.
