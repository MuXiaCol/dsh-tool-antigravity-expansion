import { ANTIGRAVITY_WIRE_ORIGIN, createWireIdentity } from "./wire-identity.js";
import { Buffer } from "node:buffer";
import * as net from "node:net";
import { PassThrough, Transform } from "node:stream";
import * as tls from "node:tls";
import { createGunzip } from "node:zlib";
//#region src/private-transport-error.ts
var PrivateTransportError = class extends Error {
	code;
	status;
	/** Whether an upstream could have accepted the request before the failure. */
	accepted;
	constructor(code, message, options = {}) {
		super(message, options.cause !== void 0 ? { cause: options.cause } : void 0);
		this.name = "PrivateTransportError";
		this.code = code;
		this.accepted = options.accepted ?? true;
		if (options.status !== void 0) this.status = options.status;
	}
};
//#endregion
//#region src/raw-http.ts
/** Literal HTTP/1.1 dispatcher for the fixed Antigravity wire profile. */
const DEFAULT_HTTPS_PORT = 443;
const DEFAULT_PROXY_PORT = 8080;
const MAX_RESPONSE_HEAD_BYTES = 65536;
/** Persistent Keep-Alive Socket pool & TLS Session cache (TTFT & Resumption optimization). */
const proxySocketPool = new Map();
const tlsSessionCache = new Map();
function getPooledSocket(key) {
	const list = proxySocketPool.get(key);
	if (!list || list.length === 0) return void 0;
	while (list.length > 0) {
		const s = list.pop();
		if (s && !s.destroyed && s.readable && s.writable) {
			const purge = s.__agyPoolPurge;
			if (purge !== void 0) {
				s.removeListener("end", purge);
				s.removeListener("close", purge);
				s.__agyPoolPurge = void 0;
			}
			s.ref?.();
			return s;
		}
		try { s?.destroy(); } catch {}
	}
	return void 0;
}
/** Drop one socket from every pool bucket before it is reused after a peer close. */
function forgetPooledSocket(socket) {
	for (const [key, list] of proxySocketPool) {
		const index = list.indexOf(socket);
		if (index >= 0) {
			list.splice(index, 1);
			if (list.length === 0) proxySocketPool.delete(key);
		}
	}
}
function releasePooledSocket(key, socket) {
	if (!socket || socket.destroyed || !socket.readable || !socket.writable) return;
	let list = proxySocketPool.get(key);
	if (!list) {
		list = [];
		proxySocketPool.set(key, list);
	}
	if (list.includes(socket)) return;
	if (list.length < 8) {
		list.push(socket);
		/** A peer-closed idle socket must leave the pool instead of being handed to the next request. */
		const purge = () => {
			forgetPooledSocket(socket);
			try { socket.destroy(); } catch {}
		};
		socket.__agyPoolPurge = purge;
		socket.once("end", purge);
		socket.once("close", purge);
		/** An idle pooled socket must stay in flowing mode, otherwise the next request never sees its reply. */
		socket.resume?.();
		socket.unref?.();
	} else {
		try { socket.destroy(); } catch {}
	}
}
/** Dispatch one request using the immutable plugin-owned Wire Identity. */
function createRawPrivateDispatcher() {
	const wire = createWireIdentity();
	return async (input) => {
		if (input.signal?.aborted === true) throw cancelled(false);
		const url = new URL(input.url);
		const request = wire.serialize(input.url, {
			authorization: `Bearer ${input.accessToken}`,
			body: input.body
		});
		const proxy = httpsProxy(url);
		const poolKey = proxy ? `${proxy.origin}->${url.origin}` : `direct->${url.origin}`;
		let socket = getPooledSocket(poolKey);
		let isReusedSocket = socket !== void 0;
		if (!socket) {
			socket = await connectTls(url, input.responseHeaderTimeoutMs, input.signal);
		}
		let dispatched = false;
		const abort = () => {
			socket.on("error", () => {});
			socket.destroy();
		};
		try {
			if (isAborted$1(input.signal)) throw cancelled(false);
			input.signal?.addEventListener("abort", abort, { once: true });
			const bytesBefore = socket.bytesRead;
			socket.write(request);
			dispatched = true;
			/** A reused socket that died silently must fail fast instead of stalling the full header timeout. */
			const headerTimeoutMs = isReusedSocket ? Math.min(input.responseHeaderTimeoutMs, 2e4) : input.responseHeaderTimeoutMs;
			let headResult;
			try {
				headResult = await waitForHead(socket, headerTimeoutMs, dispatched, input.signal);
			} catch (firstError) {
				/**
				 * Only a reused socket that produced no bytes at all is retried: writing to a
				 * half-closed socket is safe to repeat, while re-sending a request the peer is
				 * still working on would duplicate the generation.
				 */
				const silent = socket.bytesRead === bytesBefore;
				if (isReusedSocket && silent && !isAborted$1(input.signal)) {
					try { socket.destroy(); } catch {}
					socket = await connectTls(url, input.responseHeaderTimeoutMs, input.signal);
					socket.write(request);
					headResult = await waitForHead(socket, input.responseHeaderTimeoutMs, true, input.signal);
				} else {
					throw firstError;
				}
			}
			const { head, leftover } = headResult;
			const parsed = parseResponseHead(head);
			const body = buildResponseBody(socket, leftover, parsed, input.signal, poolKey);
			return new Response(body, {
				status: parsed.status,
				statusText: parsed.statusText,
				headers: parsed.headers
			});
		} catch (error) {
			socket.destroy();
			if (error instanceof PrivateTransportError) throw error;
			throw new PrivateTransportError("offline", "The private endpoint could not be reached", { accepted: dispatched });
		} finally {
			input.signal?.removeEventListener("abort", abort);
		}
	};
}
async function connectTls(url, timeoutMs, signal) {
	const proxy = httpsProxy(url);
	return proxy === void 0 ? connectDirect(url, timeoutMs, signal) : connectThroughProxy(proxy, url, timeoutMs, signal);
}
async function connectDirect(url, timeoutMs, signal) {
	const session = tlsSessionCache.get(url.hostname);
	const socket = tls.connect({
		host: url.hostname,
		port: Number(url.port || DEFAULT_HTTPS_PORT),
		servername: url.hostname,
		session
	});
	socket.once("session", (newSession) => {
		tlsSessionCache.set(url.hostname, newSession);
	});
	configureSocketKeepAlive(socket);
	await waitForConnect(socket, "secureConnect", timeoutMs, signal);
	return socket;
}
async function connectThroughProxy(proxy, target, timeoutMs, signal) {
	const proxyAuthorization = proxyAuthorizationHeader(proxy);
	const proxySocket = net.connect({
		host: proxy.hostname,
		port: Number(proxy.port || DEFAULT_PROXY_PORT)
	});
	configureSocketKeepAlive(proxySocket);
	await waitForConnect(proxySocket, "connect", timeoutMs, signal);
	const targetPort = Number(target.port || DEFAULT_HTTPS_PORT);
	proxySocket.write(`CONNECT ${target.hostname}:${targetPort} HTTP/1.1\r\nHost: ${target.hostname}:${targetPort}\r\n` + proxyAuthorization + "\r\n");
	const { head, leftover } = await waitForHead(proxySocket, timeoutMs, false, signal);
	if (!/^HTTP\/1\.[01]\s+2\d\d(?:\s|$)/u.test(head.split("\r\n", 1)[0] ?? "")) {
		proxySocket.destroy();
		throw new PrivateTransportError("offline", "The HTTPS proxy rejected the private connection", { accepted: false });
	}
	if (leftover.byteLength > 0) proxySocket.unshift(leftover);
	proxySocket.resume();
	const session = tlsSessionCache.get(target.hostname);
	const socket = tls.connect({
		socket: proxySocket,
		servername: target.hostname,
		session
	});
	socket.once("session", (newSession) => {
		tlsSessionCache.set(target.hostname, newSession);
	});
	configureSocketKeepAlive(socket);
	await waitForConnect(socket, "secureConnect", timeoutMs, signal);
	return socket;
}
function configureSocketKeepAlive(socket) {
	const netSocket = socket;
	if (typeof netSocket.setNoDelay === "function") netSocket.setNoDelay(true);
	if (typeof netSocket.setKeepAlive === "function") netSocket.setKeepAlive(true, 15e3);
}
async function waitForConnect(socket, event, timeoutMs, signal) {
	await new Promise((resolve, reject) => {
		let settled = false;
		const finish = (action) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket.removeListener(event, onConnect);
			socket.removeListener("error", onError);
			signal?.removeEventListener("abort", onAbort);
			action();
		};
		const onConnect = () => finish(resolve);
		const onError = (error) => finish(() => reject(new PrivateTransportError("offline", "The private endpoint could not be reached", {
			accepted: false,
			cause: error
		})));
		const onAbort = () => finish(() => {
			socket.destroy();
			reject(cancelled(false));
		});
		const timer = setTimeout(() => finish(() => {
			socket.destroy();
			reject(new PrivateTransportError("timeout", "The private endpoint connection timed out", { accepted: false }));
		}), timeoutMs);
		socket.once(event, onConnect);
		socket.once("error", onError);
		if (signal?.aborted === true) onAbort();
		else signal?.addEventListener("abort", onAbort, { once: true });
	});
}
async function waitForHead(socket, timeoutMs, accepted, signal) {
	return new Promise((resolve, reject) => {
		let buffer = Buffer.alloc(0);
		let settled = false;
		const finish = (action) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket.removeListener("data", onData);
			socket.removeListener("error", onError);
			signal?.removeEventListener("abort", onAbort);
			action();
		};
		const onError = (error) => finish(() => reject(error instanceof PrivateTransportError ? error : new PrivateTransportError("offline", "The private endpoint closed before response headers", {
			accepted,
			cause: error
		})));
		const onAbort = () => finish(() => {
			socket.destroy();
			reject(cancelled(accepted));
		});
		const onData = (chunk) => {
			buffer = Buffer.concat([buffer, chunk]);
			const marker = buffer.indexOf("\r\n\r\n");
			if (marker < 0) {
				if (buffer.byteLength > MAX_RESPONSE_HEAD_BYTES) finish(() => reject(new PrivateTransportError("protocol-drift", "The private response headers exceeded the limit", { accepted })));
				return;
			}
			if (marker > MAX_RESPONSE_HEAD_BYTES) {
				finish(() => reject(new PrivateTransportError("protocol-drift", "The private response headers exceeded the limit", { accepted })));
				return;
			}
			socket.pause();
			const head = buffer.subarray(0, marker).toString("latin1");
			const leftover = buffer.subarray(marker + 4);
			finish(() => resolve({
				head,
				leftover
			}));
		};
		const timer = setTimeout(() => finish(() => {
			socket.destroy();
			reject(new PrivateTransportError("timeout", "The private request timed out before response headers", { accepted }));
		}), timeoutMs);
		socket.on("data", onData);
		socket.once("error", onError);
		if (signal?.aborted === true) onAbort();
		else signal?.addEventListener("abort", onAbort, { once: true });
	});
}
function parseResponseHead(value) {
	const lines = value.split("\r\n");
	const statusLine = lines.shift() ?? "";
	const match = /^HTTP\/1\.[01]\s+(\d{3})(?:\s+([^\r\n]*))?$/u.exec(statusLine);
	if (match === null) throw new PrivateTransportError("protocol-drift", "The private response status line was malformed");
	const status = Number(match[1]);
	if (status < 200 || status > 599 || hasInvalidHeaderValue(match[2] ?? "")) throw new PrivateTransportError("protocol-drift", "The private response status was unsupported");
	const headers = new Headers();
	let chunked = false;
	let gzip = false;
	let contentLength;
	for (const line of lines) {
		if (line.length === 0 || /^[ \t]/u.test(line)) throw new PrivateTransportError("protocol-drift", "The private response headers were malformed");
		const separator = line.indexOf(":");
		if (separator <= 0) throw new PrivateTransportError("protocol-drift", "The private response headers were malformed");
		const name = line.slice(0, separator);
		const raw = line.slice(separator + 1).trim();
		if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name) || hasInvalidHeaderValue(raw)) throw new PrivateTransportError("protocol-drift", "The private response headers were malformed");
		const lowerName = name.toLowerCase();
		const lowerValue = raw.toLowerCase();
		if (lowerName === "transfer-encoding") {
			if (chunked || lowerValue !== "chunked") throw new PrivateTransportError("protocol-drift", "The private response framing was unsupported");
			chunked = true;
			continue;
		}
		if (lowerName === "content-encoding") {
			if (gzip || lowerValue !== "gzip") throw new PrivateTransportError("protocol-drift", "The private response encoding was unsupported");
			gzip = true;
			continue;
		}
		if (lowerName === "content-length") {
			if (contentLength !== void 0 || !/^\d+$/u.test(raw)) throw new PrivateTransportError("protocol-drift", "The private response length was ambiguous");
			const parsed = Number(raw);
			if (!Number.isSafeInteger(parsed) || parsed < 0) throw new PrivateTransportError("protocol-drift", "The private response length was malformed");
			contentLength = parsed;
			continue;
		}
		headers.append(name, raw);
	}
	if (chunked && contentLength !== void 0) throw new PrivateTransportError("protocol-drift", "The private response framing was ambiguous");
	if (!gzip && contentLength !== void 0) headers.set("content-length", String(contentLength));
	return {
		status,
		statusText: match[2] ?? "",
		headers,
		chunked,
		gzip,
		...contentLength === void 0 ? {} : { contentLength }
	};
}
function buildResponseBody(socket, leftover, head, signal, poolKey) {
	const source = new PassThrough();
	let current = source;
	if (head.chunked) current = pipeStage(current, new ChunkedDecoder());
	else if (head.contentLength !== void 0) current = pipeStage(current, new ContentLengthDecoder(head.contentLength));
	if (head.gzip) {
		const gunzip = createGunzip();
		current = pipeStage(current, gunzip);
		current = pipeStage(current, new PassThrough(), (error) => {
			return error.code === "Z_BUF_ERROR" ? new PrivateTransportError("offline", "The private gzip response ended early") : new PrivateTransportError("protocol-drift", "The private gzip response was malformed");
		});
	}
	const abort = () => {
		socket.on("error", () => {});
		socket.destroy();
	};
	const isKeepAlive = head.headers.get("connection")?.toLowerCase() !== "close";
	let settled = false;
	const cleanup = (isError) => {
		/** `end` and `close` both fire on a healthy stream; only the first one may touch the socket. */
		if (settled) return;
		settled = true;
		signal?.removeEventListener("abort", abort);
		if (isKeepAlive && !isError && socket && !socket.destroyed && poolKey && socket.readableLength === 0) {
			try {
				socket.unpipe?.(source);
				socket.removeAllListeners("error");
				socket.on("error", () => {});
				releasePooledSocket(poolKey, socket);
				return;
			} catch {}
		}
		socket.destroy();
	};
	socket.once("error", (error) => {
		cleanup(true);
		source.destroy(error instanceof PrivateTransportError ? error : new PrivateTransportError("offline", "The private response stream failed"));
	});
	if (leftover.byteLength > 0) source.write(leftover);
	socket.pipe(source);
	socket.resume();
	if (signal?.aborted === true) abort();
	else signal?.addEventListener("abort", abort, { once: true });
	current.once("end", () => cleanup(false));
	current.once("error", () => cleanup(true));
	current.once("close", () => cleanup(false));
	return toWebBody(current);
}
function toWebBody(stream) {
	const iterable = { [Symbol.asyncIterator]: () => {
		const iterator = stream[Symbol.asyncIterator]();
		return {
			next: () => iterator.next(),
			return: async () => {
				stream.destroy();
				return iterator.return === void 0 ? {
					done: true,
					value: void 0
				} : await iterator.return();
			}
		};
	} };
	return ReadableStream.from(iterable);
}
function pipeStage(source, target, mapError = (error) => error) {
	source.once("error", (error) => target.destroy(mapError(error)));
	return source.pipe(target);
}
var ContentLengthDecoder = class extends Transform {
	remaining;
	constructor(contentLength) {
		super();
		this.remaining = contentLength;
		if (contentLength === 0) this.push(null);
	}
	_transform(chunk, _encoding, callback) {
		if (this.remaining <= 0 || chunk.byteLength > this.remaining) {
			callback(new PrivateTransportError("protocol-drift", "The private response exceeded its declared length"));
			return;
		}
		this.remaining -= chunk.byteLength;
		this.push(chunk);
		if (this.remaining === 0) this.push(null);
		callback();
	}
	_flush(callback) {
		callback(this.remaining === 0 ? void 0 : new PrivateTransportError("protocol-drift", "The private response ended before its declared length"));
	}
};
var ChunkedDecoder = class extends Transform {
	buffer = Buffer.alloc(0);
	finished = false;
	_transform(chunk, _encoding, callback) {
		if (this.finished && chunk.byteLength > 0) {
			callback(new PrivateTransportError("protocol-drift", "The private chunked response contained trailing bytes"));
			return;
		}
		this.buffer = Buffer.concat([this.buffer, chunk]);
		try {
			this.flushChunks();
			callback();
		} catch (error) {
			callback(error instanceof Error ? error : new PrivateTransportError("protocol-drift", "The private chunked response was malformed"));
		}
	}
	_flush(callback) {
		try {
			this.flushChunks();
			callback(this.finished ? void 0 : new PrivateTransportError("offline", "The private chunked response ended early"));
		} catch (error) {
			callback(error instanceof Error ? error : new PrivateTransportError("protocol-drift", "The private chunked response was malformed"));
		}
	}
	flushChunks() {
		while (!this.finished) {
			const lineEnd = this.buffer.indexOf("\r\n");
			if (lineEnd < 0) return;
			const sizeText = this.buffer.subarray(0, lineEnd).toString("latin1").split(";", 1)[0]?.trim() ?? "";
			if (!/^[0-9A-Fa-f]+$/u.test(sizeText)) throw new PrivateTransportError("protocol-drift", "The private chunk size was malformed");
			const size = Number.parseInt(sizeText, 16);
			if (!Number.isSafeInteger(size) || size < 0) throw new PrivateTransportError("protocol-drift", "The private chunk size was malformed");
			const chunkStart = lineEnd + 2;
			const chunkEnd = chunkStart + size;
			const end = chunkEnd + 2;
			if (!Number.isSafeInteger(end)) throw new PrivateTransportError("protocol-drift", "The private chunk size was malformed");
			if (this.buffer.byteLength < end) return;
			if (this.buffer[chunkEnd] !== 13 || this.buffer[chunkEnd + 1] !== 10) throw new PrivateTransportError("protocol-drift", "The private chunk terminator was malformed");
			const payload = this.buffer.subarray(chunkStart, chunkEnd);
			this.buffer = this.buffer.subarray(end);
			if (size === 0) {
				if (this.buffer.byteLength > 0) throw new PrivateTransportError("protocol-drift", "The private chunked response contained trailing bytes");
				this.finished = true;
				this.push(null);
				return;
			}
			this.push(payload);
		}
	}
};
function proxyAuthorizationHeader(proxy) {
	if (proxy.username.length === 0) return "";
	let username;
	let password;
	try {
		username = decodeURIComponent(proxy.username);
		password = decodeURIComponent(proxy.password);
	} catch {
		throw new PrivateTransportError("offline", "The configured HTTPS proxy credentials are invalid", { accepted: false });
	}
	if (username.length > 1024 || password.length > 1024 || username.includes(":") || hasInvalidHeaderValue(username) || hasInvalidHeaderValue(password)) throw new PrivateTransportError("offline", "The configured HTTPS proxy credentials are invalid", { accepted: false });
	return `Proxy-Authorization: Basic ${Buffer.from(`${username}:${password}`).toString("base64")}\r\n`;
}
let explicitProxy = void 0;
function setExplicitProxy(value) {
	explicitProxy = typeof value === "string" && value.trim().length > 0 ? value.trim() : void 0;
}
/** Bounded HTTPS fetch implementation that respects explicit/environment proxy without modifying the global dispatcher. */
async function scopedHttpsFetch(input, init) {
	const url = typeof input === "string" || input instanceof URL ? new URL(String(input)) : new URL(input.url);
	const proxy = url.protocol === "https:" ? httpsProxy(url) : void 0;
	if (proxy === void 0) return globalThis.fetch(input, init);
	const signal = init?.signal ?? void 0;
	if (isAborted$1(signal)) throw new DOMException("This operation was aborted", "AbortError");
	const method = (init?.method ?? (typeof input === "object" && "method" in input && typeof input.method === "string" ? input.method : "GET")).toUpperCase();
	const headers = new Headers(init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : void 0));
	let bodyBytes;
	if (init?.body !== void 0 && init.body !== null) {
		if (init.body instanceof URLSearchParams) {
			bodyBytes = Buffer.from(init.body.toString(), "utf-8");
			if (!headers.has("content-type")) headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
		} else if (typeof init.body === "string") bodyBytes = Buffer.from(init.body, "utf-8");
		else if (init.body instanceof Uint8Array || Buffer.isBuffer(init.body)) bodyBytes = Buffer.from(init.body);
		else if (init.body instanceof ArrayBuffer) bodyBytes = Buffer.from(init.body);
	}
	if (bodyBytes !== void 0) headers.set("content-length", String(bodyBytes.byteLength));
	else if ([
		"POST",
		"PUT",
		"PATCH"
	].includes(method) && !headers.has("content-length")) headers.set("content-length", "0");
	headers.set("host", url.host);
	headers.set("connection", "keep-alive");
	const timeoutMs = 6e4;
	const poolKey = `${proxy.origin}->${url.origin}`;
	let socket = getPooledSocket(poolKey);
	let isReusedSocket = socket !== void 0;
	if (!socket) {
		try {
			socket = await connectThroughProxy(proxy, url, timeoutMs, signal);
		} catch (error) {
			if (isAborted$1(signal)) throw new DOMException("This operation was aborted", "AbortError");
			throw error;
		}
	}
	let requestHead = `${method} ${url.pathname || "/"}${url.search} HTTP/1.1\r\n`;
	for (const [name, val] of headers.entries()) requestHead += `${name}: ${val}\r\n`;
	requestHead += "\r\n";
	const abort = () => {
		socket.destroy();
	};
	try {
		if (isAborted$1(signal)) throw new DOMException("This operation was aborted", "AbortError");
		signal?.addEventListener("abort", abort, { once: true });
		socket.write(Buffer.from(requestHead, "latin1"));
		if (bodyBytes !== void 0 && bodyBytes.byteLength > 0) socket.write(bodyBytes);
		let headResult;
		try {
			headResult = await waitForHead(socket, timeoutMs, true, signal);
		} catch (firstError) {
			// If a pooled socket died silently on the idle edge, seamlessly reconnect once
			if (isReusedSocket && !isAborted$1(signal)) {
				try { socket.destroy(); } catch {}
				socket = await connectThroughProxy(proxy, url, timeoutMs, signal);
				socket.write(Buffer.from(requestHead, "latin1"));
				if (bodyBytes !== void 0 && bodyBytes.byteLength > 0) socket.write(bodyBytes);
				headResult = await waitForHead(socket, timeoutMs, true, signal);
			} else {
				throw firstError;
			}
		}
		const { head, leftover } = headResult;
		const parsed = parseResponseHead(head);
		const isNoBody = parsed.status === 204 || parsed.status === 205 || parsed.status === 304 || method === "HEAD";
		if (isNoBody) {
			if (parsed.headers.get("connection")?.toLowerCase() !== "close") releasePooledSocket(poolKey, socket);
			else socket.destroy();
		}
		const bodyStream = isNoBody ? null : buildResponseBody(socket, leftover, parsed, signal, poolKey);
		return new Response(bodyStream, {
			status: parsed.status,
			statusText: parsed.statusText,
			headers: parsed.headers
		});
	} catch (error) {
		socket.destroy();
		if (isAborted$1(signal) || error instanceof PrivateTransportError && error.code === "cancelled") throw new DOMException("This operation was aborted", "AbortError");
		throw error;
	} finally {
		signal?.removeEventListener("abort", abort);
	}
}
function httpsProxy(url) {
	const noProxy = process.env.NO_PROXY ?? process.env.no_proxy ?? "";
	if (matchesNoProxy(url.hostname, noProxy)) return void 0;
	const raw = explicitProxy ?? process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.ALL_PROXY ?? process.env.all_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
	if (raw === void 0 || raw.length === 0) return void 0;
	try {
		const normalized = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
		const proxy = new URL(normalized);
		if (proxy.protocol !== "http:") throw new PrivateTransportError("offline", "The configured HTTPS proxy protocol is unsupported", { accepted: false });
		return proxy;
	} catch (error) {
		if (error instanceof PrivateTransportError) throw error;
		throw new PrivateTransportError("offline", "The configured HTTPS proxy URL is invalid", { accepted: false });
	}
}
function matchesNoProxy(hostname, value) {
	const host = hostname.toLowerCase();
	return value.split(",").map((item) => item.trim().toLowerCase()).some((item) => item === "*" || (item.startsWith(".") ? host.endsWith(item) : item.length > 0 && (host === item || host.endsWith(`.${item}`))));
}
function hasInvalidHeaderValue(value) {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code < 32 && code !== 9 || code === 127) return true;
	}
	return false;
}
function isAborted$1(signal) {
	return signal?.aborted === true;
}
function cancelled(accepted) {
	return new PrivateTransportError("cancelled", "The private request was cancelled", { accepted });
}
//#endregion
//#region src/private-transport.ts
/** Bounded Host-only transport primitives for the private Antigravity endpoints. */
const DEFAULT_PRIVATE_RESPONSE_HEADER_TIMEOUT_MS = 18e4;
const DEFAULT_PRIVATE_IDLE_TIMEOUT_MS = 24e4;
const DEFAULT_PRIVATE_TOTAL_TIMEOUT_MS = 6e5;
const DEFAULT_PRIVATE_RESPONSE_BYTES = 8388608;
const DEFAULT_PRIVATE_REQUEST_BYTES = 16777216;
const MAX_PRIVATE_REQUEST_BYTES = 67108864;
const DEFAULT_PRIVATE_FRAME_BYTES = 2097152;
/** Build one fixed raw private transport. Callers cannot supply headers, identity, or origins. */
function createPrivateTransport(options = {}) {
	let dispatch;
	const headerTimeoutMs = boundedTimeout(options.responseHeaderTimeoutMs, DEFAULT_PRIVATE_RESPONSE_HEADER_TIMEOUT_MS);
	const maxRequestBytes = boundedRequestBytes(options.maxRequestBytes);
	return { request: async (input) => {
		if (isAborted(input.signal)) throw cancelledError(false);
		if ((typeof input.body === "string" ? new TextEncoder().encode(input.body).byteLength : input.body.byteLength) > maxRequestBytes) throw new PrivateTransportError("request-too-large", "The private request exceeded the byte limit", { accepted: false });
		if (dispatch === void 0) try {
			dispatch = createRawPrivateDispatcher();
		} catch {
			throw new PrivateTransportError("attribution-rejected", "The private request identity could not be constructed", { accepted: false });
		}
		const response = await dispatch({
			url: input.url,
			accessToken: input.accessToken,
			body: input.body,
			...input.signal === void 0 ? {} : { signal: input.signal },
			responseHeaderTimeoutMs: boundedTimeout(input.responseHeaderTimeoutMs, headerTimeoutMs)
		});
		if (!(response instanceof Response)) throw new PrivateTransportError("invalid-response", "The private endpoint returned no response");
		return response;
	} };
}
/** Convert a bounded response status to a safe provider error without exposing its body. */
function privateStatusError(status) {
	if (status >= 200 && status < 300) return void 0;
	if (status === 401) return new PrivateTransportError("authentication", "The private endpoint requires authentication", { status });
	if (status === 403) return new PrivateTransportError("forbidden", "The private endpoint forbade this account", { status });
	if (status === 429) return new PrivateTransportError("rate-limited", "The private endpoint is rate-limited", { status });
	if (status >= 500) return new PrivateTransportError("upstream", "The private endpoint is unavailable", { status });
	return new PrivateTransportError("protocol-drift", "The private endpoint returned an unexpected status", { status });
}
/** Read a response body with byte, idle, total, and cancellation bounds. */
async function readPrivateBytes(response, options = {}) {
	const maxBytes = boundedBytes(options.maxBytes, DEFAULT_PRIVATE_RESPONSE_BYTES);
	if (response.body === null) try {
		const data = new Uint8Array(await response.arrayBuffer());
		if (data.byteLength > maxBytes) throw new PrivateTransportError("response-too-large", "The private response exceeded the byte limit");
		return data;
	} catch (error) {
		if (error instanceof PrivateTransportError) throw error;
		if (isAborted(options.signal)) throw cancelledError();
		throw new PrivateTransportError("offline", "The private response body could not be read");
	}
	const reader = response.body.getReader();
	const chunks = [];
	let total = 0;
	const startedAt = Date.now();
	try {
		for (;;) {
			const chunk = await readChunk(reader, options, startedAt);
			if (chunk.done) break;
			const value = chunk.value;
			total += value.byteLength;
			if (total > maxBytes) {
				await cancelReader(reader);
				throw new PrivateTransportError("response-too-large", "The private response exceeded the byte limit");
			}
			chunks.push(value);
		}
	} catch (error) {
		if (error instanceof PrivateTransportError) throw error;
		if (isAborted(options.signal)) throw cancelledError();
		throw new PrivateTransportError("offline", "The private response body could not be read");
	} finally {
		reader.releaseLock();
	}
	const output = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}
async function readPrivateText(response, options = {}) {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(await readPrivateBytes(response, options));
	} catch (error) {
		if (error instanceof PrivateTransportError) throw error;
		throw new PrivateTransportError("invalid-response", "The private response was not valid UTF-8");
	}
}
/** Parse SSE/JSON responses without retaining unbounded provider frames. */
async function* iteratePrivateSse(response, options = {}) {
	const maxBytes = boundedBytes(options.maxBytes, DEFAULT_PRIVATE_RESPONSE_BYTES);
	const maxFrameBytes = boundedBytes(options.maxFrameBytes, DEFAULT_PRIVATE_FRAME_BYTES);
	if (response.body === null) {
		const text = await readPrivateText(response, options);
		if (text.trim().length > 0) yield { data: text.trim() };
		return;
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let buffer = "";
	let eventName;
	let dataLines = [];
	let bytes = 0;
	let frameBytes = 0;
	let sawSseFrame = false;
	let plainText = "";
	const startedAt = Date.now();
	const flush = () => {
		if (dataLines.length === 0) {
			eventName = void 0;
			frameBytes = 0;
			return;
		}
		const data = dataLines.join("\n");
		const event = eventName;
		dataLines = [];
		eventName = void 0;
		frameBytes = 0;
		sawSseFrame = true;
		plainText = "";
		return event === void 0 ? { data } : {
			data,
			event
		};
	};
	try {
		for (;;) {
			const chunk = await readChunk(reader, options, startedAt);
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > maxBytes) throw new PrivateTransportError("response-too-large", "The private response exceeded the byte limit");
			let decoded;
			try {
				decoded = decoder.decode(chunk.value, { stream: true });
			} catch {
				throw new PrivateTransportError("invalid-response", "The private response was not valid UTF-8");
			}
			if (!sawSseFrame) plainText += decoded;
			buffer += decoded;
			for (;;) {
				const newline = buffer.indexOf("\n");
				if (newline < 0) break;
				let line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				if (line.endsWith("\r")) line = line.slice(0, -1);
				if (utf8Bytes(line) > maxFrameBytes) throw new PrivateTransportError("frame-too-large", "The private response frame exceeded the byte limit");
				if (line.length === 0) {
					const event = flush();
					if (event !== void 0) yield event;
					continue;
				}
				if (line.startsWith(":")) continue;
				frameBytes += utf8Bytes(line) + 1;
				if (frameBytes > maxFrameBytes) throw new PrivateTransportError("frame-too-large", "The private response frame exceeded the byte limit");
				if (line.startsWith("event:")) eventName = line.slice(6).trim() || void 0;
				else if (line.startsWith("data:")) {
					const value = line.slice(5).replace(/^ /u, "");
					dataLines.push(value);
				}
			}
		}
		let tail;
		try {
			tail = decoder.decode();
		} catch {
			throw new PrivateTransportError("invalid-response", "The private response was not valid UTF-8");
		}
		if (!sawSseFrame) plainText += tail;
		buffer += tail;
		if (buffer.length > 0) {
			frameBytes += utf8Bytes(buffer);
			if (frameBytes > maxFrameBytes) throw new PrivateTransportError("frame-too-large", "The private response frame exceeded the byte limit");
			if (buffer.startsWith("data:")) dataLines.push(buffer.slice(5).replace(/^ /u, ""));
		}
		const event = flush();
		if (event !== void 0) yield event;
		if (!sawSseFrame && plainText.trim().length > 0) yield { data: plainText.trim() };
	} catch (error) {
		if (error instanceof PrivateTransportError) throw error;
		if (isAborted(options.signal)) throw cancelledError();
		throw new PrivateTransportError("offline", "The private response stream could not be read");
	} finally {
		await cancelReader(reader);
		reader.releaseLock();
	}
}
function assertPrivateEndpoint(url) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		throw new PrivateTransportError("protocol-drift", "The private endpoint URL is invalid");
	}
	if (parsed.origin !== ANTIGRAVITY_WIRE_ORIGIN || parsed.protocol !== "https:" || parsed.search || parsed.hash) throw new PrivateTransportError("protocol-drift", "The private endpoint URL is not allowlisted");
}
async function readChunk(reader, options, startedAt) {
	if (isAborted(options.signal)) {
		await cancelReader(reader);
		throw cancelledError();
	}
	const totalTimeout = boundedTimeout(options.totalTimeoutMs, DEFAULT_PRIVATE_TOTAL_TIMEOUT_MS);
	const elapsed = Date.now() - startedAt;
	if (elapsed >= totalTimeout) {
		await cancelReader(reader);
		throw new PrivateTransportError("timeout", "The private response exceeded the total timeout");
	}
	const idleTimeout = boundedTimeout(options.idleTimeoutMs, DEFAULT_PRIVATE_IDLE_TIMEOUT_MS);
	let timer;
	let removeAbort;
	const abort = new Promise((_, reject) => {
		const onAbort = () => reject(cancelledError());
		removeAbort = () => options.signal?.removeEventListener("abort", onAbort);
		if (options.signal === void 0) return;
		if (options.signal.aborted) onAbort();
		else options.signal.addEventListener("abort", onAbort, { once: true });
	});
	const idle = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new PrivateTransportError("timeout", "The private response stream stalled")), idleTimeout);
	});
	let totalHandle;
	const remaining = totalTimeout - elapsed;
	const total = new Promise((_, reject) => {
		totalHandle = setTimeout(() => reject(new PrivateTransportError("timeout", "The private response exceeded the total timeout")), remaining);
	});
	try {
		return await Promise.race([
			reader.read(),
			abort,
			idle,
			total
		]);
	} catch (error) {
		await cancelReader(reader);
		throw error;
	} finally {
		if (timer !== void 0) clearTimeout(timer);
		if (totalHandle !== void 0) clearTimeout(totalHandle);
		removeAbort?.();
	}
}
function utf8Bytes(value) {
	return Buffer.byteLength(value, "utf8");
}
function isAborted(signal) {
	return signal !== void 0 && signal.aborted;
}
async function cancelReader(reader) {
	try {
		await reader.cancel();
	} catch {}
}
function cancelledError(accepted = true) {
	return new PrivateTransportError("cancelled", "The private request was cancelled", { accepted });
}
function boundedTimeout(value, fallback) {
	return value === void 0 || !Number.isFinite(value) || value <= 0 ? fallback : Math.min(Math.floor(value), 6e5);
}
function boundedRequestBytes(value) {
	return value === void 0 || !Number.isFinite(value) || value <= 0 ? DEFAULT_PRIVATE_REQUEST_BYTES : Math.min(Math.floor(value), MAX_PRIVATE_REQUEST_BYTES);
}
function boundedBytes(value, fallback) {
	return value === void 0 || !Number.isFinite(value) || value <= 0 ? fallback : Math.min(Math.floor(value), fallback);
}
//#endregion
export { DEFAULT_PRIVATE_RESPONSE_HEADER_TIMEOUT_MS as a, assertPrivateEndpoint as c, privateStatusError as d, readPrivateBytes as f, PrivateTransportError as g, setExplicitProxy as h, DEFAULT_PRIVATE_RESPONSE_BYTES as i, createPrivateTransport as l, scopedHttpsFetch as m, DEFAULT_PRIVATE_IDLE_TIMEOUT_MS as n, DEFAULT_PRIVATE_TOTAL_TIMEOUT_MS as o, readPrivateText as p, DEFAULT_PRIVATE_REQUEST_BYTES as r, MAX_PRIVATE_REQUEST_BYTES as s, DEFAULT_PRIVATE_FRAME_BYTES as t, iteratePrivateSse as u };
