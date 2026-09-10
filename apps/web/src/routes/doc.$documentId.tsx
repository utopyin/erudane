/**
 * The collaborative document editor: BlockNote + y-websocket straight to the
 * document's DocumentRoom DO. The agent co-edits the same doc through its
 * tools mid-chat-run — its presence and edits appear live.
 */
import { FRAGMENT } from "@erudane/documents/types";
import { withCollaboration } from "@blocknote/core/yjs";
import { BlockNoteViewRaw, useCreateBlockNote } from "@blocknote/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import "@blocknote/core/style.css";

export const Route = createFileRoute("/doc/$documentId")({ ssr: false, component: DocumentPage });

interface Session {
  readonly doc: Y.Doc;
  readonly provider: WebsocketProvider;
}

function DocumentPage() {
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

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-4 px-4 py-8">
      <div className="text-muted-foreground text-sm">
        <Link to="/subjects" className="hover:underline">
          Subjects
        </Link>
      </div>
      {session === null ? (
        <p className="text-muted-foreground">connecting…</p>
      ) : (
        <Editor key={documentId} session={session} />
      )}
    </main>
  );
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
  return <BlockNoteViewRaw editor={editor} />;
}
