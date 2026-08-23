/**
 * Phase-1 collab spike page (throwaway — the real lesson route is phase 7).
 * BlockNote + y-websocket against the DocumentRoom Durable Object: open the
 * same document id in two tabs to watch edits and presence converge.
 */
import { FRAGMENT } from "@erudane/documents/types";
import { withCollaboration } from "@blocknote/core/yjs";
import { BlockNoteViewRaw, useCreateBlockNote } from "@blocknote/react";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import "@blocknote/core/style.css";

export const Route = createFileRoute("/doc-spike/$documentId")({ component: SpikePage });

interface Session {
  readonly doc: Y.Doc;
  readonly provider: WebsocketProvider;
}

function SpikePage() {
  const { documentId } = Route.useParams();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let disposed = false;
    let created: Session | null = null;
    void (async () => {
      const info = (await (await fetch("/api/info")).json()) as { url: string };
      if (disposed) return;
      const base = info.url.replace(/^http/, "ws").replace(/\/$/, "");
      const doc = new Y.Doc();
      const provider = new WebsocketProvider(`${base}/documents`, documentId, doc);
      created = { doc, provider };
      setSession(created);
    })();
    return () => {
      disposed = true;
      created?.provider.destroy();
      created?.doc.destroy();
      setSession(null);
    };
  }, [documentId]);

  if (session === null) return <main style={{ padding: 32 }}>connecting…</main>;
  return <Editor key={documentId} session={session} />;
}

function Editor({ session }: { readonly session: Session }) {
  const editor = useCreateBlockNote(
    withCollaboration({
      collaboration: {
        provider: session.provider,
        fragment: session.doc.getXmlFragment(FRAGMENT),
        user: { name: "You", color: "#2563eb" },
      },
    }),
  );
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 32 }}>
      <BlockNoteViewRaw editor={editor} />
    </main>
  );
}
