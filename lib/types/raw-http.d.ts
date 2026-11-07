/** Literal HTTP/1.1 dispatcher for the fixed Antigravity wire profile. */
export interface RawPrivateRequest {
    readonly url: string;
    readonly accessToken: string;
    readonly body: string | Uint8Array;
    readonly signal?: AbortSignal;
    readonly responseHeaderTimeoutMs: number;
}
/** Dispatch one request using the immutable plugin-owned Wire Identity. */
export declare function createRawPrivateDispatcher(): (input: RawPrivateRequest) => Promise<Response>;
export declare function setExplicitProxy(value: string | undefined): void;
/** Bounded HTTPS fetch implementation that respects explicit/environment proxy without modifying the global dispatcher. */
export declare function scopedHttpsFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
//# sourceMappingURL=raw-http.d.ts.map