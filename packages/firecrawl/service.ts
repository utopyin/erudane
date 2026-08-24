/**
 * Firecrawl v2 over Effect's `HttpClient`
 */
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

const BASE_URL = "https://api.firecrawl.dev/v2";
const SEARCH_TIMEOUT_MS = 15_000;
const SCRAPE_TIMEOUT_MS = 20_000;
/** Slack past Firecrawl's own deadline before we give up on the request. */
const GRACE_MS = 5_000;

export class FirecrawlError extends Schema.TaggedError<FirecrawlError>()("Firecrawl.Error", {
  operation: Schema.Literals(["search", "scrape"]),
  message: Schema.String,
}) {}

export type Recency = "day" | "week" | "month" | "year";

export interface SearchOptions {
  /** Results to return (Firecrawl max 100). */
  readonly limit?: number | undefined;
  readonly recency?: Recency | undefined;
}

export interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly description: string;
}

export interface Page {
  readonly title: string | null;
  readonly url: string;
  readonly markdown: string;
}

export interface Interface {
  readonly search: (
    query: string,
    options?: SearchOptions,
  ) => Effect.Effect<ReadonlyArray<SearchResult>, FirecrawlError>;
  readonly scrape: (url: string) => Effect.Effect<Page, FirecrawlError>;
}

export class Service extends Context.Service<Service, Interface>()(
  "@erudane/firecrawl/Firecrawl",
) {}

/** Firecrawl reports failures as HTTP 200 with `success: false`. */
const Failure = Schema.Struct({
  success: Schema.Literal(false),
  error: Schema.optionalKey(Schema.String),
  code: Schema.optionalKey(Schema.String),
});

const SearchResponse = Schema.Struct({
  success: Schema.Literal(true),
  data: Schema.Struct({
    web: Schema.optionalKey(
      Schema.Array(
        Schema.Struct({
          title: Schema.optionalKey(Schema.String),
          url: Schema.String,
          description: Schema.optionalKey(Schema.String),
        }),
      ),
    ),
  }),
});

const ScrapeResponse = Schema.Struct({
  success: Schema.Literal(true),
  data: Schema.Struct({
    markdown: Schema.optionalKey(Schema.String),
    metadata: Schema.optionalKey(
      Schema.Struct({
        title: Schema.optionalKey(Schema.String),
        sourceURL: Schema.optionalKey(Schema.String),
      }),
    ),
  }),
});

/** Firecrawl's `tbs` time filter. */
const tbs: Record<Recency, string> = {
  day: "qdr:d",
  week: "qdr:w",
  month: "qdr:m",
  year: "qdr:y",
};

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const apiKey = yield* Config.redacted("FIRECRAWL_API_KEY");
    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest(HttpClientRequest.bearerToken(Redacted.value(apiKey))),
      HttpClient.filterStatusOk,
    );

    const post = <S extends Schema.Codec<{ readonly success: true }, any, never, never>>(
      operation: "search" | "scrape",
      path: string,
      body: unknown,
      schema: S,
      timeoutMs: number,
    ): Effect.Effect<S["Type"], FirecrawlError> =>
      HttpClientRequest.post(`${BASE_URL}${path}`).pipe(
        HttpClientRequest.bodyJsonUnsafe(body),
        client.execute,
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Union([schema, Failure]))),
        Effect.timeout(timeoutMs + GRACE_MS),
        Effect.mapError((error) => new FirecrawlError({ operation, message: describe(error) })),
        Effect.flatMap((body) =>
          body.success
            ? Effect.succeed(body)
            : Effect.fail(
                new FirecrawlError({ operation, message: body.error ?? body.code ?? "failed" }),
              ),
        ),
        Effect.withSpan(`Firecrawl.${operation}`),
      );

    const search: Interface["search"] = (query, options) =>
      post(
        "search",
        "/search",
        {
          query,
          limit: options?.limit ?? 5,
          sources: [{ type: "web" }],
          timeout: SEARCH_TIMEOUT_MS,
          ...(options?.recency === undefined ? {} : { tbs: tbs[options.recency] }),
        },
        SearchResponse,
        SEARCH_TIMEOUT_MS,
      ).pipe(
        Effect.map((response) =>
          (response.data.web ?? []).map((item) => ({
            title: item.title ?? item.url,
            url: item.url,
            description: item.description ?? "",
          })),
        ),
      );

    const scrape: Interface["scrape"] = (url) =>
      post(
        "scrape",
        "/scrape",
        { url, formats: ["markdown"], onlyMainContent: true, timeout: SCRAPE_TIMEOUT_MS },
        ScrapeResponse,
        SCRAPE_TIMEOUT_MS,
      ).pipe(
        Effect.map((response) => ({
          title: response.data.metadata?.title ?? null,
          url: response.data.metadata?.sourceURL ?? url,
          markdown: response.data.markdown ?? "",
        })),
      );

    return Service.of({ search, scrape });
  }),
).pipe(Layer.provide(FetchHttpClient.layer));

const describe = (error: { readonly _tag: string; readonly message?: string }): string => {
  switch (error._tag) {
    case "TimeoutError":
      return "Firecrawl did not answer in time";
    case "SchemaError":
      return "Firecrawl returned an unexpected response";
    default:
      return error.message ?? error._tag;
  }
};

export * as Firecrawl from "./service";
