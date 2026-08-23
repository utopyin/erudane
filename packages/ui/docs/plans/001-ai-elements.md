# 001 — `@erudane/ui`: primitives + AI elements on TanStack AI

A tier-1 package that owns every presentational building block: shadcn/Base UI primitives, Nucleo glyph icons, the theme, and a set of **AI elements** — the chat vocabulary (`Conversation`, `Message`, `Response`, `Reasoning`, `Tool`, `PromptInput`) — typed directly against TanStack AI's client shapes instead of Vercel's.

Related: [docs/architecture/CONTEXT.md](../../../../docs/architecture/CONTEXT.md), [docs/plans/001-chat](../../../../docs/plans/001-chat/README.md).

## Why not Vercel AI Elements

[elements.ai-sdk.dev](https://elements.ai-sdk.dev) has the right _taxonomy_ — that part we copy. Its code we don't, for three reasons verified in the source (`vercel/ai-elements`, `packages/elements/src/tool.tsx` et al.):

1. **Typed against `ai`.** `Tool` imports `ToolUIPart`/`DynamicToolUIPart`, `PromptInput` takes `ChatStatus`, `Message` assumes `UIMessage.parts` in Vercel's shape. We run `@tanstack/ai`; mirroring Vercel's message model client-side would be a second source of truth.
2. **Radix shadcn + lucide.** Every file imports Radix-based `@repo/shadcn-ui` primitives and `lucide-react`. We are on Base UI (`style: base-luma`, `iconLibrary: nucleo`, glyph fills only). `asChild` → `render`, `Collapsible.Content` → `Collapsible.Panel`, positioning via `Positioner` — a port, not a rename.
3. **Markdown via Streamdown.** Good library, but it pins `mermaid` (multi-MB) as a hard dependency. We take the one idea that matters — _repair unterminated markdown while streaming_ — through `remend` (the same fixer Streamdown uses internally, published standalone) + `react-markdown`.

Alternatives considered: **assistant-ui** (its own runtime/state model — heavier coupling than Elements), **prompt-kit** (thinner, still Radix/lucide). Neither is closer to Base UI + TanStack than writing ~6 small files.

## Decisions

| #   | Decision                                                                                                                                                                                       | Why                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `packages/ui` is **tier 1**. It knows the _shape_ of a message (`UIMessage`, `MessagePart`) but no concept: no tool names, no routes, no Effect services.                                      | CONTEXT.md membership test: "knows about no concept, or only the shape of one". The AI elements are mechanism over a library's types, exactly like `Button` is mechanism over Base UI's.                                          |
| D2  | AI elements type against **`@tanstack/ai-client`**, not `@tanstack/ai-react`.                                                                                                                  | `ai-react` just re-exports `UIMessage`, `ToolCallPart`, `ChatClientState` from `ai-client`. Depending on the lower package keeps the UI package framework-hook-free (it is still React, but imports no hooks from TanStack).      |
| D3  | Import vocabulary: `@erudane/ui/button`, `@erudane/ui/ai/tool`, `@erudane/ui/icons`, `@erudane/ui/utils`, `@erudane/ui/styles.css`. One `"./*": "./src/*.tsx"` export.                         | AGENTS.md: the path is the sentence. `ui` is already in the package name, so primitives sit at the root; `ai/` scopes the chat elements.                                                                                          |
| D4  | Internal imports use Node subpath imports package **self-reference**: `@erudane/ui/button` inside the package too, resolved through its own `exports`.                                         | One import vocabulary inside and outside the package; no `imports`/`paths` config. Node, Bun, Vite and TS `bundler` all resolve self-references.                                                                                  |
| D5  | Theme (`styles.css` tokens + `@theme inline`) moves here; `apps/web/src/styles.css` becomes `@import "@erudane/ui/styles.css"` + `@source` for this package's `src`.                           | Primitives and tokens are one thing. Tailwind v4 only scans the importing app's tree by default, so the `@source` line is what makes classes in `packages/ui` exist.                                                              |
| D6  | `Tool` renders from the **`tool-call` part only**; `tool-result` parts are skipped.                                                                                                            | Verified in `@tanstack/ai/activities/chat/stream/processor.js`: on `TOOL_CALL_RESULT` the client writes `output`/`state` back onto the `tool-call` part _and_ appends a `tool-result` part. The call part is the complete record. |
| D7  | `MessageParts` is the one place that switches on `part.type`, with a `renderers` override map. Apps pass tool-specific renderers keyed by tool name, nothing else.                             | Keeps concept knowledge (what `currentTime` output looks like) in the app, keeps the switch out of every screen.                                                                                                                  |
| D8  | `PromptInput` is a plain `<form>` with context (`status`, `onStop`); `PromptInputSubmit` derives send/stop/loader from `ChatClientState` (`'ready' \| 'submitted' \| 'streaming' \| 'error'`). | Same shape as Elements' `PromptInputSubmit status=…`, but the status type is TanStack's, so `useChat().status` plugs in directly.                                                                                                 |
| D9  | Stick-to-bottom is a ~40-line hook over the Base UI `ScrollArea.Viewport`, not `use-stick-to-bottom`.                                                                                          | One dependency fewer; the behaviour needed (follow while pinned, release on user scroll-up, "jump to latest" button) is small.                                                                                                    |

## Package map

```
packages/ui/                         @erudane/ui      tier 1
  package.json                       exports: ./styles.css ./utils ./icons ./*
  tsconfig.json                      jsx react-jsx
  components.json                    shadcn CLI target (base-luma, nucleo, aliases → @erudane/ui)
  docs/plans/001-ai-elements.md      this file
  src/
    styles.css                       tokens + @theme inline (moved from apps/web)
    utils.ts                         cn
    icons/                           Nucleo ui/glyph/18 components + index.ts role re-exports
    button.tsx badge.tsx card.tsx    moved from apps/web/src/components/ui
    scroll-area.tsx textarea.tsx
    collapsible.tsx                  NEW — Base UI Collapsible.{Root,Trigger,Panel}
    ai/
      conversation.tsx               Conversation, ConversationContent, ConversationScrollButton
      message.tsx                    Message, MessageContent, MessageParts (+ renderers map)
      response.tsx                   Response — streaming-safe markdown
      reasoning.tsx                  Reasoning — collapsible thinking, auto open/close
      tool.tsx                       Tool, ToolHeader, ToolContent, ToolInput, ToolOutput
      prompt.tsx                     PromptInput, PromptInputTextarea, PromptInputToolbar, PromptInputSubmit
```

Dependencies: `@base-ui/react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `react-markdown`, `remark-gfm`, `remend`, `@tanstack/ai-client` (catalog). Peers: `react`, `react-dom`. No Effect, no `@erudane/*`.

Closure check: nothing under `src/` may import from `domains/`, `entrypoints/`, or `apps/`. `src/ai/*` may import `@tanstack/ai-client` **types only** (`import type`), so the runtime closure stays at React + Base UI + markdown.

## Component contracts

Shapes come from `@tanstack/ai-client`:

```ts
type Part = UIMessage["parts"][number];
// 'text' | 'thinking' | 'tool-call' | 'tool-result' | 'image' | … | 'structured-output' | 'ui-resource'
type ToolCallState =
  | "awaiting-input"
  | "input-streaming"
  | "input-complete"
  | "approval-requested"
  | "approval-responded"
  | "complete"
  | "error";
type ChatClientState = "ready" | "submitted" | "streaming" | "error";
```

### `ai/conversation`

```tsx
<Conversation>
  {" "}
  // ScrollArea + stick-to-bottom; provides {(pinned, scrollToBottom)}
  <ConversationContent>…</ConversationContent> // the column, max-w / padding owned by caller
  <ConversationScrollButton /> // appears when !pinned
</Conversation>
```

### `ai/message`

```tsx
<Message from={message.role}>       // data-role, aligns user right / assistant full-width
  <MessageContent>                  // bubble for user, bare for assistant
    <MessageParts message={message} streaming={isLast && status === 'streaming'} renderers={{ 'tool-call': …, text: … }} />
  </MessageContent>
</Message>
```

`MessageParts` defaults: `text → Response`, `thinking → Reasoning`, `tool-call → Tool`, `tool-result → null`, everything else → `null`. `renderers` is `Partial<Record<Part['type'], (part, ctx) => ReactNode>>`; a renderer returning `undefined` falls back to the default, so an app can special-case one tool name and let the rest through.

### `ai/response`

`<Response streaming>{markdown}</Response>` — `remend` repairs unterminated `**`, `` ` ``, links and fences only while `streaming`; `react-markdown` + `remark-gfm` renders. Prose styles are Tailwind utilities on the wrapper (no `@tailwindcss/typography` yet; add when tables/blockquotes need it).

### `ai/reasoning`

`<Reasoning content={part.content} streaming />` — `Collapsible`; opens itself while `streaming`, closes ~1s after it stops unless the user toggled it; header shows "Thinking…" / "Thought for Ns".

### `ai/tool`

```tsx
<Tool part={part}>
  {" "}
  // Collapsible, default open when state is 'error' or 'approval-requested'
  <ToolHeader /> // wrench + name + state badge (spinner / check / warning)
  <ToolContent>
    <ToolInput /> // part.input (falls back to raw part.arguments while streaming)
    <ToolOutput /> // part.output, or the error
  </ToolContent>
</Tool>
```

Header/Input/Output read the part from context so an app can wrap `Tool` and replace only `ToolOutput` for a specific tool.

### `ai/prompt`

```tsx
<PromptInput status={status} onSubmit={(text) => sendMessage(text)} onStop={stop}>
  <PromptInputTextarea placeholder="Message Erudane…" autoFocus />
  <PromptInputToolbar>
    <PromptInputSubmit /> // send when 'ready' and text non-empty; stop when 'submitted'|'streaming'
  </PromptInputToolbar>
</PromptInput>
```

Enter submits, Shift+Enter newlines; the textarea is `field-sizing-content` capped at `max-h-48`.

## Phases

1. **Scaffold + move.** Create the package, move primitives/icons/theme, add `collapsible`, rewire `apps/web` imports and `styles.css`. `bun run check` green; chat page unchanged visually.
2. **AI elements.** Write `ai/*`; port `apps/web/src/chat/{messages,part,composer}.tsx` onto them and delete what they replace. Verify streaming text, thinking, a tool call, stop, error.
3. **Later, not now.** `Sources`, `Suggestions`, `Actions` (copy/retry), `Attachments` on `PromptInput`, structured-output and `ui-resource` renderers, `@tailwindcss/typography`, and a shadcn registry JSON so the CLI can `add` these into another app.
