import * as Alchemy from "alchemy";
import { StorageError, type FileNotFound } from "@erudane/files/errors";
import { Files } from "@erudane/files/service";
import { fromReference, type File, type FileId, MAX_BYTES } from "@erudane/files/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Prompt from "effect/unstable/ai/Prompt";
import type * as Response from "effect/unstable/ai/Response";
import type { ChatError, RepoError, ThreadNotFound } from "./errors";
import * as Ids from "./ids";
import { Chat } from "./service";
import { ThreadRepo } from "./threads";
import type { ChatEvent, MessageId, NewMessage, RunInput, ThreadId } from "./types";

/** One persisted run on a thread: load history, store the user message, stream, store the result. */
export interface Interface {
  readonly start: (
    input: RunInput,
  ) => Stream.Stream<
    ChatEvent,
    ChatError | FileNotFound | StorageError | ThreadNotFound | RepoError,
    Alchemy.RuntimeContext
  >;
}

/**
 * @effect-expect-leaking RuntimeContext
 * `Alchemy.RuntimeContext` is the worker's per-request context, carried by the repository.
 */
export class Service extends Context.Service<Service, Interface>()("@erudane/chat/Run") {}

interface ByteState {
  readonly chunks: Array<Uint8Array>;
  readonly size: number;
}

interface Step {
  readonly messageId: MessageId;
  readonly parts: Array<Response.StreamPart<any>>;
}

const publicUrl = (value: string | URL): URL | undefined => {
  try {
    const url = typeof value === "string" ? new URL(value) : value;
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
};

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const chat = yield* Chat.Service;
    const files = yield* Files.Service;
    const repo = yield* ThreadRepo.Service;
    const ids = yield* Ids.make;

    /** What a finished run stores: per step, the assistant message and (if tools ran) the tool message. */
    const toMessages = (steps: ReadonlyArray<Step>): Effect.Effect<ReadonlyArray<NewMessage>> =>
      Effect.forEach(steps, (step) =>
        Effect.forEach(
          Prompt.fromResponseParts(step.parts).content,
          (message): Effect.Effect<NewMessage> =>
            message.role === "assistant"
              ? Effect.succeed({ id: step.messageId, message })
              : Effect.map(ids.messageId, (id) => ({ id, message })),
        ),
      ).pipe(Effect.map((nested) => nested.flat()));

    const bytes = (chunks: ReadonlyArray<Uint8Array>): Uint8Array => {
      const output = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return output;
    };

    const collectBytes = Effect.fn("Run.collectFileBytes")(function* (
      id: FileId,
      body: Stream.Stream<Uint8Array, StorageError>,
    ) {
      const state = yield* body.pipe(
        Stream.runFoldEffect(
          (): ByteState => ({ chunks: [], size: 0 }),
          (state, chunk): Effect.Effect<ByteState, StorageError> => {
            const size = state.size + chunk.byteLength;
            if (size > MAX_BYTES) {
              return Effect.fail(
                new StorageError({
                  operation: "resolve file",
                  cause: `file ${id} exceeds ${MAX_BYTES} bytes while reading`,
                }),
              );
            }
            return Effect.succeed({ chunks: [...state.chunks, chunk], size });
          },
        ),
      );
      return bytes(state.chunks);
    });

    const resolveFile = Effect.fn("Run.resolveFile")(function* (
      part: Prompt.FilePart,
      cache: Map<FileId, { readonly file: File; readonly data: Uint8Array }>,
    ) {
      if (!(typeof part.data === "string" || part.data instanceof URL)) return part;
      const id = fromReference(part.data);
      if (Option.isNone(id)) {
        const url = publicUrl(part.data);
        return url === undefined
          ? part
          : Prompt.filePart({
              mediaType: part.mediaType,
              fileName: part.fileName,
              data: url,
              options: part.options,
            });
      }

      let cached = cache.get(id.value);
      if (cached === undefined) {
        const resolved = yield* files.resolve(id.value);
        const data = yield* collectBytes(id.value, resolved.body);
        if (data.byteLength !== resolved.file.size) {
          return yield* new StorageError({
            operation: "resolve file",
            cause: `file ${id.value} body size does not match its metadata`,
          });
        }
        cached = { file: resolved.file, data };
        cache.set(id.value, cached);
      }
      return Prompt.filePart({
        mediaType: cached.file.mediaType,
        fileName: cached.file.fileName,
        data: cached.data,
        options: part.options,
      });
    });

    const resolveMessages = Effect.fn("Run.resolveMessages")(function* (
      messages: ReadonlyArray<Prompt.Message>,
    ) {
      const cache = new Map<FileId, { readonly file: File; readonly data: Uint8Array }>();
      const output: Array<Prompt.Message> = [];
      for (const message of messages) {
        if (message.role !== "user") {
          output.push(message);
          continue;
        }
        const content: Array<Prompt.UserMessagePart> = [];
        for (const part of message.content) {
          content.push(part.type === "file" ? yield* resolveFile(part, cache) : part);
        }
        output.push(Prompt.userMessage({ content, options: message.options }));
      }
      return output;
    });

    const persist = (threadId: ThreadId, steps: ReadonlyArray<Step>) =>
      Effect.flatMap(toMessages(steps), (items) =>
        items.length === 0 ? Effect.void : Effect.asVoid(repo.append(threadId, items)),
      );

    const start: Interface["start"] = (input) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const history = yield* repo.messages(input.threadId);
          const userId = yield* ids.messageId;
          yield* repo.append(input.threadId, [{ id: userId, message: input.message }]);

          const steps: Array<Step> = [];
          const collect = (event: ChatEvent) =>
            Effect.sync(() => {
              if (event._tag === "StepStart") {
                steps.push({ messageId: event.messageId, parts: [] });
              } else if (event._tag === "Part") {
                steps[steps.length - 1]?.parts.push(event.part);
              }
            });

          const messages = yield* resolveMessages([
            ...history.map((stored) => stored.message),
            input.message,
          ]);

          return chat
            .stream({
              messages,
              system: input.system,
              maxSteps: input.maxSteps,
            })
            .pipe(
              Stream.tap(collect),
              // After a successful end only: a failed or stopped run keeps just the user message.
              Stream.onEnd(Effect.suspend(() => persist(input.threadId, steps))),
            );
        }),
      );

    return Service.of({ start });
  }),
);

export * as Run from "./run";
