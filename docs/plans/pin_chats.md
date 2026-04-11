# Global Pinned Chats & Threads Sidebar

## Summary

Add global pinned dialogue sidebar visible from any main tab (`Messages`, `Tasks`, `Documents`).

Feature solves context switching: user can keep selected chat or thread open while working in tasks or documents. Threads use same pinned system as chats. If no pinned items exist, sidebar is fully hidden and main content takes all available width.

## Goals

- Keep chat/thread access available outside `Messages` tab.
- Treat pinned chats and opened threads as one unified dialogue model.
- Reuse same reactive data source in all render locations.
- Support duplicate live instances of same chat/thread without data drift.
- Keep right-side UI narrow, stable, scrollable, and independent from main content width.

## Non-Goals

- No new backend API contract.
- No separate persistence model for pinned threads vs pinned chats.
- No floating window or draggable panel system.
- No multi-panel pinned workspace. Only one active pinned dialogue rendered at time.

## User Experience

### Global Layout

Main authenticated shell becomes 4-column horizontal layout:

1. Left nav rail: fixed-width app navigation icons.
2. Main content: current route workspace, `flex: 1`.
3. Active pinned panel: fixed-width chat/thread workspace.
4. Pin strip: narrow fixed-width vertical strip with pinned cards.

Layout rules:

- Columns 3 and 4 render only when `pinnedChats.length > 0`.
- When hidden, column 2 expands naturally to full remaining width.
- Pin strip width must stay fixed and never grow from text length.
- Active pinned panel width should be fixed or clamped, not content-driven.

### ASCII UI Schema

Pinned state:

```text
┌────────────┬───────────────────────────────────────┬──────────────────────────────┬──────────┐
│ App Nav    │ Main Content                          │ Active Pinned Panel          │ Pin Strip│
│ fixed 56px │ flex: 1                               │ fixed ~360px                 │ fixed 60px
├────────────┼───────────────────────────────────────┼──────────────────────────────┼──────────┤
│ [msg]      │ Current route content                 │ # qa > Conversation      [x] │ [DM●]    │
│ [tsk]      │ Tasks board / documents / messages    ├──────────────────────────────┤ Alice    │
│ [doc]      │ remains active                        │ root message                 │ [x]      │
│            │                                       │ replies                      ├──────────┤
│            │                                       │                              │ [#●]     │
│            │                                       │ composer                     │ qa       │
│            │                                       │                              │ [x]      │
│            │                                       │                              ├──────────┤
│            │                                       │                              │ [↪●]     │
│            │                                       │                              │ qa       │
│            │                                       │                              │ [x]      │
└────────────┴───────────────────────────────────────┴──────────────────────────────┴──────────┘
```

Empty state:

```text
┌────────────┬───────────────────────────────────────────────────────────────────────────────┐
│ App Nav    │ Main Content                                                                  │
│ fixed 56px │ flex: 1                                                                       │
├────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ [msg]      │ Current route content fills all remaining width                               │
│ [tsk]      │ No pinned panel. No pin strip.                                                │
│ [doc]      │                                                                               │
└────────────┴───────────────────────────────────────────────────────────────────────────────┘
```

Double-instance in `Messages` tab:

```text
┌────────────┬──────────────────────────────┬──────────────────────────────┬──────────┐
│ App Nav    │ Main Messages View           │ Active Pinned Panel          │ Pin Strip│
├────────────┼──────────────────────────────┼──────────────────────────────┼──────────┤
│ [msg]*     │ Chat A live instance         │ Chat A second live instance  │ [DM●]    │
│ [tsk]      │ same messages                │ same messages                │ Alice    │
│ [doc]      │ same realtime updates        │ same realtime updates        │ [x]      │
│            │ same send actions            │ same send actions            │          │
└────────────┴──────────────────────────────┴──────────────────────────────┴──────────┘
```

### Detailed UI Plan

#### Column 1: App Navigation Rail

Purpose:

- global route switcher
- always visible
- never affected by pinned sidebar state

Layout:

- fixed width `56px`
- vertical icon stack
- existing active route highlight remains unchanged

Behavior:

- route changes only update column 2
- columns 3 and 4 persist across route changes

#### Column 2: Main Content

Purpose:

- host current route workspace
- remain primary workspace for active tab

Layout:

- `flex: 1`
- `min-width: 0`
- must not reflow pin strip width

Behavior:

- if no pinned items, expands into freed space
- if pinned items exist, shares width with right-side columns
- route content must not unmount pinned panel on tab switch

#### Column 3: Active Pinned Panel

Purpose:

- show currently selected pinned dialogue

Layout:

- target width `360px`
- allow clamp such as `min(42vw, 360px)` if needed
- full height
- header fixed
- body scrollable
- composer pinned at bottom if chat/thread component already supports it

Header anatomy:

- left: dialogue context
- center optional: title / breadcrumb
- right: close button

Header variants:

- chat: conversation title, avatar optional
- thread: source conversation + thread label

Close behavior:

- close button always unpins active item
- if other pins remain, panel immediately switches to next active item

#### Column 4: Pin Strip

Purpose:

- compact navigator for pinned dialogues

Layout:

- fixed width `60px`
- vertical stack
- `overflow-y: auto`
- `overflow-x: hidden`
- each card fills strip width minus padding

Card anatomy:

- top zone: avatar or thread icon
- middle zone: pinned title rotated 90 degrees vertically and centered in card
- bottom zone: close button

Card sizing:

- width locked to strip width
- min-height enough for readable vertical label
- long labels truncate, fade, or clip vertically

Card states:

- default
- hover
- active
- keyboard focus

Active state must communicate:

- current selection in panel
- not unread state

Unread state, if later added, must be separate visual marker.

Active pin card styling:

- currently active pin card must be visually highlighted
- use distinct background color
- increase text weight or equivalent emphasis
- add border, ring, or comparable strong active outline
- active styling must remain visible even when type accent color is also present
- active pin card always has stronger visual emphasis than inactive cards and uniquely identifies current panel content

Type identity:

- DM card: person avatar or DM icon + DM color accent
- channel card: channel/hash icon + channel color accent
- thread card: reply/thread icon + thread color accent

Rules:

- type must be recognizable without reading label
- icon and color must work together
- channel and thread must not share same icon
- channel and thread must not share same accent color
- active selection state must remain visually stronger than type accent

Recommended accent families:

- DM: blue/cyan
- channel: green/emerald
- thread: amber/orange

#### DM Card Spec

Visual content:

- avatar from user data or DM icon fallback
- label from user name
- DM accent color

Fallbacks:

- if avatar missing, use existing initials avatar system
- if user name missing, use stable user fallback from conversation model

#### Channel Card Spec

Visual content:

- channel/hash icon
- label from channel name
- channel accent color

Rules:

- do not use person avatar treatment
- do not prefix visible label with `#` unless product already does this globally

#### Thread Card Spec

Visual content:

- thread/reply icon instead of avatar
- label from parent channel name
- thread accent color

Rules:

- do not show root message preview inside strip
- do not derive label from message body
- label source must be parent channel name
- thread must be distinguishable from channel even when both labels equal `qa`

#### Empty State Rules

When `pinnedChats.length === 0`:

- do not render column 3 DOM
- do not render column 4 DOM
- remove associated borders and spacing
- main content consumes full remaining width

#### Interaction Matrix

Primary actions:

- click chat pin action in messages UI -> pin chat + activate
- open thread -> pin thread + activate
- click inactive pin card -> activate only
- click active pin card -> no-op or keep active
- click card close -> unpin target only
- click active panel close -> unpin active target

Secondary rules:

- route changes do not clear pins
- reload persistence optional, not required for first version
- pinned order should remain insertion order unless product wants recency

Recommended initial order rule:

- append new pinned item to end
- if existing pinned item re-opened, activate without moving

#### Scroll and Overflow Rules

Pin strip:

- vertical scroll only
- hidden horizontal overflow

Pinned panel:

- internal chat/thread component manages own scroll
- outer shell must keep `min-height: 0` and `overflow: hidden`

Main shell:

- parent flex containers must use `min-width: 0` and `min-height: 0`
- prevents conversation content from forcing shell overflow

#### Responsive Plan

Desktop-first first release.

Breakpoints:

- `>= 1280px`: full 4-column layout
- `1024px - 1279px`: keep same structure, allow pinned panel clamp
- `< 1024px`: do not ship partial broken layout

Recommended narrow-screen fallback:

- keep feature disabled or hidden below desktop breakpoint until overlay mode designed

#### Accessibility Plan

Pin strip:

- each card rendered as button
- active card uses `aria-pressed` or selected semantics
- close control inside card has own `aria-label`

Pinned panel:

- close button focusable
- header title announced

Keyboard behavior:

- `Tab` moves through cards and close buttons
- `Enter` or `Space` activates focused card
- close button does not trigger card activation

### Pin Strip

Each pinned item renders as card in vertical list.

Card anatomy:

- top: type-specific avatar/icon
- middle: vertical label
- bottom: unpin button

Interaction rules:

- Clicking inactive card activates it.
- Clicking card unpin button removes only that item.
- Active card has highlighted visual state.
- Strip scrolls vertically when cards exceed available height.

Type visual rules:

- DM uses user avatar or DM icon with DM accent
- channel uses channel icon with channel accent
- thread uses thread icon with thread accent
- color + icon pair is required part of type identification

### Labels

DM card label:

- use user name

Channel card label:

- use channel name

Thread card label:

- use parent channel name
- thread differentiation comes from icon and color, not label prefix

Vertical label styling:

- use `writing-mode: vertical-rl`
- rotate only if needed for top-to-bottom reading
- title sits in middle section of card
- title must read as rotated 90-degree vertical label, not standard horizontal text wrap
- overflow must not widen strip

### Active Pinned Panel

Active pinned panel renders same conversation workspace used in main message area.

Header requirements:

- context label for pinned target
- for threads: breadcrumb-like title, example `# qa > Conversation`
- close button removes item from pinned list

Body requirements:

- chats render full chat view
- threads render thread view
- composer stays active and fully functional

## Domain Model

Pinned sidebar uses one normalized entity type for both chats and threads.

```ts
type PinnedDialogueKind = 'dm' | 'channel' | 'thread'

interface PinnedDialogue {
  id: string
  kind: PinnedDialogueKind
  conversationId: string
  title: string
  avatarUrl?: string
  userId?: string
  threadRootMessageId?: string
}
```

Notes:

- `id` must be unique across pinned items.
- Recommended format:
  - dm: `dm:<conversationId>`
  - channel: `channel:<conversationId>`
  - thread: `thread:<conversationId>:<rootMessageId>`
- `title` is display source for strip and header.
- title rules:
  - dm -> user name
  - channel -> channel name
  - thread -> parent channel name

## State Management

Use Pinia. Keep feature in dedicated store, not inside route-local component state.

Recommended store: `web/src/stores/pinnedDialogs.ts`

State:

- `pinnedChats: PinnedDialogue[]`
- `activePinnedChatId: string | null`

Derived state:

- `hasPinnedChats`
- `activePinnedChat`
- `pinnedChatsById`
- `isPinned(id)`

Actions:

- `pinChat(conversationId)`
- `pinThread(conversationId, rootMessageId)`
- `activatePinnedChat(id)`
- `unpin(id)`
- `unpinActive()`
- `ensurePinnedChat(conversationId)`
- `ensurePinnedThread(conversationId, rootMessageId)`

Rules:

- Pinning existing item must not duplicate.
- Opening thread auto-pins thread and activates it.
- Manual chat pin should pin chat and activate it.
- When active item removed:
  - activate previous neighbor if present
  - otherwise next neighbor
  - otherwise `null`

Optional persistence:

- Persist pinned ids in local storage only after base UX works.
- If added, store only identifiers, not duplicated message payload.

## Data Ownership

Pinned sidebar must not fork chat state.

Source of truth remains existing chat store and existing message/thread collections in `web/src/stores/chat.ts`.

Implications:

- `ChatArea` and pinned chat instance read/write same conversation state.
- `ThreadPanel` and pinned thread instance read/write same thread state.
- New messages, typing state, reactions, read updates, and send status appear in both instances immediately.

Do not clone conversation messages into pinned store. Pinned store owns only UI selection and identity metadata.

## Component Architecture

### Main Shell

Current main shell in `web/src/views/MainView.vue` should become global host for pinned sidebar.

Recommended extraction:

- `AppNavRail.vue` for left icon rail
- `PinnedDialogsHost.vue` for columns 3 and 4
- route/tab content stays in main content area

`PinnedDialogsHost.vue` responsibilities:

- decide whether pinned area mounts
- render active pinned workspace
- render pin strip
- wire close and activate actions

### Reusable Dialogue Renderer

Need wrapper that can render either chat or thread by normalized pinned entity.

Recommended component:

- `PinnedDialoguePanel.vue`

Behavior:

- if kind `dm` or `channel`, render chat workspace bound to `conversationId`
- if kind `thread`, render thread workspace bound to `conversationId + threadRootMessageId`

Avoid embedding route assumptions in pinned renderer.

### Reuse Strategy

Current `ChatArea.vue` and `ThreadPanel.vue` are tightly coupled to single global active context in chat store. For pinned feature, reuse requires decoupling render target from singleton selection state.

Recommended direction:

- extract conversation/thread presentation into reusable workspace components
- pass explicit target props instead of always reading global active selection

Concrete split:

- keep route-level container logic in existing `ChatArea.vue` and `ThreadPanel.vue`
- extract shared internals into reusable components, example:
  - `ConversationWorkspace.vue`
  - `ThreadWorkspace.vue`

Each workspace receives explicit identity props:

- chat: `conversationId`
- thread: `conversationId`, `rootMessageId`

Route-level views continue to bind to current main selection. Pinned panel binds to pinned selection. Both point at same underlying chat store collections.

## Thread Pinning Flow

When user opens thread anywhere in app:

1. Existing action resolves `conversationId` + `rootMessageId`.
2. Pinned dialogue store calls `ensurePinnedThread`.
3. Thread becomes active pinned item.
4. Right panel opens thread workspace immediately.
5. Main content remains unchanged unless current screen already manages its own thread panel.

Thread close rules:

- closing thread from pinned panel unpins thread
- closing thread from main message area should only close main thread view unless explicit product decision says otherwise

Recommended product rule:

- main thread drawer close does not auto-unpin pinned thread
- unpin remains explicit user action

Reason: pinned state should be deliberate and global.

## Chat Pinning Flow

When user clicks pin action on DM or channel:

1. Store calls `ensurePinnedChat(conversationId)`.
2. Chat added if missing.
3. Chat becomes active pinned item.
4. Right panel shows live chat workspace.

Unpin entry points:

- strip card close button
- active pinned panel header close button

## Double Instance Requirement

If user is on `Messages` tab and pins currently open DM/channel/thread, app renders same target twice:

- main route workspace
- pinned workspace

Required behavior:

- both instances remain interactive
- sending from either instance updates both
- typing/reply/send status/realtime events stay synchronized
- no store race caused by singleton local component state

Architecture consequence:

- presentation state that must differ per instance stays local to component instance
  - scroll position
  - hover state
  - draft input if product wants independent drafts
- shared domain state stays in Pinia/chat store
  - messages
  - thread replies
  - typing indicators
  - delivery status

Open product choice:

- draft composer text shared vs independent across duplicate instances

Recommended choice:

- keep drafts shared per conversation/thread if current app already stores drafts globally
- otherwise keep drafts local first, then decide later

## Rendering Rules

### Empty State

If no pinned items:

- do not mount pinned panel
- do not mount pin strip
- main content fills remaining width

### Active Selection

- first pinned item becomes active when list transitions from empty to non-empty
- active id must always reference existing pinned item
- if active item deleted, select nearest surviving item

### Width and Responsiveness

Desktop:

- nav rail fixed
- pinned panel about `360px`, clamp for large screens if needed
- pin strip `60px`

Smaller widths:

- preserve pin strip fixed width
- shrink main content first
- if viewport becomes too narrow, define explicit fallback before implementation

Recommended fallback:

- under narrow breakpoint, hide column 3 by default and keep strip only with tap-to-open overlay

If mobile/tablet behavior not needed now, limit first release to desktop and large tablet widths.

## Accessibility

- all pin controls require `aria-label`
- active card uses selected state semantics
- strip cards must be keyboard focusable
- enter/space activates card
- delete/backspace should not unpin unless explicitly designed
- close buttons need independent focus target from card body

## Testing Plan

### Store Tests

- pin chat adds normalized chat item once
- pin thread adds normalized thread item once
- auto-pin thread activates it
- unpin active item selects neighbor correctly
- removing last item clears active id

### Main Layout Tests

- with no pinned items, only nav + main content render
- with pinned items, panel and strip render
- clicking pin card swaps active panel content without route change

### Reuse / Sync Tests

- pinned chat and main chat render same new message after single send
- pinned thread and main thread render same new reply after single send
- realtime message update appears in both instances

### Interaction Tests

- header close unpins active item
- strip close unpins target item without activating wrong item
- opening thread auto-pins thread
- DM pin label uses user name
- channel pin label uses channel name
- thread pin label uses parent channel name
- channel and thread pins remain distinguishable by icon and color when labels match

### Visual Tests

- strip width does not grow from long labels
- active card highlight visible
- empty state removes right-side columns cleanly

## Rollout Plan

### Phase 1: Store and Layout Skeleton

- add pinned dialogue Pinia store
- add shell layout slots in `MainView.vue`
- add empty-state mount logic
- add pin strip with placeholder cards

Exit result:

- user can see/hide pinned area from store state

### Phase 2: Chat Pinning

- add chat pin action in messages UI
- render pinned chat workspace with shared conversation data
- support activate/unpin interactions

Exit result:

- pinned chats work globally across tabs

### Phase 3: Thread Pinning

- wire thread open action to auto-pin
- render pinned thread workspace
- add thread title masking and header breadcrumbs

Exit result:

- threads behave same as chats inside pinned system

### Phase 4: Duplicate Instance Hardening

- remove singleton assumptions from reused workspace components
- verify double-render sync
- fix per-instance local UI state leaks

Exit result:

- same chat/thread can stay open in main area and pinned panel safely

### Phase 5: Polish

- keyboard access
- persistence if desired
- responsive fallback
- visual refinement

## Risks

### Current Component Coupling

Biggest risk: `ChatArea.vue` and `ThreadPanel.vue` likely assume single active conversation/thread from chat store. Reuse without extraction may create collisions in:

- scroll management
- composer state
- focus handling
- thread open/close state

### Store Boundary Confusion

If pinned store starts storing message payload or thread replies, state will drift. Keep pinned store shallow.

### Narrow Screen Compression

4-column shell can become unusable on smaller widths without explicit breakpoint behavior.

## Recommended Decisions

- Create dedicated `pinnedDialogs` store.
- Keep existing `chat` store as only source of live conversation data.
- Extract reusable chat/thread workspace components with explicit identity props.
- Make thread opening auto-pin and auto-activate.
- Keep unpin explicit; closing main route thread view should not silently remove pinned thread.
- Ship desktop-first before responsive overlay mode.

## Acceptance Criteria

- User on `Tasks` or `Documents` can read and send messages in pinned DM/channel without leaving current tab.
- Opening thread auto-adds pinned thread card and opens it in right panel.
- Pin strip shows type-specific icon, type-specific color accent, vertical label, and card-local close action.
- DM pin label uses user name.
- Channel pin label uses channel name.
- Thread pin label uses parent channel name and remains visually distinct from channel pin by icon and color.
- Right panel and strip disappear completely when pinned list empty.
- Clicking pin card switches right panel content instantly.
- Unpin from strip or header removes item and updates active selection correctly.
- Same chat/thread can render in main content and pinned panel at same time with shared live data.
