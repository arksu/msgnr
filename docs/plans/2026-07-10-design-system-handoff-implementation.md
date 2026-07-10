# Design System Handoff Implementation Plan

Date: 2026-07-10
Design: `docs/plans/2026-07-10-design-system-handoff-design.md`
Scope source: `design-system-handoff/PROMPT.md`

## Goal

Apply the approved dark palette and markdown presentation to the existing Vue frontend, then add the handoff's editable-table controls and resize feedback without changing application layout, domain state, serialization, or collaboration behavior.

## Working Constraints

- Preserve all unrelated changes already present in the dirty worktree.
- Treat `web/` markup, component boundaries, stores, and protocols as authoritative.
- Read exact visual values from `design-system-handoff/styles.css :root`; do not use the showcase labels as a value source.
- Change only the `dark` palette. Add the new token key to all themes, but do not otherwise recolor light, pink, or rose.
- Keep table mutations inside ProseMirror/Tiptap transactions. Do not port the showcase's direct table DOM mutation code.
- Do not change `web/tailwind.config.js` unless a new reusable semantic utility is demonstrably required.

## Phase 0: Establish the Baseline

### Files

- Inspect only; no product changes.

### Steps

1. Record `git status --short` so unrelated modified and untracked files remain identifiable throughout the work.
2. From `web/`, run the focused current tests before editing:

   ```bash
   npm run test -- src/services/theme/__tests__/themes.test.ts src/composables/__tests__/useColorTheme.test.ts src/components/__tests__/TaskDescriptionRichEditor.test.ts
   ```

3. If a baseline test already fails, record it and do not conflate it with the handoff change.
4. Open `design-system-handoff/index.html` and `design-system-handoff/messenger.html` directly for the later visual comparison.

### Completion check

- The starting test state and unrelated worktree changes are known.

## Phase 1: Extend and Lock the Theme Token Contract

### Files

- Modify `web/src/services/theme/themes.ts`.
- Modify `web/src/composables/useColorTheme.ts`.
- Modify `web/src/services/theme/__tests__/themes.test.ts`.
- Modify `web/src/composables/__tests__/useColorTheme.test.ts`.
- Add `web/src/services/theme/__tests__/themeDefaults.test.ts`.

### Step 1.1: Add failing token-contract tests

1. Extend the theme completeness test to expect `inlineCodeText` in `COLOR_THEME_TOKEN_NAMES` and in every preset.
2. Add an exact dark-palette assertion using these values:

   | Token | Value |
   | --- | --- |
   | `bgPrimary` | `#0D1118` |
   | `bgSecondary` | `#0A0D14` |
   | `bgTertiary` | `#181E29` |
   | `surface` | `#0D1118` |
   | `surfaceHover` | `#141A24` |
   | `input` | `#121720` |
   | `divider` | `#303A4C` |
   | `textPrimary` | `#EDF2FA` |
   | `textSecondary` | `#BFCBDD` |
   | `textMuted` | `#8696AD` |
   | `textOnAccent` | `#FFFFFF` |
   | `accent` | `#3B82F6` |
   | `accentHover` | `#60A5FA` |
   | `selectionBg` | `#2563EB` |
   | `selectionText` | `#FFFFFF` |
   | `selectionBorder` | `#60A5FA` |
   | `taskIdText` | `#E0A854` |
   | `taskIdBg` | `#2E2718` |
   | `statusGreen` | `#34D399` |
   | `statusRed` | `#F87171` |
   | `statusAmber` | `#FBBF24` |
   | `sidebarBg` | `#0A0D14` |
   | `sidebarHover` | `#181E29` |
   | `sidebarText` | `#CDD6E4` |
   | `sidebarTextMuted` | `#8291A8` |
   | `sidebarHeading` | `#606E86` |
   | `sidebarUnreadBadge` | `#FFBEBE` |
   | `inlineCodeText` | `#60A5FA` |

3. Add a mapping assertion that `inlineCodeText` becomes `--color-inline-code-text`.
4. Add `themeDefaults.test.ts` to read the first `:root` block in `web/src/style.css`, extract `--color-*` triplets, and compare every registered dark token with the RGB conversion of the `dark` preset. This test protects the FOUC mirror from future drift.
5. Run the focused theme tests and confirm they fail for the missing token and old palette.

### Step 1.2: Implement the token registry and runtime mapping

1. Add `inlineCodeText` to `COLOR_THEME_TOKEN_NAMES`.
2. Replace the `dark` preset with the exact table above and update its swatches to the new primary, secondary, accent, and task-ID colors.
3. Add readable `inlineCodeText` values to the other presets without changing their existing tokens:

   - light: `#1D4ED8`;
   - pink: `#BE185D`;
   - rose: `#8E4F5A`.

4. Add `inlineCodeText: 'inline-code-text'` to `cssThemeTokenNames`.
5. Run the focused theme tests until the registry and mapping tests pass; the FOUC test remains red until Phase 2.

### Completion check

- Runtime theme application supports the new semantic token.
- Every theme has the same complete token set.
- The dark preset exactly matches the handoff palette.

## Phase 2: Synchronize the FOUC Defaults

### Files

- Modify `web/src/style.css`.
- Complete `web/src/services/theme/__tests__/themeDefaults.test.ts`.

### Steps

1. Replace the RGB triplets in the first `:root` block with the exact RGB equivalents of the new `dark` preset.
2. Add `--color-inline-code-text: 96 165 250`.
3. Do not add showcase-only aliases such as `--bg`, `--panel`, `--accent-fill`, label tokens, geometry tokens, or animation tokens.
4. Run:

   ```bash
   npm run test -- src/services/theme/__tests__/themes.test.ts src/services/theme/__tests__/themeDefaults.test.ts src/composables/__tests__/useColorTheme.test.ts
   ```

5. Confirm the mirror test passes and that the generated CSS variable name exactly matches the runtime mapping.

### Completion check

- Loading the page before JavaScript and applying stored `dark` produce identical theme variables.

## Phase 3: Port Shared Markdown Presentation

### Files

- Modify `web/src/styles/markdown.css`.
- Modify relevant existing rendering tests only if structural regressions need coverage:
  - `web/src/components/__tests__/AttachmentMarkdownContent.test.ts`;
  - `web/src/components/__tests__/MessageBubble.test.ts`;
  - `web/src/components/__tests__/TaskComments.test.ts`;
  - `web/src/components/__tests__/TaskDescriptionRichEditor.test.ts`.

### Step 3.1: Protect the shared rendering contract

1. Keep all rules under `.markdown-body` so chat messages, saved messages, task comments/history, and task descriptions remain aligned.
2. Add or retain DOM-level tests proving that representative markdown still produces the expected elements and classes for:

   - headings;
   - blockquotes;
   - task-list checkboxes;
   - horizontal rules;
   - inline code and fenced code;
   - links;
   - tables;
   - images.

3. Do not assert computed layout in jsdom. Use browser verification for pixel-level CSS behavior.

### Step 3.2: Translate showcase blocks to semantic selectors

1. Map the handoff block styles to existing descendants rather than adding `.block--*` classes.
2. Port structure and spacing for paragraphs, `h1`-`h6`, lists, nested lists, task items, blockquotes, `hr`, links, images, and tables.
3. Preserve semantic Tailwind/CSS variables so light, pink, and rose remain readable.
4. Keep task checkboxes as native inputs and preserve the existing Tiptap task-item DOM contract.
5. Keep attachment and lightbox behavior untouched; only style markdown-contained images.

### Step 3.3: Port inline-code and fenced-code styling

1. Replace the neutral inline-code treatment with:

   - background: active accent at 10%;
   - border: active accent at 20%;
   - foreground: `rgb(var(--color-inline-code-text))`;
   - the handoff radius, padding, monospaced font, and no wrapping.

2. Ensure `pre code` resets inline-code background, border, padding, and radius so fenced blocks do not inherit the chip treatment.
3. Give fenced code the handoff's even one-pixel frame, dark code background in dark mode, language badge, typography, spacing, and overflow behavior.
4. Remove the product's language-colored left stripe because the approved handoff uses an even frame with a language label only.
5. Replace the default dark highlight values with the exact handoff values:

   - keyword `#60A5FA`;
   - string/addition `#34D399`;
   - number `#FBBF24`;
   - title `#22D3EE`;
   - type `#A78BFA`;
   - attr `#F472B6`;
   - builtin `#38BDF8`;
   - meta `#FB7185`;
   - deletion `#F87171`;
   - addition background `rgb(22 101 52 / 0.22)`;
   - deletion background `rgb(127 29 29 / 0.22)`.

6. Leave `html[data-color-scheme='light'] .markdown-body` syntax values intact.

### Step 3.4: Port table visuals

1. Style `.markdown-body table`, `th`, and `td` with the handoff frame, six-pixel radius, visible single grid lines, header surface, secondary body text, and eight-by-twelve-pixel cell padding.
2. Use separate borders or equivalent selectors to avoid doubled grid lines.
3. Add the handoff alternating-row tint without reducing readability in light-scheme themes.
4. Add a clear accent focus treatment for editable cells without changing the ProseMirror selection model.
5. Ensure the editable `.tableWrapper` can reserve space for the interaction controls added in Phase 4 while ordinary rendered tables do not gain empty control gutters.

### Step 3.5: Run focused regressions

```bash
npm run test -- src/components/__tests__/AttachmentMarkdownContent.test.ts src/components/__tests__/MessageBubble.test.ts src/components/__tests__/TaskComments.test.ts src/components/__tests__/TaskDescriptionRichEditor.test.ts
```

### Completion check

- All shared markdown surfaces use the approved presentation.
- Inline code is accent blue in dark mode.
- Light-scheme code colors remain readable.
- No showcase class names or component layouts are introduced.

## Phase 4: Add the Editable Table View Layer

### Files

- Add `web/src/editor/taskTableView.ts`.
- Add `web/src/editor/__tests__/taskTableView.test.ts` if behavior can be isolated cleanly; otherwise keep integration coverage in the component test.
- Modify `web/src/components/tasks/TaskDescriptionRichEditor.vue`.
- Modify `web/src/components/__tests__/TaskDescriptionRichEditor.test.ts`.
- Modify `web/src/styles/markdown.css` for the final interaction selectors.

### Step 4.1: Add failing behavior tests

Cover these cases before wiring the view:

1. An editable table renders a right-side add-column button and bottom add-row button with accessible names and `contenteditable="false"`.
2. Controls belong to the correct table when the document contains more than one table.
3. Activating the row control appends a final row, regardless of the editor's previous selection.
4. Activating the column control appends a final column, regardless of the editor's previous selection.
5. Existing contextual add/delete controls remain selection-relative and continue to pass their current tests.
6. A pointer near an internal boundary adds a highlight class to that boundary in every row.
7. Leaving the boundary clears hover state; pointer release clears active drag state.
8. Destroying the editor removes document-level listeners and transient classes.
9. Read-only/fallback rendered markdown never receives interactive controls.

Use mocked cell rectangles for boundary-hit tests rather than depending on jsdom layout.

### Step 4.2: Create a custom Tiptap table view

1. Implement a small class in `taskTableView.ts` that extends Tiptap's exported `TableView`.
2. Keep the inherited `table`, `colgroup`, `contentDOM`, `update()`, and mutation-ignore behavior so Tiptap remains responsible for table rendering and width state.
3. Append two non-content buttons to the existing `.tableWrapper`:

   - `.task-table-add-column` on the right edge;
   - `.task-table-add-row` on the bottom edge.

4. Give each button a `type`, accessible label, title, stable test selector, and `contenteditable="false"`.
5. On activation, resolve a document position inside the target table using the node view's DOM and `EditorView.posAtDOM()`:

   - select inside the last column before dispatching `addColumnAfter`;
   - select inside the last row before dispatching `addRowAfter`.

6. Dispatch the standard ProseMirror table commands. Do not append cells or rows directly to DOM nodes.
7. If the command cannot resolve or run, return without changing the document.

### Step 4.3: Add resize-boundary feedback

1. Configure the existing table extension with:

   - `resizable: true`;
   - `cellMinWidth: 48`;
   - `lastColumnResizable: false`;
   - `View: TaskTableView`.

2. In the custom view, use delegated pointer movement within the table wrapper to identify the internal column boundary under the pointer.
3. Add a transient edge class to the matching cells in every row, producing one continuous highlighted divider.
4. When the pointer presses Tiptap's `.column-resize-handle`, promote the edge from hover to active state and keep it visible during the drag.
5. Clear active state on document pointer release, pointer cancellation, and view destruction.
6. Implement `destroy()` to remove wrapper and document listeners before delegating any inherited cleanup.
7. Do not maintain a parallel width array; Tiptap's native column-resizing plugin remains the only width authority.

### Step 4.4: Style controls and resize states

1. Make `.tableWrapper` relative and reserve an 18-22px gutter only for editable task-description tables.
2. Match the handoff right and bottom control bars, including hover/focus visibility, surface colors, accent hover state, and plus icon.
3. Keep controls visible with `:focus-visible` for keyboard operation.
4. Style hover and active divider classes with the accent color and a column-resize cursor.
5. Preserve ordinary rendered table spacing outside the editor.

### Step 4.5: Run focused editor tests

```bash
npm run test -- src/editor/__tests__/taskTableView.test.ts src/components/__tests__/TaskDescriptionRichEditor.test.ts
```

If the isolated test file is not created, omit it from the command.

### Completion check

- Controls target the hovered table and append at its outer edge.
- Resize handles work from any row and show a complete boundary.
- Tiptap transactions, markdown updates, and Yjs collaboration remain the only mutation flow.

## Phase 5: Cross-Surface and Cross-Theme Verification

### Automated checks

Run from `web/`:

```bash
npm run test
npm run lint
npm run build
```

Fix only failures caused by this work. Do not modify unrelated dirty files to make the worktree clean.

### Dark-theme visual matrix

Compare against `design-system-handoff/index.html` and `design-system-handoff/messenger.html`:

1. Application background, secondary/sidebar background, elevated surfaces, input surfaces, dividers, text hierarchy, accent, selection, task ID, and semantic status colors.
2. Chat markdown message.
3. Saved-message preview.
4. Task comment and task-history markdown.
5. Task description in rendered fallback and editable modes.
6. Inline code, fenced code, syntax tokens, language badge, headings, lists, task items, quote, divider, link, image, and table.
7. Table controls on hover and keyboard focus.
8. Resize from header and body rows, internal edges only, 48px minimum, and full-edge highlight.

### Other-theme regression matrix

Repeat representative chat markdown, task markdown, inline code, fenced code, and table checks under light, pink, and rose. Confirm that only the new inline-code semantic foreground is added and existing palette values remain otherwise unchanged.

### Layout regression check

Confirm no changes to:

- icon rail or sidebar dimensions;
- chat bubble and composer structure;
- task-card geometry;
- toolbars and floating menus;
- application routing or state behavior.

## Phase 6: Review and Handoff

### Steps

1. Run `git diff --check` on the touched files.
2. Review `git diff --stat` and the full diff to confirm the change stays within:

   - theme registry/application/defaults;
   - shared markdown CSS;
   - task table view behavior and tests.

3. Confirm `web/tailwind.config.js`, stores, APIs, backend packages, generated protocol files, and showcase files are unchanged unless a separately documented blocker required otherwise.
4. Report:

   - files changed;
   - focused and full checks run;
   - visual surfaces checked;
   - any pre-existing failures;
   - the accepted limitation that plain markdown does not persist column widths.

## Definition of Done

- Exact dark-theme values match the handoff source.
- `themes.ts` and `style.css :root` are test-protected against drift.
- All themes expose the inline-code text token.
- Shared markdown presentation matches the handoff without showcase classes.
- Editable tables expose accessible edge controls and full-boundary resize feedback.
- Existing table toolbar, markdown serialization, and collaboration behavior remain intact.
- Light, pink, and rose stay readable and otherwise retain their palettes.
- Focused tests, full tests, lint, build, and visual comparison are complete.
- No unrelated user changes are overwritten or included in the implementation diff.
