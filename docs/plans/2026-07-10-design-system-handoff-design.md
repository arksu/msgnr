# Design System Handoff Implementation Design

Date: 2026-07-10
Status: Approved

## Objective

Apply the visual system in `design-system-handoff/` to the existing Vue frontend without redesigning or restructuring product components.

The production frontend remains authoritative for markup, layout, state, collaboration, serialization, and component behavior. The handoff is authoritative only for the dark-theme palette, shared markdown presentation, code-highlight colors, inline-code treatment, and the explicitly requested editable-table interactions.

## Scope

### Included

- Replace the existing `dark` theme values with the exact navy and brand-blue values from `design-system-handoff/styles.css`.
- Keep `web/src/style.css :root` synchronized with the `dark` theme preset to prevent a flash of the old palette before JavaScript applies the stored theme.
- Add a semantic inline-code text token and include it in all four theme presets.
- Map the handoff markdown block styling onto the existing `.markdown-body` element selectors.
- Update the default dark syntax-highlight values while retaining the existing light-scheme override.
- Restyle rendered and editable markdown tables.
- Add hover- and keyboard-revealed controls that append a row or column to an editable Tiptap table.
- Make the resizable boundary discoverable from any cell on an internal column boundary and highlight that complete boundary during hover and drag.
- Retain the existing selection-relative table toolbar and its add/delete commands.

### Excluded

- Chat, sidebar, task-card, composer, input, toolbar, or application-shell layout changes.
- Component renaming or replacement with showcase HTML.
- Changes to stores, backend APIs, protocols, collaboration transport, or persisted server data.
- A new theme ID or changes to the existing light, pink, and rose palette values.
- A new table-width persistence format for markdown.
- Literal reuse of showcase JavaScript or direct DOM mutation of table document content.

## Approach

Implement the handoff as one reviewable change with four internal stages:

1. Theme tokens and FOUC defaults.
2. Shared markdown presentation.
3. Editable-table interaction behavior.
4. Automated and visual verification.

This keeps the palette and markdown changes visually consistent while preserving small, testable boundaries inside the change.

## Theme Architecture

`web/src/services/theme/themes.ts` remains the product source of truth for runtime theme values. Only the `dark` preset receives new palette values. The exact RGB equivalents are mirrored in `web/src/style.css :root`.

A new `inlineCodeText` entry is added to `COLOR_THEME_TOKEN_NAMES` and every preset. `web/src/composables/useColorTheme.ts` maps it to `--color-inline-code-text`. The dark preset uses the handoff blue-400 value. Existing theme-appropriate values are chosen for light, pink, and rose without otherwise modifying their palettes.

Inline-code background and border derive from the active accent with the handoff alpha levels. The foreground uses the new semantic token, avoiding a dark-only hexadecimal value in shared markdown CSS.

No Tailwind configuration change is expected because `markdown.css` can consume the CSS variables directly. Tailwind should change only if implementation reveals a genuine reusable semantic utility requirement.

## Markdown Presentation

`web/src/styles/markdown.css` remains the single shared presentation layer for rendered chat markdown, saved-message markdown, task comments and history, task-description fallback content, and editable task descriptions.

Handoff `.block--*` styles are translated onto existing semantic descendants of `.markdown-body`; showcase class names are not introduced into the product. The mapping covers:

- paragraphs and heading hierarchy;
- unordered, ordered, nested, and task lists;
- blockquotes and horizontal dividers;
- inline code and fenced code blocks;
- language labels and highlight.js token classes;
- links;
- images within markdown content;
- table frame, header, cells, alternating rows, and focused cells.

The default `.markdown-body` code-token values become the approved dark palette. The existing `html[data-color-scheme='light']` override remains authoritative for light, pink, and rose themes.

## Editable Table Interaction

Rendered markdown tables receive visual styling only. Interactive behavior is scoped to editable tables inside `TaskDescriptionRichEditor.vue`.

Tiptap remains authoritative for all table mutations and column-width state. The implementation must not reproduce the showcase's direct `appendChild`, `colgroup`, or manual content-editable mutation logic.

The editable table behavior is:

- right-edge add control appends a column to the hovered table;
- bottom-edge add control appends a row to the hovered table;
- controls appear on table hover and keyboard focus;
- controls are outside editable document content, expose accessible names, and do not reset the current selection before their command runs;
- commands verify that the target table can be mutated before dispatch;
- the existing contextual toolbar remains available for selection-relative add/delete operations;
- internal column boundaries can be grabbed from any row;
- hovering or dragging a boundary highlights that boundary through every table row;
- columns have a 48px minimum width;
- transient hover, drag, and document listeners are cleaned up after pointer release and component destruction.

The preferred implementation extends or decorates Tiptap's existing resizable table view so controls remain associated with the correct table while mutations still flow through ProseMirror transactions. It must avoid a second table state model.

## Data Flow and Persistence

Theme data continues to flow through the existing registry and `applyColorTheme()` path. Markdown continues through the existing markdown renderers and shared `.markdown-body` styles. Editable table changes continue through Tiptap transactions, the existing markdown serializer, and Yjs collaboration when enabled.

GFM markdown does not encode column widths. Widths may remain in an active Tiptap/Yjs document, but a plain markdown reload can reset them. Adding width metadata or separate persistence is intentionally outside scope.

## Failure Handling

- A table command that cannot run leaves the document unchanged and exposes a disabled control state where applicable.
- Hover and drag state is always cleared on pointer release, editor destruction, and Vue component unmount.
- Styling must degrade to ordinary table rendering if interactive decoration is absent.
- No visual-only change may alter markdown output or collaboration semantics.

## Testing

Automated coverage must verify:

- exact approved dark-theme values;
- identical and complete token sets across dark, light, pink, and rose;
- mapping of `inlineCodeText` to its CSS variable;
- synchronization between the dark preset and `style.css :root`;
- existing markdown rendering and syntax-highlighting behavior;
- editable-only visibility of table controls;
- row and column append behavior for the hovered table;
- disabled-command and interaction-cleanup behavior;
- continued operation of the existing contextual table controls.

Manual verification must compare the product with both handoff HTML files and cover:

- the dark application palette without layout changes;
- light, pink, and rose regressions;
- inline code, fenced code, headings, lists, quotes, links, task items, dividers, images, and tables across chat and task surfaces;
- table hover, keyboard focus, row/column append, resizing from every row, minimum width, and full-boundary highlighting.

The final verification gates are `npm run test`, `npm run lint`, and the production build from `web/`.

## Acceptance Criteria

- The `dark` theme matches the token values in the handoff stylesheet.
- The old palette does not flash before stored-theme application.
- Light, pink, and rose remain readable and otherwise visually unchanged.
- Inline code uses an accent-tinted background and border with the semantic blue foreground in dark mode.
- Shared markdown blocks visually match the handoff without requiring showcase classes.
- Editable table add and resize interactions match the approved behavior.
- Existing application structure, toolbar behavior, markdown output, and collaboration flows remain intact.
- Automated gates pass and visual comparison finds no out-of-scope component redesign.
