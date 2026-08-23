/**
 * Transport-neutral collaborative-room logic: the Y.Doc lifecycle, the
 * y-websocket wire protocol (sync + awareness via y-protocols), block-scoped
 * agent edits, and the markdown projection. No cloudflare imports — the
 * Durable Object (apps/api) and scratch scripts both drive this.
 *
 * BlockNote conversions run headless. `@blocknote/server-util` is jsdom-bound
 * (unusable under workerd), so this module uses `@blocknote/core` directly
 * with a linkedom document standing in for the DOM the parsers expect.
 */
import { BlockNoteEditor, blocksToMarkdown, markdownToBlocks } from "@blocknote/core";
import { blocksToYXmlFragment, yXmlFragmentToBlocks } from "@blocknote/core/yjs";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { parseHTML } from "linkedom";
import * as awareness from "y-protocols/awareness";
import * as sync from "y-protocols/sync";
import * as Y from "yjs";
import { FRAGMENT, type RoomEdit } from "./types";

export { FRAGMENT };

/** y-websocket message envelope tags. */
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

// ─── DOM shim ────────────────────────────────────────────────────────────────

/**
 * BlockNote's HTML/markdown parsers reach for `document` (ProseMirror
 * DOMParser, `createHTMLDocument`). Neither workerd nor bun has one; linkedom
 * provides enough of one. Installed once, only where missing — never in a
 * browser.
 */
const blankPage = () => parseHTML("<!doctype html><html><head></head><body></body></html>");

const domDocument = (): Document => {
  if (typeof globalThis.document !== "undefined") return globalThis.document;
  const dom = blankPage();
  // linkedom ships no `DOMImplementation`; BlockNote's parser wants
  // `createHTMLDocument` for a detached scratch document — a fresh linkedom
  // page serves.
  const doc = dom.document as unknown as Record<string, unknown>;
  const implementation = (doc["implementation"] ?? {}) as Record<string, unknown>;
  if (typeof implementation["createHTMLDocument"] !== "function") {
    implementation["createHTMLDocument"] = () => blankPage().document;
    doc["implementation"] = implementation;
  }
  (globalThis as Record<string, unknown>).document = dom.document;
  (globalThis as Record<string, unknown>).window = dom.window;
  return dom.document as unknown as Document;
};

/** One headless editor per isolate: schema + conversion machinery, never mounted. */
let editorRef: BlockNoteEditor | undefined;
const editor = (): BlockNoteEditor => {
  domDocument();
  editorRef ??= BlockNoteEditor.create({ _headless: true } as never);
  return editorRef;
};

// ─── Room lifecycle ──────────────────────────────────────────────────────────

export interface Room {
  readonly doc: Y.Doc;
  readonly awareness: awareness.Awareness;
}

/** A fresh room, seeded from an encoded state (and update tail) when given. */
export const open = (state?: {
  readonly snapshot?: Uint8Array | undefined;
  readonly updates?: Iterable<Uint8Array> | undefined;
}): Room => {
  const doc = new Y.Doc();
  if (state?.snapshot !== undefined && state.snapshot.length > 0) {
    Y.applyUpdate(doc, state.snapshot);
  }
  for (const update of state?.updates ?? []) Y.applyUpdate(doc, update);
  const roomAwareness = new awareness.Awareness(doc);
  roomAwareness.setLocalState(null); // the server itself has no presence
  return { doc, awareness: roomAwareness };
};

export const encodeState = (room: Room): Uint8Array => Y.encodeStateAsUpdate(room.doc);

export const close = (room: Room): void => {
  room.awareness.destroy();
  room.doc.destroy();
};

// ─── Wire protocol ───────────────────────────────────────────────────────────

/** Frames the server sends to a socket immediately after accepting it. */
export const greeting = (room: Room): Uint8Array[] => {
  const frames: Uint8Array[] = [];
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  sync.writeSyncStep1(enc, room.doc);
  frames.push(encoding.toUint8Array(enc));
  const states = room.awareness.getStates();
  if (states.size > 0) {
    const aw = encoding.createEncoder();
    encoding.writeVarUint(aw, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      aw,
      awareness.encodeAwarenessUpdate(room.awareness, [...states.keys()]),
    );
    frames.push(encoding.toUint8Array(aw));
  }
  return frames;
};

/**
 * Handle one frame from a client. Direct replies (sync step 2) go back to the
 * sender only; document/awareness changes fan out through `subscribe`.
 * `origin` identifies the sender so its own updates aren't re-applied to it
 * by reference — pass the same value given to `subscribe` listeners.
 */
export const receive = (room: Room, frame: Uint8Array, origin: unknown): Uint8Array[] => {
  const decoder = decoding.createDecoder(frame);
  switch (decoding.readVarUint(decoder)) {
    case MESSAGE_SYNC: {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      sync.readSyncMessage(decoder, enc, room.doc, origin);
      return encoding.length(enc) > 1 ? [encoding.toUint8Array(enc)] : [];
    }
    case MESSAGE_AWARENESS: {
      awareness.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), origin);
      return [];
    }
    default:
      return [];
  }
};

export interface AwarenessChange {
  readonly added: ReadonlyArray<number>;
  readonly updated: ReadonlyArray<number>;
  readonly removed: ReadonlyArray<number>;
}

export interface Listeners {
  /** A frame every connected socket should receive (sender included; Yjs updates are idempotent). */
  readonly broadcast: (frame: Uint8Array) => void;
  /** Raw document updates, for persistence. */
  readonly update?: ((update: Uint8Array) => void) | undefined;
  /** Awareness deltas with their origin, for per-socket client-id tracking. */
  readonly awareness?: ((change: AwarenessChange, origin: unknown) => void) | undefined;
}

/** Wire the room's events to a transport; returns the unsubscribe. */
export const subscribe = (room: Room, listeners: Listeners): (() => void) => {
  const onUpdate = (update: Uint8Array) => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    sync.writeUpdate(enc, update);
    listeners.broadcast(encoding.toUint8Array(enc));
    listeners.update?.(update);
  };
  const onAwareness = (change: AwarenessChange, origin: unknown) => {
    const changed = [...change.added, ...change.updated, ...change.removed];
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(enc, awareness.encodeAwarenessUpdate(room.awareness, changed));
    listeners.broadcast(encoding.toUint8Array(enc));
    listeners.awareness?.(change, origin);
  };
  room.doc.on("update", onUpdate);
  room.awareness.on("update", onAwareness);
  return () => {
    room.doc.off("update", onUpdate);
    room.awareness.off("update", onAwareness);
  };
};

/** Drop a departed client's presence (fans out through `subscribe`). */
export const disconnect = (room: Room, clientIds: ReadonlyArray<number>): void => {
  if (clientIds.length > 0) awareness.removeAwarenessStates(room.awareness, [...clientIds], null);
};

// ─── Agent edits ─────────────────────────────────────────────────────────────

/** The awareness identity shown while the agent is writing. */
const AGENT_PRESENCE = { user: { name: "Erudane", color: "#7c5cff" } };

const findContainer = (
  parent: Y.XmlFragment,
  blockId: string,
): { readonly parent: Y.XmlFragment; readonly index: number } | undefined => {
  for (let index = 0; index < parent.length; index++) {
    const child = parent.get(index);
    if (!(child instanceof Y.XmlElement)) continue;
    if (child.getAttribute("id") === blockId) return { parent, index };
    const nested = findContainer(child, blockId);
    if (nested !== undefined) return nested;
  }
  return undefined;
};

/** Top-level block group of the fragment, created when the doc is still empty. */
const blockGroup = (fragment: Y.XmlFragment): Y.XmlElement => {
  const existing = fragment.length > 0 ? fragment.get(0) : undefined;
  if (existing instanceof Y.XmlElement) return existing;
  const group = new Y.XmlElement("blockGroup");
  fragment.insert(0, [group]);
  return group;
};

/** Parse op markdown into detached `blockContainer` elements ready to insert. */
const parseContainers = (markdown: string): Y.XmlElement[] => {
  const blocks = markdownToBlocks(markdown, editor().pmSchema);
  // Integrated into a scratch doc first: only integrated types expose their
  // children for cloning (an unattached fragment holds prelim content).
  const fragment = new Y.Doc().getXmlFragment(FRAGMENT);
  blocksToYXmlFragment(editor(), blocks as never, fragment);
  const group = fragment.get(0);
  if (!(group instanceof Y.XmlElement)) return [];
  const clones: Y.XmlElement[] = [];
  for (let index = 0; index < group.length; index++) {
    const child = group.get(index);
    if (child instanceof Y.XmlElement) clones.push(child.clone());
  }
  return clones;
};

/**
 * Apply block-scoped ops as one transaction; connected editors see the change
 * as a single remote edit. Unknown block ids degrade to append (the agent's
 * view of the doc may be stale) — never a lost edit.
 */
export const edit = (room: Room, ops: ReadonlyArray<RoomEdit>): void => {
  const fragment = room.doc.getXmlFragment(FRAGMENT);
  room.doc.transact(() => {
    for (const op of ops) {
      const group = blockGroup(fragment);
      switch (op.op) {
        case "append": {
          group.insert(group.length, parseContainers(op.markdown));
          break;
        }
        case "insertAfter": {
          const found = findContainer(fragment, op.blockId);
          const containers = parseContainers(op.markdown);
          if (found === undefined) group.insert(group.length, containers);
          else found.parent.insert(found.index + 1, containers);
          break;
        }
        case "replaceBlock": {
          const found = findContainer(fragment, op.blockId);
          const containers = parseContainers(op.markdown);
          if (found === undefined) group.insert(group.length, containers);
          else {
            found.parent.delete(found.index, 1);
            found.parent.insert(found.index, containers);
          }
          break;
        }
        case "deleteBlock": {
          const found = findContainer(fragment, op.blockId);
          if (found !== undefined) found.parent.delete(found.index, 1);
          break;
        }
      }
    }
  }, "agent");
};

/** Show/clear the agent's presence around an edit (BlockNote renders it as a collaborator). */
export const agentPresence = (room: Room, editing: boolean): void => {
  room.awareness.setLocalState(editing ? AGENT_PRESENCE : null);
};

// ─── Projection ──────────────────────────────────────────────────────────────

/** The whole document as markdown — the model-facing read. */
export const markdown = (room: Room): string => {
  const blocks = yXmlFragmentToBlocks(editor(), room.doc.getXmlFragment(FRAGMENT));
  return blocksToMarkdown(blocks as never, editor().pmSchema, editor(), {
    document: domDocument(),
  });
};

/**
 * Markdown annotated with block ids (`[id]: …` reference lines per block) so
 * the model can target `RoomEdit` ops at specific blocks.
 */
export const annotatedMarkdown = (room: Room): string => {
  const blocks = yXmlFragmentToBlocks(editor(), room.doc.getXmlFragment(FRAGMENT));
  return blocks
    .map((block) => {
      const body = blocksToMarkdown([block] as never, editor().pmSchema, editor(), {
        document: domDocument(),
      }).trim();
      return `<!-- block:${block.id} -->\n${body}`;
    })
    .join("\n\n");
};

/** Seed an empty room from markdown (first import only — rewrites history). */
export const seed = (room: Room, content: string): void => {
  const blocks = markdownToBlocks(content, editor().pmSchema);
  blocksToYXmlFragment(editor(), blocks as never, room.doc.getXmlFragment(FRAGMENT));
};
