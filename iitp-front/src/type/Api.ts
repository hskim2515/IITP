import type { paths as GeneratedPaths } from "@type/openapi.gen";

export type HttpMethod =
    | "get"
    | "post"
    | "put"
    | "patch"
    | "delete"
    | "head"
    | "options"
    | "trace";
export type UpperHttpMethod = Uppercase<HttpMethod>;

export type Paths = GeneratedPaths;

export type PathItem<P extends keyof Paths> = Paths[P];

export type Operation<P extends keyof Paths, M extends keyof PathItem<P> & HttpMethod> = PathItem<P>[M]

export type RequestParams<P extends keyof Paths, M extends HttpMethod> = Operation<P, M> extends {
    parameters: infer Params
} ? Params : never;

export type PathParams<P extends keyof Paths, M extends HttpMethod> = RequestParams<P, M> extends {
    path: infer PP
} ? PP : never;

export type QueryParams<P extends keyof Paths, M extends HttpMethod> = RequestParams<P, M> extends {
    query: infer QP
} ? QP : never;

export type HeaderParams<P extends keyof Paths, M extends HttpMethod> = RequestParams<P, M> extends {
    header: infer HP
} ? HP : never;

export type RequestBody<P extends keyof Paths, M extends HttpMethod> = Operation<P, M> extends {
        requestBody: {content: infer C}
    } ? C extends {"application/json": infer J} ? J
        : unknown
    : never;