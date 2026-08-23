# Web and UI

## Composer state

`PromptInput` owns text plus an attachment list. Each item has a stable client id and one of these states:

```ts
| { status: "uploading"; file; previewUrl; abort }
| { status: "ready"; file; previewUrl; uploaded }
| { status: "error"; file; previewUrl; message }
```

`uploaded` is `{ id, mediaType, fileName, size }` from `POST /api/files`.

Files enter through:

- a toolbar file button backed by a hidden multiple file input whose accept list comes from the files domain's supported MIME types;
- pasted clipboard files;
- drag and drop over the composer.

The browser rejects obviously unsupported types and files over 20 MiB before upload. The server repeats all checks. Each image gets an object URL immediately so its tile does not wait for R2. PDFs use the shared document presentation.

Removing an item aborts an in-flight request and revokes its object URL. Unmount also aborts and revokes. A failed upload stays visible with an error and remove action; send remains disabled until the user removes or retries it.

## Submit contract

`PromptInput.onSubmit` receives:

```ts
{
  readonly text: string;
  readonly attachments: ReadonlyArray<UploadedFile>;
}
```

Submission is allowed when text is non-empty or at least one ready attachment exists, no upload is pending or failed, and chat is not busy.

`apps/web/src/chat/chat.tsx` converts it to TanStack parts and calls `sendMessage({ content })`. Text comes first when present. Attachment order follows the composer. The composer clears only after handing the complete content to `sendMessage`.

## Shared attachment tile

`packages/ui/src/ai/attachment.tsx` renders a square, accessible tile:

- image: `<img>` with `object-cover`, an empty alt because the filename is adjacent or available by label;
- PDF: filled file icon, truncated filename and formatted byte size;
- uploading: subdued overlay and spinner;
- error: destructive border/status;
- removable composer item: top-right icon button with an explicit label.

The component accepts display data and optional status/actions. It does not know how upload works.

Composer tiles sit above the textarea in a wrapping row. Message tiles render before message text. A user message containing only attachments still has a visible bubble area without blank text padding.

`MessageParts` adds default renderers for `image` and `document`, both using `Attachment`. The source URL is used only for preview/download. PDF tiles link to the API URL in a new tab.
