import { a as DEFAULT_PRIVATE_RESPONSE_HEADER_TIMEOUT_MS, d as privateStatusError, g as PrivateTransportError, i as DEFAULT_PRIVATE_RESPONSE_BYTES, l as createPrivateTransport, n as DEFAULT_PRIVATE_IDLE_TIMEOUT_MS, o as DEFAULT_PRIVATE_TOTAL_TIMEOUT_MS, p as readPrivateText, r as DEFAULT_PRIVATE_REQUEST_BYTES, t as DEFAULT_PRIVATE_FRAME_BYTES, u as iteratePrivateSse } from "./private-transport-DUrd-Qg2.js";
import { ANTIGRAVITY_WIRE_ORIGIN } from "./wire-identity.js";
import { t as classifyPrivateFailure } from "./private-failure-DHq0eeVP.js";
import { antigravityModelFamily, buildFunctionDeclarations, compatibleReplayState, createReplayState, sanitizeSchema } from "./replay.js";
import { AgyRequestSessionStore, CLAUDE_DESCRIPTION_PROMPT, CLAUDE_TOOL_SYSTEM_INSTRUCTION, SKIP_THOUGHT_SIGNATURE, applyAgyNativeGenerationConfig, applyClaudeTransforms, applyGeminiTransforms, buildAgyAgentRequestMetadata, fnv1a64Signed, getAgyNativeModel, getPublicModelDefinitions, getResolverAliasMap, isGeminiArgonModel, orderAgyRequestPayloadInPlace, resolveModelWithTier, toGeminiSchema } from "@cortexkit/antigravity-auth-core";
import { Buffer } from "node:buffer";
import * as dshLlm from "@deepseek-ai/dsh-llm";
import { CONTEXT_WINDOW_EXCEEDED_CODE, LlmAdapter, LlmError, ReasoningEffortId, ToolCallId, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { requestImageDimensions } from "@deepseek-ai/dsh-attachment";
//#region src/llm-adapter.ts
/** Public DSH LLM adapter for the single Antigravity provider route. */
const ANTIGRAVITY_PROVIDER = "google-antigravity";
const ANTIGRAVITY_REQUEST_IMAGE_MAX_PIXELS = 4194304;
const ANTIGRAVITY_REQUEST_IMAGE_MAX_BYTES = 1048576;
/** Inline image budget for the private route: base64 bytes the transport tolerates for images alone. */
const ANTIGRAVITY_INLINE_IMAGE_BYTES = 12582912;
const ANTIGRAVITY_STREAM_ENDPOINT = `${ANTIGRAVITY_WIRE_ORIGIN}/v1internal:streamGenerateContent?alt=sse`;
const ANTIGRAVITY_GENERATE_ENDPOINT = `${ANTIGRAVITY_WIRE_ORIGIN}/v1internal:generateContent`;
const ANTIGRAVITY_AVAILABLE_MODELS_ENDPOINT = `${ANTIGRAVITY_WIRE_ORIGIN}/v1internal:fetchAvailableModels`;
const ANTIGRAVITY_LLM_ROUTE = ANTIGRAVITY_PROVIDER;
const MODEL_CATALOG_TTL_MS = 3e4;
const MAX_MODEL_CATALOG_BYTES = 262144;
const MAX_PROVIDER_ERROR_BYTES = 65536;
const MAX_PROVIDER_ERROR_FRAME_BYTES = 16384;
const MAX_PROVIDER_ERROR_JSON_DEPTH = 8;
const MAX_PROVIDER_PARTS = 4096;
/** Adapter that owns exactly one provider route and no fallback route. */
var AntigravityAdapter = class extends LlmAdapter {
	adapterOptions;
	transport;
	sessions = new AgyRequestSessionStore("dsh-antigravity-auth");
	options;
	definitions = getPublicModelDefinitions();
	catalogProjectId;
	catalogExpiresAt = 0;
	catalogModelIds = /* @__PURE__ */ new Set();
	catalogFailureCode;
	catalogView;
	constructor(adapterOptions) {
		super();
		this.adapterOptions = adapterOptions;
		this.transport = adapterOptions.transport ?? createPrivateTransport(adapterOptions.responseHeaderTimeoutMs === void 0 ? {} : { responseHeaderTimeoutMs: adapterOptions.responseHeaderTimeoutMs });
		this.options = {
			responseHeaderTimeoutMs: boundedTimeout(adapterOptions.responseHeaderTimeoutMs, DEFAULT_PRIVATE_RESPONSE_HEADER_TIMEOUT_MS),
			idleTimeoutMs: boundedTimeout(adapterOptions.idleTimeoutMs, DEFAULT_PRIVATE_IDLE_TIMEOUT_MS),
			totalTimeoutMs: boundedTimeout(adapterOptions.totalTimeoutMs, DEFAULT_PRIVATE_TOTAL_TIMEOUT_MS),
			maxResponseBytes: boundedLimit(adapterOptions.maxResponseBytes, DEFAULT_PRIVATE_RESPONSE_BYTES),
			maxFrameBytes: boundedLimit(adapterOptions.maxFrameBytes, DEFAULT_PRIVATE_FRAME_BYTES)
		};
		this.catalogView = createCatalogView(this.definitions, "snapshot");
	}
	providerInfo(provider) {
		if (provider !== "google-antigravity") throw new LlmError("Unknown Antigravity provider route", "NO_ADAPTER");
		return {
			id: ANTIGRAVITY_PROVIDER,
			name: "Google Antigravity"
		};
	}
	providerRetryPolicy() {
		return resolveRetryPolicy({
			mode: "normal",
			maxRetries: 2,
			retryableCodes: [
				"EMPTY_RESPONSE",
				"TIMEOUT",
				"TRANSPORT",
				"UPSTREAM"
			],
			backoff: {
				initialDelayMs: 1e3,
				maxDelayMs: 5e3,
				jitterRatio: .1
			}
		}, "google-antigravity");
	}
	/** Forget account-bound availability when Gate 0 or the credential is replaced. */
	invalidateModelCatalog() {
		this.catalogProjectId = void 0;
		this.catalogExpiresAt = 0;
		this.catalogModelIds = /* @__PURE__ */ new Set();
		this.catalogFailureCode = void 0;
		this.catalogView = createCatalogView(this.definitions, "snapshot");
	}
	/** Return the pinned catalog without performing credential or network work. */
	catalogSnapshot() {
		return cloneCatalogView(createCatalogView(this.definitions, "snapshot"));
	}
	/** Refresh the advisory catalog and collapse failures into browser-safe state. */
	async modelCatalog(signal, forceRefresh = false) {
		try {
			const available = await this.readLiveModelIds(signal, forceRefresh);
			this.catalogView = createCatalogView(this.definitions, "live-available", available, (/* @__PURE__ */ new Date()).toISOString());
		} catch (error) {
			const state = error instanceof LlmError && error.code === "PROTOCOL_DRIFT" ? "protocol-drift" : "refresh-failed";
			this.catalogView = createCatalogView(this.definitions, state, void 0, (/* @__PURE__ */ new Date()).toISOString());
		}
		return cloneCatalogView(this.catalogView);
	}
	async listModels(provider, signal) {
		this.providerInfo(provider);
		const snapshot = this.pinnedTextModelInfos();
		let available;
		try {
			available = await this.readLiveModelIds(signal);
			this.catalogView = createCatalogView(this.definitions, "live-available", available, (/* @__PURE__ */ new Date()).toISOString());
		} catch (error) {
			const state = error instanceof LlmError && error.code === "PROTOCOL_DRIFT" ? "protocol-drift" : "refresh-failed";
			this.catalogView = createCatalogView(this.definitions, state, void 0, (/* @__PURE__ */ new Date()).toISOString());
			if (!canFallBackToPinnedTextSnapshot(error)) throw error;
			return snapshot;
		}
		return snapshot.filter((model) => available.has(model.id));
	}
	pinnedTextModelInfos() {
		return Object.values(this.definitions).filter((definition) => !definition.modalities.output.includes("image")).map((definition) => ({
			provider: ANTIGRAVITY_PROVIDER,
			id: definition.id,
			name: cleanModelDisplayName(definition.name),
			inputModalities: definition.modalities.input.filter((item) => item === "text" || item === "image")
		}));
	}
	async resolveModel(provider, model, _signal) {
		this.providerInfo(provider);
		if (typeof model !== "string" || model.trim().length === 0 || model.length > 256) throw new LlmError("The Antigravity model id is invalid", "INVALID_MODEL");
		const definition = this.definitions[model];
		if (definition === void 0 || definition.modalities.output.includes("image")) throw new LlmError("The Antigravity model is not in the audited text model snapshot", "INVALID_MODEL");
		const reasoning = getModelReasoningEfforts(model);
		return {
			provider: ANTIGRAVITY_PROVIDER,
			id: definition.id,
			name: cleanModelDisplayName(definition.name),
			inputModalities: definition.modalities.input.filter((item) => item === "text" || item === "image"),
			context: { contextWindow: definition.limit.context },
			defaultMaxTokens: definition.limit.output,
			...reasoning === void 0 ? {} : { reasoning }
		};
	}
	async *stream(options) {
		if (options.provider !== "google-antigravity") throw new LlmError("The Antigravity adapter received an unknown provider route", "NO_ADAPTER");
		const signal = options.signal;
		const requestedDefinition = this.definitions[options.model];
		if (requestedDefinition === void 0 || requestedDefinition.modalities.output.includes("image")) throw new LlmError("The Antigravity model is not in the audited text model snapshot", "INVALID_MODEL");
		if (isAborted(signal)) {
			yield finishChunk("aborted", "CANCELLED");
			return;
		}
		const family = antigravityModelFamily(options.model);
		const hasEmitted = { value: false };
		let replayed = false;
		let networkRetryCount = 0;
		const MAX_NETWORK_RETRIES = 3;
		let rotationAttempts = 0;
		const maxRotations = await this.rotationBudget();
		for (;;) {
			const credential = await this.readCredential(signal, replayed, family);
			if (credential === void 0) throw new LlmError("Antigravity login is required before model use", "AUTH");
			const sessionKey = requestSessionKey(options);
			const requestScope = this.sessions.beginRequest(sessionKey);
			let payload;
			try {
				payload = await buildAntigravityGeneratePayloadForAdapter(options, credential, requestScope.session, requestScope.timestamp, this.adapterOptions.attachments, this.adapterOptions.fs);
			} catch (error) {
				if (error instanceof LlmError) throw error;
				throw new LlmError("The Antigravity image input could not be admitted safely", "UNSUPPORTED_MODALITY");
			}
			const sentImageBytes = payload.sentImageBytes;
			delete payload.sentImageBytes;
			const serialized = JSON.stringify(payload);
			/** Images alone exceed the private route's inline image budget: negotiate a logged offload. */
			const imageOffload = antigravityImageOffloadCount(options.messages, sentImageBytes);
			if (imageOffload > 0) throw new LlmError(`The Antigravity image payload exceeds the route image budget; offload ${String(imageOffload)} oldest retained image occurrence(s)`, IMAGE_OFFLOAD_REQUIRED_CODE, { offloadImages: imageOffload });
			/** Whole request exceeds the transport ceiling for reasons other than images: fail without blaming them. */
			const requestBudget = boundedRequestBytes(this.adapterOptions.maxRequestBytes);
			if (new TextEncoder().encode(serialized).byteLength > requestBudget) throw new LlmError("The Antigravity request exceeds the private transport byte limit", "REQUEST_LIMIT");
			let response;
			try {
				response = await this.transport.request({
					url: ANTIGRAVITY_STREAM_ENDPOINT,
					accessToken: credential.accessToken,
					body: serialized,
					...signal === void 0 ? {} : { signal },
					responseHeaderTimeoutMs: this.options.responseHeaderTimeoutMs
				});
			} catch (error) {
				if (networkRetryCount < MAX_NETWORK_RETRIES && !hasEmitted.value && !isAborted(signal) && isRetryableNetworkError(error)) {
					networkRetryCount += 1;
					await waitRetryBackoff(Math.min(1e3 * Math.pow(2, networkRetryCount - 1), 4e3), signal);
					continue;
				}
				throw toLlmError(error);
			}
			const statusError = privateStatusError(response.status);
			if (statusError !== void 0) {
				if (statusError.code === "authentication" && !replayed && !hasEmitted.value && !isAborted(signal)) {
					await cancelResponse(response);
					replayed = true;
					continue;
				}
				if (statusError.code === "rate-limited" && !hasEmitted.value && !isAborted(signal) && rotationAttempts < maxRotations) {
					await cancelResponse(response);
					if (await this.tryRotate(family, response.status, "rate-limited")) {
						rotationAttempts += 1;
						continue;
					}
				}
				if ((response.status === 502 || response.status === 503 || response.status === 504) && networkRetryCount < MAX_NETWORK_RETRIES && !hasEmitted.value && !isAborted(signal)) {
					await cancelResponse(response);
					networkRetryCount += 1;
					await waitRetryBackoff(Math.min(1e3 * Math.pow(2, networkRetryCount - 1), 4e3), signal);
					continue;
				}
				if (response.status === 400 && await responseReportsContextWindowExceeded(response, {
					...signal === void 0 ? {} : { signal },
					idleTimeoutMs: this.options.idleTimeoutMs,
					totalTimeoutMs: this.options.totalTimeoutMs,
					maxResponseBytes: this.options.maxResponseBytes,
					maxFrameBytes: this.options.maxFrameBytes
				})) throw contextWindowExceededError(response.status);
				await cancelResponse(response);
				throw toLlmError(statusError);
			}
			try {
				yield* this.streamResponse(response, options, hasEmitted);
				this.sessions.completeExecution(sessionKey);
				return;
			} catch (error) {
				const privateError = error instanceof PrivateTransportError ? error : void 0;
				if (privateError?.code === "authentication" && !replayed && !hasEmitted.value && !isAborted(signal)) {
					replayed = true;
					continue;
				}
				if (privateError?.code === "rate-limited" && !hasEmitted.value && !isAborted(signal) && rotationAttempts < maxRotations) {
					if (await this.tryRotate(family, privateError.status ?? 429, "rate-limited")) {
						rotationAttempts += 1;
						continue;
					}
				}
				if (networkRetryCount < MAX_NETWORK_RETRIES && !hasEmitted.value && !isAborted(signal) && isRetryableNetworkError(error)) {
					networkRetryCount += 1;
					await waitRetryBackoff(Math.min(1e3 * Math.pow(2, networkRetryCount - 1), 4e3), signal);
					continue;
				}
				throw toLlmError(error);
			}
		}
	}
	async *streamResponse(response, options, hasEmitted) {
		const states = [];
		let current;
		let usage;
		let finish;
		let eventError;
		for await (const sse of iteratePrivateSse(response, {
			...options.signal === void 0 ? {} : { signal: options.signal },
			idleTimeoutMs: this.options.idleTimeoutMs,
			totalTimeoutMs: this.options.totalTimeoutMs,
			maxBytes: this.options.maxResponseBytes,
			maxFrameBytes: this.options.maxFrameBytes
		})) {
			if (sse.data.trim() === "[DONE]") continue;
			let event;
			try {
				event = parseProviderEvent(sse.data);
			} catch (error) {
				if (hasEmitted.value && error instanceof PrivateTransportError && error.code === "invalid-response") throw new PrivateTransportError("offline", "The private SSE response stream ended with a truncated frame");
				throw error;
			}
			if (event.error !== void 0) {
				eventError = event.error;
				if (event.error.status === 401 || isAuthenticationCode(event.error.code)) throw new PrivateTransportError("authentication", "The private endpoint requires authentication", { status: event.error.status ?? 401 });
				break;
			}
			if (event.usage !== void 0) usage = event.usage;
			if (event.finish !== void 0) finish = event.finish;
			for (const part of event.parts) {
				if (current === void 0 || !sameBlock(current, part)) {
					if (current !== void 0) yield endBlock(current);
					current = beginBlock(states, part);
					yield {
						type: "block-start",
						index: current.index,
						blockType: current.kind
					};
				}
				if (part.kind === "tool-call") {
					if (part.name !== void 0) current.name = assembleFunctionName(current.name, part.name);
					current.text += part.arguments;
					hasEmitted.value ||= part.arguments.length > 0 || part.name !== void 0;
					yield {
						type: "tool-call-delta",
						index: current.index,
						id: current.id,
						...part.name === void 0 ? {} : { name: part.name },
						argumentsDelta: part.arguments
					};
					if (part.signature !== void 0) current.signature = part.signature;
				} else if (part.kind === "reasoning") {
					current.text += part.text;
					hasEmitted.value ||= part.text.length > 0;
					if (part.text.length > 0) yield {
						type: "reasoning-delta",
						index: current.index,
						text: part.text
					};
				} else {
					current.text += part.text;
					hasEmitted.value ||= part.text.length > 0;
					if (part.text.length > 0) yield {
						type: "text-delta",
						index: current.index,
						text: part.text
					};
				}
			}
		}
		if (current !== void 0) yield endBlock(current);
		if (usage !== void 0) yield {
			type: "usage",
			usage
		};
		if (eventError !== void 0) {
			yield finishChunk("error", eventError.contextWindowExceeded === true ? CONTEXT_WINDOW_EXCEEDED_CODE : safeProviderErrorCode(eventError.code), safeProviderStatus(eventError.status));
			return;
		}
		if (isAborted(options.signal)) {
			yield finishChunk("aborted", "CANCELLED");
			return;
		}
		if (states.length === 0) {
			yield finishChunk("error", "EMPTY_RESPONSE");
			return;
		}
		const replayBlocks = states.map((state) => ({
			kind: state.kind,
			...state.signature === void 0 ? {} : { signature: state.signature }
		}));
		const replayState = createReplayState(options.model, antigravityModelFamily(options.model), finish, replayBlocks);
		yield finishChunk(mapFinishReason(finish), finish ?? "STOP", void 0, replayState);
	}
	async readLiveModelIds(signal, bypassCache = false, forceCredentialRefresh = false) {
		const credential = await this.readCredential(signal, forceCredentialRefresh);
		if (credential === void 0) throw new LlmError("Antigravity login is required before model discovery", "AUTH");
		if (!bypassCache && this.catalogProjectId === credential.projectId && Date.now() < this.catalogExpiresAt) {
			if (this.catalogFailureCode !== void 0) throw new LlmError("The Antigravity live model catalog refresh remains unavailable", this.catalogFailureCode);
			return this.catalogModelIds;
		}
		let response;
		const body = credential.projectId ? { project: credential.projectId } : {};
		try {
			response = await this.transport.request({
				url: ANTIGRAVITY_AVAILABLE_MODELS_ENDPOINT,
				accessToken: credential.accessToken,
				body: JSON.stringify(body),
				...signal === void 0 ? {} : { signal },
				responseHeaderTimeoutMs: this.options.responseHeaderTimeoutMs
			});
		} catch (error) {
			const failure = toModelCatalogError(error, signal, "provider");
			this.rememberCatalogFailure(credential.projectId, failure);
			throw failure;
		}
		if (response.status === 403 && credential.projectId) try {
			const retryResponse = await this.transport.request({
				url: ANTIGRAVITY_AVAILABLE_MODELS_ENDPOINT,
				accessToken: credential.accessToken,
				body: JSON.stringify({}),
				...signal === void 0 ? {} : { signal },
				responseHeaderTimeoutMs: this.options.responseHeaderTimeoutMs
			});
			if (retryResponse.ok) {
				await cancelResponse(response);
				response = retryResponse;
			} else await cancelResponse(retryResponse);
		} catch (error) {
			const failure = toModelCatalogError(error, signal, "provider");
			if (failure.code === "CANCELLED" || failure.code === "GATE_0_ATTRIBUTION") {
				await cancelResponse(response);
				this.rememberCatalogFailure(credential.projectId, failure);
				throw failure;
			}
		}
		const statusError = privateStatusError(response.status);
		if (statusError !== void 0) {
			await cancelResponse(response);
			if (statusError.code === "authentication" && !forceCredentialRefresh && !isAborted(signal)) {
				this.catalogExpiresAt = 0;
				return this.readLiveModelIds(signal, true, true);
			}
			const failure = toLlmError(statusError);
			this.rememberCatalogFailure(credential.projectId, failure);
			throw failure;
		}
		let value;
		try {
			value = JSON.parse(await readPrivateText(response, {
				...signal === void 0 ? {} : { signal },
				idleTimeoutMs: this.options.idleTimeoutMs,
				totalTimeoutMs: this.options.totalTimeoutMs,
				maxBytes: Math.min(this.options.maxResponseBytes, MAX_MODEL_CATALOG_BYTES)
			}));
		} catch (error) {
			const failure = toModelCatalogError(error, signal, "protocol");
			this.rememberCatalogFailure(credential.projectId, failure);
			throw failure;
		}
		let ids;
		try {
			ids = parseLiveModelIds(value, this.definitions);
		} catch (error) {
			const failure = error instanceof LlmError ? error : new LlmError("The Antigravity live model catalog did not match the audited schema", "PROTOCOL_DRIFT");
			this.rememberCatalogFailure(credential.projectId, failure);
			throw failure;
		}
		this.catalogProjectId = credential.projectId;
		this.catalogModelIds = ids;
		this.catalogFailureCode = void 0;
		this.catalogExpiresAt = Date.now() + MODEL_CATALOG_TTL_MS;
		return ids;
	}
	rememberCatalogFailure(projectId, failure) {
		if (failure.code === "AUTH" || failure.code === "CANCELLED") return;
		this.catalogProjectId = projectId;
		this.catalogModelIds = /* @__PURE__ */ new Set();
		this.catalogFailureCode = failure.code;
		this.catalogExpiresAt = Date.now() + MODEL_CATALOG_TTL_MS;
	}
	async readCredential(signal, forceRefresh, family) {
		try {
			return await this.adapterOptions.auth.credential(signal, {
				...forceRefresh ? { forceRefresh: true } : {},
				...family !== void 0 ? { family } : {}
			});
		} catch (error) {
			throw toLlmError(error);
		}
	}
	async rotationBudget() {
		const auth = this.adapterOptions.auth;
		if (typeof auth.accountCount !== "function") return 1;
		try {
			const count = await auth.accountCount();
			return Math.max(1, count);
		} catch {
			return 1;
		}
	}
	async tryRotate(family, status = 429, message = "rate-limited") {
		const auth = this.adapterOptions.auth;
		if (typeof auth.rotateOnFailure !== "function") return false;
		try {
			if (await auth.rotateOnFailure({
				status,
				family,
				message
			}) === "rotate") {
				this.invalidateModelCatalog();
				return true;
			}
		} catch {
			return false;
		}
		return false;
	}
};
function cleanModelDisplayName(name) {
	return name.replace(/\s*\([^)]*\)\s*$/u, "").trim();
}
function getModelReasoningEfforts(modelId) {
	const lower = modelId.toLowerCase();
	if (lower.includes("gemini-4-argon") || lower.includes("flash") && !lower.includes("image")) return {
		efforts: [
			{
				id: ReasoningEffortId("low"),
				name: "Low"
			},
			{
				id: ReasoningEffortId("medium"),
				name: "Medium"
			},
			{
				id: ReasoningEffortId("high"),
				name: "High"
			}
		],
		defaultEffort: ReasoningEffortId(lower.includes("gemini-4-argon") || lower.includes("gemini-3.8-flash") ? "medium" : "high")
	};

}
function createCatalogView(definitions, state, available, checkedAt) {
	return {
		state,
		models: Object.values(definitions).filter((definition) => !definition.modalities.output.includes("image")).map((definition) => ({
			id: definition.id,
			name: cleanModelDisplayName(definition.name),
			state: state === "live-available" ? available?.has(definition.id) === true ? "live-available" : "unavailable" : "snapshot"
		})),
		...checkedAt === void 0 ? {} : { checkedAt }
	};
}
function cloneCatalogView(value) {
	return {
		state: value.state,
		models: value.models.map((model) => ({ ...model })),
		...value.checkedAt === void 0 ? {} : { checkedAt: value.checkedAt }
	};
}
function parseLiveModelIds(value, definitions) {
	const root = isRecord(value) && isRecord(value.response) ? value.response : value;
	if (!isRecord(root) || !isRecord(root.models)) throw new LlmError("The Antigravity live model catalog did not match the audited schema", "PROTOCOL_DRIFT");
	const entries = Object.entries(root.models);
	if (entries.length > 512) throw new LlmError("The Antigravity live model catalog exceeded the model limit", "PROTOCOL_DRIFT");
	const aliases = getResolverAliasMap();
	const live = /* @__PURE__ */ new Set();
	for (const [id, rawEntry] of entries) {
		if (!safeModelId(id) || !isRecord(rawEntry)) throw new LlmError("The Antigravity live model catalog did not match the audited schema", "PROTOCOL_DRIFT");
		const cleanId = cleanModelId(id);
		live.add(canonicalWireModel(cleanId, aliases));
		live.add(cleanId);
		live.add(id);
		if (cleanId === "gemini-3-flash" || cleanId === "gemini-3-flash-agent" || cleanId.startsWith("gemini-3-flash") || cleanId.startsWith("gemini-3.5-flash")) {
			live.add("gemini-3.5-flash");
			live.add("gemini-3-flash-agent");
			live.add("gemini-3.5-flash-low");
			live.add("gemini-3.5-flash-extra-low");
		}
		if (cleanId === "gemini-3.8-flash-tiered" || cleanId.startsWith("gemini-3.8-flash")) {
			live.add("gemini-3.8-flash");
			live.add("gemini-3.8-flash-medium");
			live.add("gemini-3.8-flash-low");
			live.add("gemini-3.8-flash-high");
		}
		if (cleanId.startsWith("gemini-4-argon")) {
			live.add("gemini-4-argon");
			live.add("gemini-4-argon-low");
			live.add("gemini-4-argon-medium");
			live.add("gemini-4-argon-high");
		}
		if (cleanId.startsWith("claude-sonnet-5-5")) {
			live.add("claude-sonnet-5-5");
			live.add("claude-sonnet-5-5-low");
			live.add("claude-sonnet-5-5-medium");
			live.add("claude-sonnet-5-5-high");
		}
		if (cleanId.startsWith("claude-opus-5-5")) {
			live.add("claude-opus-5-5");
			live.add("claude-opus-5-5-low");
			live.add("claude-opus-5-5-medium");
			live.add("claude-opus-5-5-high");
		}
		if (rawEntry.modelName !== void 0 && typeof rawEntry.modelName === "string") {
			if (!safeModelId(rawEntry.modelName)) throw new LlmError("The Antigravity live model catalog did not match the audited schema", "PROTOCOL_DRIFT");
			const cleanName = cleanModelId(rawEntry.modelName);
			live.add(canonicalWireModel(cleanName, aliases));
			live.add(cleanName);
		}
		if (rawEntry.displayName !== void 0 && (typeof rawEntry.displayName !== "string" || rawEntry.displayName.length > 512 || containsControl(rawEntry.displayName))) throw new LlmError("The Antigravity live model catalog did not match the audited schema", "PROTOCOL_DRIFT");
	}
	const available = /* @__PURE__ */ new Set();
	for (const definition of Object.values(definitions)) {
		const resolved = resolveModelWithTier(definition.id).actualModel;
		const cleanResolved = cleanModelId(resolved);
		const canonical = canonicalWireModel(cleanResolved, aliases);
		if (live.has(canonical) || live.has(cleanResolved) || live.has(resolved) || live.has(definition.id) || definition.id === "antigravity-gemini-3.5-flash" && (live.has("gemini-3-flash") || live.has("gemini-3-flash-agent") || live.has("gemini-3.5-flash") || live.has("gemini-3.5-flash-low") || live.has("gemini-3.5-flash-extra-low"))) available.add(definition.id);
	}
	return available;
}
function cleanModelId(value) {
	return value.replace(/^(?:publishers\/[^/]+\/)?models\//, "");
}
function canonicalWireModel(value, aliases) {
	return aliases[value] ?? value;
}
function safeModelId(value) {
	return typeof value === "string" && value.length > 0 && value.length <= 256 && !containsControl(value);
}
function containsControl(value) {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code < 32 || code === 127) return true;
	}
	return false;
}
function beginBlock(states, part) {
	const index = states.length;
	const block = part.kind === "tool-call" ? {
		index,
		kind: "tool-call",
		id: ToolCallId(part.id ?? `antigravity-call-${String(index)}`),
		...part.name === void 0 ? {} : { name: part.name },
		text: "",
		...part.signature === void 0 ? {} : { signature: part.signature }
	} : {
		index,
		kind: part.kind,
		id: ToolCallId(`antigravity-block-${String(index)}`),
		text: "",
		...part.signature === void 0 ? {} : { signature: part.signature }
	};
	states.push(block);
	return block;
}
function sameBlock(state, part) {
	if (state.kind !== part.kind) return false;
	return part.kind !== "tool-call" || part.id === void 0 || part.id === String(state.id);
}
function assembleFunctionName(current, fragment) {
	if (fragment.length === 0 || fragment.length > 256 || containsControl(fragment)) throw new PrivateTransportError("protocol-drift", "The private tool-call name was invalid");
	if (current === void 0 || current.length === 0) return fragment;
	if (fragment === current) return current;
	if (fragment.startsWith(current)) return fragment;
	const combined = `${current}${fragment}`;
	if (combined.length > 256) throw new PrivateTransportError("protocol-drift", "The private tool-call name exceeded the byte limit");
	return combined;
}
function tryRepairJson(raw) {
	if (typeof raw !== "string") return void 0;
	let text = raw.trim();
	if (text.length === 0) return {};
	try {
		const parsed = JSON.parse(text);
		if (isRecord(parsed)) return parsed;
	} catch {}
	let repaired = text.replace(/,\s*([}\]])/g, "$1");
	repaired = repaired.replace(/(?<!\\)\\(?!["\\/bfnrtu]|u[0-9a-fA-F]{4})/g, "\\\\");
	let inString = false;
	let isEscaped = false;
	const openBrackets = [];
	let sanitized = "";
	for (let i = 0; i < repaired.length; i++) {
		const ch = repaired[i];
		if (isEscaped) {
			isEscaped = false;
			sanitized += ch;
			continue;
		}
		if (ch === "\\") {
			isEscaped = true;
			sanitized += ch;
			continue;
		}
		if (ch === '"') {
			inString = !inString;
			sanitized += ch;
			continue;
		}
		if (inString) {
			if (ch === "\n") sanitized += "\\n";
			else if (ch === "\r") sanitized += "\\r";
			else if (ch === "\t") sanitized += "\\t";
			else sanitized += ch;
			continue;
		}
		sanitized += ch;
		if (ch === "{" || ch === "[") openBrackets.push(ch);
		else if (ch === "}") {
			if (openBrackets.length > 0 && openBrackets[openBrackets.length - 1] === "{") openBrackets.pop();
		} else if (ch === "]") {
			if (openBrackets.length > 0 && openBrackets[openBrackets.length - 1] === "[") openBrackets.pop();
		}
	}
	repaired = sanitized;
	if (inString) {
		const trailingSlashes = repaired.match(/\\+$/)?.[0]?.length ?? 0;
		if (trailingSlashes % 2 === 1) {
			repaired = repaired.slice(0, -1);
		}
		repaired += '"';
	}
	while (openBrackets.length > 0) {
		const bracket = openBrackets.pop();
		if (bracket === "{") repaired += "}";
		else if (bracket === "[") repaired += "]";
	}
	try {
		const parsed = JSON.parse(repaired);
		if (isRecord(parsed)) return parsed;
	} catch {}
	return void 0;
}
function endBlock(state) {
	if (state.kind === "text") return {
		type: "block-end",
		index: state.index,
		block: {
			type: "text",
			text: state.text
		}
	};
	if (state.kind === "reasoning") return {
		type: "block-end",
		index: state.index,
		block: {
			type: "reasoning",
			text: state.text
		}
	};
	let parsed;
	try {
		parsed = JSON.parse(state.text);
	} catch {
		parsed = tryRepairJson(state.text);
		if (parsed !== void 0) {
			state.text = JSON.stringify(parsed);
		} else {
			parsed = {};
			state.text = "{}";
		}
	}
	if (!isRecord(parsed)) {
		parsed = {};
		state.text = "{}";
	}
	const args = state.text;
	if (state.name === void 0 || !/^[A-Za-z_][A-Za-z0-9_.:-]{0,255}$/u.test(state.name)) throw new PrivateTransportError("protocol-drift", "The private tool-call name was missing or invalid");
	return {
		type: "block-end",
		index: state.index,
		block: {
			type: "tool-call",
			id: state.id,
			name: state.name,
			arguments: args
		}
	};
}
/**
* Build the model-facing functionResponse payload.
* Gemini's FunctionResponse.response is a free-form Struct with no dedicated error
* field, so a failed tool result is reported under `error` and a successful one
* under `content`; both remain readable to the model.
*/
function toolResponsePayload(content, isError) {
	return isError === true ? { error: content } : { content };
}
const IMAGE_OFFLOAD_REQUIRED_CODE = dshLlm.IMAGE_OFFLOAD_REQUIRED_CODE ?? "IMAGE_OFFLOAD_REQUIRED";
function safeProjectOffloadedImages(messages, placeholder) {
	if (typeof dshLlm.projectOffloadedImages === "function") return dshLlm.projectOffloadedImages(messages, placeholder);
	return messages.map((message) => {
		let replaced = false;
		const content = message.content.map((block) => {
			if (block.type === "image" && block.offloaded === true) {
				replaced = true;
				return {
					type: "text",
					text: placeholder(block.attachment)
				};
			}
			return block;
		});
		return replaced ? {
			...message,
			content
		} : message;
	});
}
function safeRequiredImageOffload(messages, budget, versionBytes) {
	if (typeof dshLlm.requiredImageOffload === "function") return dshLlm.requiredImageOffload(messages, budget, versionBytes);
	let totalBytes = 0;
	const imageSizes = [];
	for (const message of messages) for (const block of message.content) if (block.type === "image" && block.offloaded !== true) {
		const raw = versionBytes(block);
		const bytes = budget.representation === "base64" ? Math.ceil(raw * 4 / 3) : raw;
		totalBytes += bytes;
		imageSizes.push(bytes);
	}
	let count = 0;
	let excess = totalBytes - budget.maxBytes;
	for (const size of imageSizes) {
		if (excess <= 0) break;
		count += 1;
		excess -= size;
	}
	return count;
}
function safeOffloadedImageText(ref, access) {
	if (typeof dshLlm.offloadedImageText === "function") return dshLlm.offloadedImageText(ref, access);
	return `[image omitted to fit request image limits; ${ref.name !== void 0 ? `${JSON.stringify(ref.name)} (${ref.attachmentId})` : String(ref.attachmentId)}.]`;
}
function safeResolveImageAttachmentAccess(attachments, mapHostPath, ref) {
	if (attachments === void 0) return void 0;
	if (typeof dshLlm.resolveImageAttachmentAccess === "function") return dshLlm.resolveImageAttachmentAccess(attachments, mapHostPath, ref);
	const hostPath = attachments.imageHostPath?.(ref);
	if (hostPath === void 0) return void 0;
	const readonlyPath = mapHostPath(hostPath);
	return readonlyPath === void 0 ? void 0 : { readonlyPath };
}
function boundedRequestBytes(value) {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : DEFAULT_PRIVATE_REQUEST_BYTES;
}
/**
* Oldest-first image count the private route must offload before its image payload fits.
* Uses the Host's own image-only budget instead of blaming total request bytes on images.
*/
function antigravityImageOffloadCount(messages, sentBytes) {
	return safeRequiredImageOffload(messages, {
		representation: "base64",
		maxBytes: ANTIGRAVITY_INLINE_IMAGE_BYTES
	}, (block) => {
		const attachment = isRecord(block) && isRecord(block.attachment) ? block.attachment : void 0;
		const attachmentId = attachment && typeof attachment.attachmentId === "string" ? attachment.attachmentId : void 0;
		const sent = attachmentId === void 0 ? void 0 : sentBytes?.get(attachmentId);
		if (typeof sent === "number") return sent;
		return attachment && typeof attachment.bytes === "number" ? attachment.bytes : 0;
	});
}
/** Resolve a read-only execution-world path so an offloaded image stays recoverable by tools. */
function resolveAntigravityImageAccess(attachments, fs, ref) {
	if (attachments === void 0 || fs === void 0) return void 0;
	try {
		return safeResolveImageAttachmentAccess(attachments, (hostPath) => fs.processPathFromHostPath(hostPath), ref);
	} catch {
		return;
	}
}
function buildAntigravityGeneratePayload(options, credential, attachments, fs) {
	const toolNames = /* @__PURE__ */ new Map();
	const history = safeProjectOffloadedImages(options.messages, (ref) => safeOffloadedImageText(ref, resolveAntigravityImageAccess(attachments, fs, ref))).filter((message) => message.role !== "system");
	const assistantIndices = [];
	for (let i = 0; i < history.length; i++) {
		if (history[i].role === "assistant") assistantIndices.push(i);
	}
	const recentCutoffIndex = assistantIndices.length > 3 ? assistantIndices[assistantIndices.length - 3] : 0;
	return buildPayloadFromContents(options, credential, history.map((message, i) => mapMessage(message, options.model, toolNames, i >= recentCutoffIndex)));
}
async function buildAntigravityGeneratePayloadForAdapter(options, credential, session, timestamp, attachments, fs) {
	/** Downscaled byte length actually sent per attachment; requiredImageOffload applies base64Length itself. */
	const sentImageBytes = /* @__PURE__ */ new Map();
	const contents = [];
	const toolNames = /* @__PURE__ */ new Map();
	const history = safeProjectOffloadedImages(options.messages, (ref) => safeOffloadedImageText(ref, resolveAntigravityImageAccess(attachments, fs, ref)));
	const assistantIndices = [];
	for (let i = 0; i < history.length; i++) {
		if (history[i].role === "assistant") assistantIndices.push(i);
	}
	const recentCutoffIndex = assistantIndices.length > 3 ? assistantIndices[assistantIndices.length - 3] : 0;
	for (let i = 0; i < history.length; i++) {
		const message = history[i];
		if (message.role === "system") continue;
		const isRecentAssistant = i >= recentCutoffIndex;
		contents.push(await mapMessageWithAttachments(message, options.model, toolNames, attachments, options.signal, sentImageBytes, isRecentAssistant));
	}
	const payload = buildPayloadFromContents(options, credential, contents);
	const metadata = buildAgyAgentRequestMetadata(session, payload.request, resolveWireModel(options.model, options.reasoningEffort), timestamp);
	const request = payload.request;
	request.labels = metadata.labels;
	request.sessionId = metadata.sessionId;
	orderAgyRequestPayloadInPlace(request);
	return {
		...payload.project === void 0 ? {} : { project: payload.project },
		requestId: metadata.requestId,
		request,
		model: payload.model,
		userAgent: "antigravity",
		requestType: "agent",
		sentImageBytes
	};
}
function groupClaudeFunctionResponses(contents, model) {
	if (antigravityModelFamily(model) !== "claude") return contents;
	const grouped = [];
	let pendingResponses = [];
	const flushResponses = () => {
		if (pendingResponses.length === 0) return;
		grouped.push({
			role: "user",
			parts: pendingResponses
		});
		pendingResponses = [];
	};
	for (const content of contents) {
		const rawParts = Array.isArray(content.parts) ? content.parts : [];
		const responseParts = rawParts.filter((part) => isRecord(part) && isRecord(part.functionResponse));
		if (content.role === "user" && rawParts.length > 0 && responseParts.length === rawParts.length) {
			pendingResponses.push(...responseParts);
			continue;
		}
		flushResponses();
		grouped.push(content);
	}
	flushResponses();
	return grouped;
}
function buildPayloadFromContents(options, credential, contents) {
	const wireModel = resolveWireModel(options.model, options.reasoningEffort);
	const usesCapturedGemini38ThinkingBudget = /^gemini-3\.8-flash-(?:low|medium|high)$/u.test(wireModel);
	const request = { contents: groupClaudeFunctionResponses(contents, options.model) };
	const systemParts = [...options.system?.trim() ? [{ text: options.system }] : [], ...options.messages.flatMap((message) => message.role === "system" ? message.content.flatMap((block) => block.type === "text" && block.text.trim() ? [{ text: block.text }] : []) : [])];
	if (systemParts.length > 0) request.systemInstruction = { parts: systemParts };
	const generationConfig = {};
	if (options.maxTokens !== void 0) generationConfig.maxOutputTokens = boundedInteger(options.maxTokens, 1, 1e6, "maxTokens");
	else if (usesCapturedGemini38ThinkingBudget) generationConfig.maxOutputTokens = 65536;
	if (options.temperature !== void 0) generationConfig.temperature = boundedNumber(options.temperature, -100, 100, "temperature");
	if (options.stop !== void 0) generationConfig.stopSequences = options.stop.slice(0, 16).map((item) => item.slice(0, 256));
	if (options.reasoningEffort !== void 0) generationConfig.thinkingConfig = { thinkingLevel: String(options.reasoningEffort) };
	if (Object.keys(generationConfig).length > 0) request.generationConfig = generationConfig;
	if (options.tools !== void 0 && options.tools.length > 0) {
		const declarations = buildFunctionDeclarations(options.tools);
		if (declarations.length > 0) request.tools = [{ functionDeclarations: declarations }];
	}
	const tieredModel = resolveModelForTier(options.model, options.reasoningEffort);
	const resolved = resolveModelWithTier(usesCapturedGemini38ThinkingBudget ? wireModel : tieredModel);
	const nativeModel = getAgyNativeModel(wireModel);
	const usesAdaptiveNativeThinking = isGeminiArgonModel(wireModel) || nativeModel?.supportsAdaptiveThinking === true;
	const usesNumericGeminiThinkingBudget = !wireModel.toLowerCase().includes("claude") && !usesAdaptiveNativeThinking && typeof resolved.thinkingBudget === "number";
	const thinkingLevel = normalizeReasoningEffort(options.reasoningEffort) ?? resolved.thinkingLevel;
	if (wireModel.toLowerCase().includes("claude")) {
		applyClaudeToolHardening(request);
		applyClaudeTransforms(request, {
			model: wireModel,
			...resolved.thinkingBudget === void 0 || usesAdaptiveNativeThinking ? {} : { tierThinkingBudget: resolved.thinkingBudget },
			...usesAdaptiveNativeThinking || options.reasoningEffort === void 0 && resolved.thinkingBudget === void 0 ? {} : { normalizedThinking: {
				includeThoughts: true,
				...resolved.thinkingBudget === void 0 ? {} : { thinkingBudget: resolved.thinkingBudget }
			} },
			cleanJSONSchema: cleanClaudeSchema
		});
		if (usesAdaptiveNativeThinking) {
			const transformedConfig = isRecord(request.generationConfig) ? request.generationConfig : {};
			applyAgyNativeGenerationConfig(wireModel, transformedConfig);
			request.generationConfig = transformedConfig;
		}
	} else {
		applyGeminiTransforms(request, {
			model: wireModel,
			...thinkingLevel === void 0 || usesNumericGeminiThinkingBudget || usesAdaptiveNativeThinking ? {} : { tierThinkingLevel: thinkingLevel },
			...resolved.thinkingBudget === void 0 || usesAdaptiveNativeThinking ? {} : { tierThinkingBudget: resolved.thinkingBudget },
			...usesAdaptiveNativeThinking || options.reasoningEffort === void 0 && resolved.thinkingBudget === void 0 ? {} : { normalizedThinking: {
				includeThoughts: true,
				...resolved.thinkingBudget === void 0 ? {} : { thinkingBudget: resolved.thinkingBudget }
			} }
		});
		if (usesAdaptiveNativeThinking) {
			const transformedConfig = isRecord(request.generationConfig) ? request.generationConfig : {};
			applyAgyNativeGenerationConfig(wireModel, transformedConfig);
			request.generationConfig = transformedConfig;
		} else if (usesNumericGeminiThinkingBudget && typeof resolved.thinkingBudget === "number") {
			const transformedConfig = isRecord(request.generationConfig) ? request.generationConfig : {};
			transformedConfig.thinkingConfig = {
				includeThoughts: true,
				thinkingBudget: resolved.thinkingBudget
			};
			request.generationConfig = transformedConfig;
		}
	}
	const project = credential.projectId === "inductive-dreamer-qrkws" || !credential.projectId ? void 0 : credential.projectId;
	return {
		...project === void 0 ? {} : { project },
		model: wireModel,
		request
	};
}
function applyClaudeToolHardening(request) {
	if (!Array.isArray(request.tools) || request.tools.length === 0) return;
	request.tools = request.tools.map((tool) => {
		if (!isRecord(tool) || !Array.isArray(tool.functionDeclarations)) return tool;
		return {
			...tool,
			functionDeclarations: tool.functionDeclarations.map((declaration) => hardenClaudeToolDeclaration(declaration))
		};
	});
	const instructionPart = { text: CLAUDE_TOOL_SYSTEM_INSTRUCTION };
	const existing = request.systemInstruction;
	if (isRecord(existing) && Array.isArray(existing.parts)) {
		if (existing.parts.some((part) => isRecord(part) && typeof part.text === "string" && part.text.includes("CRITICAL TOOL USAGE INSTRUCTIONS"))) return;
		request.systemInstruction = {
			...existing,
			parts: [...existing.parts, instructionPart]
		};
	} else if (typeof existing === "string") request.systemInstruction = {
		role: "user",
		parts: [{ text: existing }, instructionPart]
	};
	else request.systemInstruction = {
		role: "user",
		parts: [instructionPart]
	};
}
function prepareClaudeSchema(value) {
	if (!isRecord(value)) return value;
	const copy = { ...value };
	if (isRecord(copy.properties)) {
		const props = {};
		for (const [key, item] of Object.entries(copy.properties)) props[key] = prepareClaudeSchema(item);
		copy.properties = props;
	}
	if (copy.items !== void 0) copy.items = prepareClaudeSchema(copy.items);
	const unionKey = Array.isArray(copy.anyOf) ? "anyOf" : Array.isArray(copy.oneOf) ? "oneOf" : void 0;
	if (unionKey !== void 0) {
		const rawBranches = copy[unionKey].map((branch) => prepareClaudeSchema(branch));
		const branches = rawBranches.filter(isRecord);
		const { anyOf: _anyOf, oneOf: _oneOf, ...base } = copy;
		if (branches.length > 1 && branches.every((branch) => typeof branch.type === "string" && branch.type.toLowerCase() === "object")) {
			const mergedProps = {};
			for (const branch of branches) {
				if (!isRecord(branch.properties)) continue;
				for (const [key, prop] of Object.entries(branch.properties)) {
					const existing = mergedProps[key];
					if (existing === void 0) mergedProps[key] = prop;
					else if (isRecord(existing) && isRecord(prop) && Array.isArray(existing.enum) && Array.isArray(prop.enum)) mergedProps[key] = {
						...existing,
						enum: [.../* @__PURE__ */ new Set([...existing.enum, ...prop.enum])]
					};
				}
			}
			const reqSets = branches.map((branch) => new Set(Array.isArray(branch.required) ? branch.required.filter((item) => typeof item === "string") : []));
			const commonRequired = [...reqSets[0] ?? []].filter((req) => reqSets.every((set) => set.has(req)) && Object.prototype.hasOwnProperty.call(mergedProps, req));
			return {
				...base,
				type: "object",
				properties: mergedProps,
				...commonRequired.length > 0 ? { required: commonRequired } : {}
			};
		}
		if (branches.length > 1 && branches.every((branch) => typeof branch.type === "string" && branch.type.toLowerCase() === "string" && !branch.properties && !branch.items) && branches.some((branch) => !Array.isArray(branch.enum)) && branches.some((branch) => Array.isArray(branch.enum) && branch.enum.length > 0)) {
			const hint = `Allowed presets: ${[...new Set(branches.flatMap((branch) => Array.isArray(branch.enum) ? branch.enum.filter((item) => typeof item === "string") : []))].map((item) => JSON.stringify(item)).join(", ")}`;
			const baseDesc = typeof base.description === "string" ? base.description : "";
			return {
				...base,
				type: "string",
				description: baseDesc ? `${baseDesc} (${hint})` : hint
			};
		}
		copy[unionKey] = rawBranches;
	}
	return copy;
}
function cleanClaudeSchema(value) {
	const prepared = prepareClaudeSchema(value);
	const cleaned = toGeminiSchema(prepared, { claudeValidated: true });
	return isRecord(cleaned) ? cleaned : {
		type: "object",
		properties: {}
	};
}
function hardenClaudeToolDeclaration(value) {
	if (!isRecord(value)) return value;
	const description = typeof value.description === "string" ? value.description : "";
	if (description.includes("STRICT PARAMETERS:")) return value;
	const schema = isRecord(value.parameters) ? cleanClaudeSchema(value.parameters) : void 0;
	const properties = schema !== void 0 && isRecord(schema.properties) ? schema.properties : void 0;
	if (properties === void 0 || Object.keys(properties).length === 0) return value;
	const required = new Set(Array.isArray(schema?.required) ? schema.required.filter((item) => typeof item === "string") : []);
	const parameters = Object.entries(properties).map(([name, property]) => {
		const requiredHint = required.has(name) ? ", REQUIRED" : "";
		return `${name} (${claudeToolTypeHint(property)}${requiredHint})`;
	});
	return {
		...value,
		description: description + CLAUDE_DESCRIPTION_PROMPT.replace("{params}", parameters.join(", "))
	};
}
function claudeToolTypeHint(value) {
	if (!isRecord(value)) return "unknown";
	if (Array.isArray(value.enum)) return value.enum.length <= 5 ? `string ENUM[${value.enum.map((item) => JSON.stringify(item)).join(", ")}]` : `string ENUM[${value.enum.length} options]`;
	const type = typeof value.type === "string" ? value.type.toLowerCase() : "unknown";
	if (type === "array") {
		if (!isRecord(value.items)) return "ARRAY";
		const itemType = typeof value.items.type === "string" ? value.items.type.toLowerCase() : "unknown";
		if (itemType !== "object") return `ARRAY_OF_${itemType.toUpperCase()}`;
		if (!isRecord(value.items.properties)) return "ARRAY_OF_OBJECTS";
		const nestedRequired = new Set(Array.isArray(value.items.required) ? value.items.required.filter((item) => typeof item === "string") : []);
		return `ARRAY_OF_OBJECTS[${Object.entries(value.items.properties).map(([name, property]) => {
			return `${name}: ${isRecord(property) && typeof property.type === "string" ? property.type.toLowerCase() : "unknown"}${nestedRequired.has(name) ? " REQUIRED" : ""}`;
		}).join(", ")}]`;
	}
	if (type === "object" && isRecord(value.properties)) {
		const nestedRequired = new Set(Array.isArray(value.required) ? value.required.filter((item) => typeof item === "string") : []);
		return `object{${Object.entries(value.properties).map(([name, property]) => {
			return `${name}: ${isRecord(property) && typeof property.type === "string" ? property.type.toLowerCase() : "unknown"}${nestedRequired.has(name) ? " REQUIRED" : ""}`;
		}).join(", ")}}`;
	}
	return type;
}
function mapMessage(message, model, toolNames, isRecentAssistant = true) {
	/** Calls of a new assistant message are the only ones its results may answer. */
	if (message.role === "assistant") expirePendingToolCalls(toolNames);
	const parts = [];
	const replayBlocks = compatibleReplayState(message, "google-antigravity", model, contentKinds(message))?.blocks ?? [];
	const isClaude = antigravityModelFamily(model) === "claude";
	let replayIndex = 0;
	/** A tool message answers one call; emit that response once and keep any remaining blocks. */
	let emittedToolResponse = false;
	if (message.role === "tool" && typeof message.toolCallId === "string" && message.toolCallId.length > 0) {
		const toolCallId = requireToolCallId(message.toolCallId);
		/** A tool message with no prior call of that id is skipped, not an error. */
		const binding = toolNames.has(toolCallId) ? consumeToolBinding(toolNames, toolCallId) : void 0;
		if (binding !== void 0) {
			emittedToolResponse = true;
			parts.push({ functionResponse: {
				...isClaude ? { id: binding.id } : {},
				name: binding.name,
				response: toolResponsePayload(blocksToText(message.content), message.isError)
			} });
		}
	}
	let sawClaudeFunctionCall = false;
	for (const block of message.content) {
		const replayKind = block.type === "text" || block.type === "reasoning" || block.type === "tool-call" ? block.type : void 0;
		const replayBlock = replayKind === void 0 ? void 0 : replayBlocks[replayIndex++];
		const replaySignature = replayBlock !== void 0 && replayBlock.kind === replayKind ? replayBlock.signature : void 0;
		const blockSignature = block.signature ?? block.thoughtSignature ?? replaySignature;
		if (block.type === "text") {
			/** Text already reached the model through the tool response above. */
			if (emittedToolResponse) continue;
			if (block.text.length === 0 && message.content.length > 1) continue;
			const sig = isRecentAssistant ? blockSignature : void 0;
			parts.push({
				text: block.text,
				...sig === void 0 ? {} : { thoughtSignature: sig }
			});
		} else if (block.type === "reasoning") {
			const sig = isRecentAssistant ? (blockSignature ?? SKIP_THOUGHT_SIGNATURE) : SKIP_THOUGHT_SIGNATURE;
			parts.push({
				text: block.text,
				thought: true,
				...sig === void 0 ? {} : { thoughtSignature: sig }
			});
		} else if (block.type === "tool-call") {
			const callId = rememberToolName(toolNames, block.id, block.name);
			/** Every family needs a signature here: the endpoint rejects unsigned functionCall parts with 400 INVALID_ARGUMENT. */
			const signature = isClaude && sawClaudeFunctionCall ? void 0 : blockSignature ?? SKIP_THOUGHT_SIGNATURE;
			sawClaudeFunctionCall ||= isClaude;
			parts.push({
				functionCall: {
					...isClaude ? { id: callId } : {},
					name: block.name,
					args: parseJsonObject(block.arguments)
				},
				...signature === void 0 ? {} : { thoughtSignature: signature }
			});
		} else if (block.type === "tool-result") {
			/** A role='tool' message was already answered as a whole; its block must not consume the call again. */
			if (emittedToolResponse) continue;
			const binding = consumeToolBinding(toolNames, block.toolCallId);
			parts.push({ functionResponse: {
				...isClaude ? { id: binding.id } : {},
				name: binding.name,
				response: toolResponsePayload(blocksToText(block.content), block.isError)
			} });
		} else if (block.type === "image") throw new LlmError("Antigravity text requests do not accept unresolved image blocks", "UNSUPPORTED_MODALITY");
	}
	return {
		role: message.role === "assistant" ? "model" : "user",
		parts
	};
}
async function mapMessageWithAttachments(message, model, toolNames, attachments, signal, sentImageBytes, isRecentAssistant = true) {
	if (!message.content.some((block) => block.type === "image")) return mapMessage(message, model, toolNames, isRecentAssistant);
	if (attachments === void 0) throw new LlmError("Antigravity image input requires the Host AttachmentStore", "UNSUPPORTED_MODALITY");
	/** Calls of a new assistant message are the only ones its results may answer. */
	if (message.role === "assistant") expirePendingToolCalls(toolNames);
	const replayBlocks = compatibleReplayState(message, "google-antigravity", model, contentKinds(message))?.blocks ?? [];
	const parts = [];
	const isClaude = antigravityModelFamily(model) === "claude";
	let replayIndex = 0;
	/** A tool message answers one call; emit that response once and keep any remaining blocks. */
	let emittedToolResponse = false;
	if (message.role === "tool" && typeof message.toolCallId === "string" && message.toolCallId.length > 0) {
		const toolCallId = requireToolCallId(message.toolCallId);
		/** A tool message with no prior call of that id is skipped, not an error. */
		const binding = toolNames.has(toolCallId) ? consumeToolBinding(toolNames, toolCallId) : void 0;
		if (binding !== void 0) {
			emittedToolResponse = true;
			parts.push({ functionResponse: {
				...isClaude ? { id: binding.id } : {},
				name: binding.name,
				response: toolResponsePayload(blocksToText(message.content), message.isError)
			} });
		}
	}
	let sawClaudeFunctionCall = false;
	for (const block of message.content) {
		const replayKind = block.type === "text" || block.type === "reasoning" || block.type === "tool-call" ? block.type : void 0;
		const replayBlock = replayKind === void 0 ? void 0 : replayBlocks[replayIndex++];
		const replaySignature = replayBlock !== void 0 && replayBlock.kind === replayKind ? replayBlock.signature : void 0;
		const blockSignature = block.signature ?? block.thoughtSignature ?? replaySignature;
		if (block.type === "image") {
			const ref = block.attachment;
			let mediaType;
			let encoded;
			if (typeof attachments.readImageRequest === "function") {
				const stored = await attachments.readImageRequest(ref, {
					...requestImageDimensions(ref.width, ref.height, ANTIGRAVITY_REQUEST_IMAGE_MAX_PIXELS),
					maxBytes: ANTIGRAVITY_REQUEST_IMAGE_MAX_BYTES
				}, signal);
				mediaType = stored.mediaType;
				encoded = Buffer.from(stored.data).toString("base64");
				sentImageBytes?.set(ref.attachmentId, stored.data.byteLength);
			} else {
				const stored = await attachments.readImage(ref, signal);
				mediaType = stored.ref.mediaType;
				encoded = Buffer.from(stored.data).toString("base64");
				sentImageBytes?.set(ref.attachmentId, stored.data.byteLength);
			}
			parts.push({ inlineData: {
				mimeType: mediaType,
				data: encoded
			} });
		} else if (block.type === "text") {
			/** Text already reached the model through the tool response above. */
			if (emittedToolResponse) continue;
			if (block.text.length === 0 && message.content.length > 1) continue;
			const sig = isRecentAssistant ? blockSignature : void 0;
			parts.push({
				text: block.text,
				...sig === void 0 ? {} : { thoughtSignature: sig }
			});
		} else if (block.type === "reasoning") {
			const sig = isRecentAssistant ? (blockSignature ?? SKIP_THOUGHT_SIGNATURE) : SKIP_THOUGHT_SIGNATURE;
			parts.push({
				text: block.text,
				thought: true,
				...sig === void 0 ? {} : { thoughtSignature: sig }
			});
		} else if (block.type === "tool-call") {
			const callId = rememberToolName(toolNames, block.id, block.name);
			/** Every family needs a signature here: the endpoint rejects unsigned functionCall parts with 400 INVALID_ARGUMENT. */
			const signature = isClaude && sawClaudeFunctionCall ? void 0 : blockSignature ?? SKIP_THOUGHT_SIGNATURE;
			sawClaudeFunctionCall ||= isClaude;
			parts.push({
				functionCall: {
					...isClaude ? { id: callId } : {},
					name: block.name,
					args: parseJsonObject(block.arguments)
				},
				...signature === void 0 ? {} : { thoughtSignature: signature }
			});
		} else if (block.type === "tool-result") {
			/** A role='tool' message was already answered as a whole; its block must not consume the call again. */
			if (emittedToolResponse) continue;
			const binding = consumeToolBinding(toolNames, block.toolCallId);
			parts.push({ functionResponse: {
				...isClaude ? { id: binding.id } : {},
				name: binding.name,
				response: toolResponsePayload(blocksToText(block.content), block.isError)
			} });
		}
	}
	return {
		role: message.role === "assistant" ? "model" : "user",
		parts
	};
}
function rememberToolName(toolNames, callId, name) {
	if (name.length === 0 || name.length > 256 || containsControl(name)) throw new LlmError("The tool call name is invalid", "INVALID_ARGS");
	const id = requireToolCallId(callId);
	const state = toolNames.get(id);
	/**
	* Provider call ids are unique per request, not across a durable history: the
	* same id legitimately reappears under another tool name. Suffixing the later
	* occurrence keeps every call addressable by its own answer instead of failing
	* the whole turn, and the suffix derives only from the ordered history, so a
	* rebuilt request reproduces the same ids byte for byte. A name that repeats
	* after a conflict keeps its own assigned id rather than reclaiming the raw id
	* still carried by the first call.
	*/
	const assigned = state === void 0 ? id : state.last.name === name ? state.last.id : `${id}#${name}`;
	const binding = {
		id: assigned,
		name
	};
	toolNames.set(id, {
		last: binding,
		pending: [...state?.pending ?? [], binding]
	});
	return assigned;
}
/**
* Pair one tool result with the call it answers. Only calls made by the same
* assistant message can share a raw id and still need in-order pairing, so the
* queue is expired at every new assistant message and an unanswered call from an
* earlier message can no longer claim a later result.
*/
function consumeToolBinding(toolNames, callId) {
	const state = toolNames.get(requireToolCallId(callId));
	if (state === void 0) throw new LlmError("A tool result did not match a prior tool call", "INVALID_ARGS");
	return state.pending.shift() ?? state.last;
}
/**
* Drop calls left unanswered by any earlier assistant message before reading this one.
*
* This relies on the Host committing every result of one step in the same step
* (`dsh-agent-loop` awaits `executeToolCalls`, and a max-tokens step returns
* before dispatching anything), so a call and its answer never straddle two
* assistant messages. If results ever become asynchronously committed, an
* unanswered call could legitimately outlive its message and this expiry would
* have to pair by call order instead.
*/
function expirePendingToolCalls(toolNames) {
	for (const state of toolNames.values()) if (state.pending.length > 0) state.pending = [];
}
function requireToolCallId(value) {
	if (typeof value !== "string" || value.length === 0 || value.length > 512 || containsControl(value)) throw new LlmError("The tool call id is invalid", "INVALID_ARGS");
	return value;
}
function normalizeReasoningEffort(value) {
	if (value === void 0) return void 0;
	const normalized = String(value).toLowerCase();
	if (normalized === "minimal" || normalized === "low") return "low";
	if (normalized === "medium") return "medium";
	if (normalized === "high") return "high";
}
function resolveModelForTier(model, reasoningEffort) {
	const effort = normalizeReasoningEffort(reasoningEffort);
	if (effort === void 0 || /-(?:minimal|low|medium|high)$/iu.test(model)) return model;
	if (/^(?:antigravity-)?gemini-3\.[58]-flash$/iu.test(model) || /^(?:antigravity-)?gemini-4-argon$/iu.test(model) || /^(?:antigravity-)?claude-(?:opus|sonnet)-5-5$/iu.test(model)) return `${model}-${effort}`;
	return model;
}
function resolveWireModel(model, reasoningEffort) {
	const routeModel = resolveModelForTier(model, reasoningEffort);
	return resolveModelWithTier(routeModel).actualModel;
}
function requestSessionKey(options) {
	return options.sessionId === void 0 ? "default" : `session:${fnv1a64Signed(String(options.sessionId))}`;
}
function contentKinds(message) {
	return message.content.flatMap((block) => block.type === "text" || block.type === "reasoning" || block.type === "tool-call" ? [block.type] : []);
}
function parseProviderEvent(data) {
	const normalized = data.trim().replace(/^\)\]\}'(?:\r?\n)?/u, "");
	let value;
	try {
		value = JSON.parse(normalized);
	} catch {
		throw new PrivateTransportError("invalid-response", "The private response contained invalid JSON");
	}
	if (!isRecord(value)) throw new PrivateTransportError("protocol-drift", "The private response event was not an object");
	if (isRecord(value.error)) return {
		parts: [],
		error: errorDetails(value.error)
	};
	const root = isRecord(value.response) ? value.response : value;
	if (isRecord(root.error)) return {
		parts: [],
		error: errorDetails(root.error)
	};
	const partsValue = findParts(root);
	const parts = [];
	for (const part of partsValue) {
		const parsed = parsePart(part);
		if (parsed !== void 0) parts.push(parsed);
	}
	const usage = parseUsage(root.usageMetadata ?? value.usageMetadata);
	const finish = findFinish(root);
	return {
		parts,
		...usage === void 0 ? {} : { usage },
		...finish === void 0 ? {} : { finish }
	};
}
function findParts(value) {
	if (Array.isArray(value.parts)) return boundedParts(value.parts);
	if (isRecord(value.content) && Array.isArray(value.content.parts)) return boundedParts(value.content.parts);
	if (isRecord(value.modelTurn) && Array.isArray(value.modelTurn.parts)) return boundedParts(value.modelTurn.parts);
	if (Array.isArray(value.candidates)) {
		const output = [];
		for (const candidate of value.candidates) {
			if (!isRecord(candidate)) continue;
			const content = isRecord(candidate.content) ? candidate.content : candidate;
			if (Array.isArray(content.parts)) {
				if (output.length + content.parts.length > MAX_PROVIDER_PARTS) throw new PrivateTransportError("protocol-drift", "The private response contained too many parts");
				output.push(...content.parts);
			}
		}
		return output;
	}
	if (isRecord(value.serverContent) && isRecord(value.serverContent.modelTurn) && Array.isArray(value.serverContent.modelTurn.parts)) return boundedParts(value.serverContent.modelTurn.parts);
	return [];
}
function boundedParts(value) {
	if (value.length > MAX_PROVIDER_PARTS) throw new PrivateTransportError("protocol-drift", "The private response contained too many parts");
	return value;
}
function parsePart(value) {
	if (!isRecord(value)) throw new PrivateTransportError("protocol-drift", "The private response part was malformed");
	const functionCall = isRecord(value.functionCall) ? value.functionCall : isRecord(value.function_call) ? value.function_call : void 0;
	if (functionCall !== void 0) {
		const name = stringValue(functionCall.name);
		const id = stringValue(functionCall.id);
		const signature = signatureOf(value) ?? signatureOf(functionCall);
		const args = typeof functionCall.args === "string" ? functionCall.args : JSON.stringify(functionCall.args ?? {});
		return {
			kind: "tool-call",
			...name === void 0 ? {} : { name },
			...id === void 0 ? {} : { id },
			arguments: args,
			...signature === void 0 ? {} : { signature }
		};
	}
	if (typeof value.text === "string" || signatureOf(value) !== void 0) {
		const kind = value.thought === true || value.reasoning === true || value.thinking === true ? "reasoning" : "text";
		const signature = signatureOf(value);
		return {
			kind,
			text: typeof value.text === "string" ? value.text : "",
			...signature === void 0 ? {} : { signature }
		};
	}
	if (value.inlineData !== void 0 || value.inline_data !== void 0) throw new PrivateTransportError("protocol-drift", "The text model returned unsupported media output");
	throw new PrivateTransportError("protocol-drift", "The private response contained an unknown part type");
}
function errorDetails(value) {
	const status = numberValue(value.status);
	const code = stringValue(value.code);
	const contextWindowExceeded = providerErrorReportsContextWindowExceeded(value, 0);
	return {
		...status === void 0 ? {} : { status },
		...code === void 0 ? {} : { code },
		...contextWindowExceeded ? { contextWindowExceeded: true } : {}
	};
}
async function responseReportsContextWindowExceeded(response, options) {
	try {
		for await (const event of iteratePrivateSse(response, {
			...options.signal === void 0 ? {} : { signal: options.signal },
			idleTimeoutMs: options.idleTimeoutMs,
			totalTimeoutMs: options.totalTimeoutMs,
			maxBytes: Math.min(MAX_PROVIDER_ERROR_BYTES, options.maxResponseBytes),
			maxFrameBytes: Math.min(MAX_PROVIDER_ERROR_FRAME_BYTES, options.maxFrameBytes)
		})) if (providerErrorEnvelopeReportsContextWindowExceeded(event.data.replace(/^\)\]\}'(?:\r?\n)?/u, ""), 0)) return true;
		return false;
	} catch (error) {
		if (error instanceof PrivateTransportError && error.code === "cancelled") throw toLlmError(error);
		if (isAborted(options.signal)) throw new LlmError("The Antigravity request was cancelled", "CANCELLED");
		return false;
	}
}
function providerErrorReportsContextWindowExceeded(value, depth) {
	if (depth > MAX_PROVIDER_ERROR_JSON_DEPTH) return false;
	if (typeof value.message === "string") {
		if (isExactContextWindowExceededMessage(value.message)) return true;
		if (providerErrorEnvelopeReportsContextWindowExceeded(value.message, depth + 1)) return true;
	}
	return isRecord(value.error) && providerErrorReportsContextWindowExceeded(value.error, depth + 1);
}
function providerErrorEnvelopeReportsContextWindowExceeded(value, depth) {
	if (depth > MAX_PROVIDER_ERROR_JSON_DEPTH || value.length === 0 || value.length > MAX_PROVIDER_ERROR_BYTES) return false;
	const json = value.trim();
	if (!json.startsWith("{") || !jsonDepthIsBounded(json, MAX_PROVIDER_ERROR_JSON_DEPTH)) return false;
	try {
		const parsed = JSON.parse(json);
		return isRecord(parsed) && isRecord(parsed.error) ? providerErrorReportsContextWindowExceeded(parsed.error, depth + 1) : false;
	} catch {
		return false;
	}
}
function isExactContextWindowExceededMessage(value) {
	const match = /^prompt is too long: ([0-9]{1,16}) tokens > ([0-9]{1,16}) maximum$/u.exec(value);
	const actual = match?.[1];
	const maximum = match?.[2];
	return actual !== void 0 && maximum !== void 0 && BigInt(actual) > BigInt(maximum);
}
function jsonDepthIsBounded(value, maxDepth) {
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (const character of value) {
		if (inString) {
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === "\"") inString = false;
			continue;
		}
		if (character === "\"") {
			inString = true;
			continue;
		}
		if (character === "{" || character === "[") {
			depth += 1;
			if (depth > maxDepth) return false;
		} else if (character === "}" || character === "]") {
			depth -= 1;
			if (depth < 0) return false;
		}
	}
	return depth === 0 && !inString && !escaped;
}
function contextWindowExceededError(status) {
	const message = "The Antigravity request exceeded the model context window";
	return status === void 0 ? new LlmError(message, CONTEXT_WINDOW_EXCEEDED_CODE) : new LlmError(message, CONTEXT_WINDOW_EXCEEDED_CODE, { status });
}
function parseUsage(value) {
	if (!isRecord(value)) return void 0;
	const input = numberValue(value.promptTokenCount ?? value.inputTokenCount);
	const output = numberValue(value.candidatesTokenCount ?? value.outputTokenCount);
	const reasoning = numberValue(value.thoughtsTokenCount ?? value.reasoningTokenCount);
	const cached = numberValue(value.cachedContentTokenCount ?? value.cacheReadTokens);
	if (input === void 0 && output === void 0 && reasoning === void 0 && cached === void 0) return void 0;
	return {
		inputTokens: input ?? 0,
		outputTokens: output ?? 0,
		...cached === void 0 ? {} : { cacheReadTokens: cached },
		...reasoning === void 0 ? {} : { reasoningTokens: reasoning }
	};
}
function findFinish(value) {
	const candidate = value.finishReason ?? value.finish_reason;
	if (typeof candidate === "string") return candidate;
	if (isRecord(value.serverContent) && typeof value.serverContent.finishReason === "string") return value.serverContent.finishReason;
	if (Array.isArray(value.candidates)) {
		for (const item of value.candidates) if (isRecord(item) && typeof item.finishReason === "string") return item.finishReason;
	}
}
function signatureOf(value) {
	return stringValue(value.thoughtSignature ?? value.thought_signature ?? value.signature);
}
function parseJsonObject(value) {
	try {
		const parsed = JSON.parse(value);
		if (isRecord(parsed)) return parsed;
	} catch {}
	const repaired = tryRepairJson(value);
	if (repaired !== void 0) return repaired;
	return {};
}
function blocksToText(blocks) {
	return blocks.filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n").slice(0, 65536);
}
function isAuthenticationCode(value) {
	const normalized = value?.toUpperCase();
	return normalized === "UNAUTHENTICATED" || normalized === "AUTHENTICATION" || normalized === "INVALID_GRANT" || normalized === "UNAUTHENTICATED_REQUEST";
}
function mapFinishReason(value) {
	const normalized = value?.toUpperCase();
	if (normalized === "MAX_TOKENS" || normalized === "LENGTH") return "max-tokens";
	if (normalized === "SAFETY" || normalized === "BLOCKLIST" || normalized === "ERROR") return "error";
	if (normalized === "TOOL_CALLS" || normalized === "FUNCTION_CALL") return "tool-calls";
	return "stop";
}
function finishChunk(kind, code, status, replayState) {
	return {
		type: "finish",
		reason: kind === "aborted" ? {
			kind: "aborted",
			failure: {
				code,
				message: "The Antigravity request was cancelled"
			}
		} : kind === "error" ? {
			kind: "error",
			failure: {
				code,
				message: "The Antigravity provider request failed",
				...status === void 0 ? {} : { status }
			}
		} : kind === "max-tokens" ? { kind: "max-tokens" } : kind === "tool-calls" ? { kind: "tool-calls" } : { kind: "stop" },
		...replayState === void 0 ? {} : { replayState }
	};
}
const LLM_FAILURE_CODES = {
	authentication: "AUTH",
	forbidden: "FORBIDDEN",
	"rate-limited": "RATE_LIMIT",
	cancelled: "CANCELLED",
	timeout: "TIMEOUT",
	"attribution-rejected": "GATE_0_ATTRIBUTION",
	"protocol-drift": "PROTOCOL_DRIFT",
	"response-limit": "RESPONSE_LIMIT",
	"request-limit": "REQUEST_LIMIT",
	upstream: "UPSTREAM",
	network: "TRANSPORT",
	failed: "PROVIDER_ERROR"
};
function canFallBackToPinnedTextSnapshot(error) {
	if (!(error instanceof LlmError)) return false;
	return error.code === "RATE_LIMIT" || error.code === "TIMEOUT" || error.code === "PROTOCOL_DRIFT" || error.code === "RESPONSE_LIMIT" || error.code === "UPSTREAM" || error.code === "TRANSPORT";
}
function toModelCatalogError(error, signal, fallback) {
	if (isAborted(signal)) return new LlmError("The Antigravity live model catalog request was cancelled", "CANCELLED");
	if (error instanceof LlmError) return error;
	if (error instanceof PrivateTransportError || fallback === "provider") return toLlmError(error);
	return new LlmError("The Antigravity live model catalog did not match the audited schema", "PROTOCOL_DRIFT");
}
function toLlmError(error) {
	if (error instanceof LlmError) return error;
	if (error instanceof PrivateTransportError) {
		const kind = classifyPrivateFailure(error);
		const code = LLM_FAILURE_CODES[kind];
		const detail = error.status === void 0 ? ` (${code})` : ` (${code}, status ${error.status})`;
		const message = kind === "rate-limited" ? "Antigravity rate limit reached (Google returned 429 Resource Exhausted); please wait for your quota window to refresh" : `The Antigravity private request failed safely${detail}`;
		return error.status === void 0 ? new LlmError(message, code) : new LlmError(message, code, { status: error.status });
	}
	return new LlmError("The Antigravity provider request failed safely", "PROVIDER_ERROR");
}
function boundedTimeout(value, fallback) {
	return value === void 0 || !Number.isFinite(value) || value <= 0 ? fallback : Math.min(Math.floor(value), 6e5);
}
function boundedLimit(value, fallback) {
	return value === void 0 || !Number.isFinite(value) || value <= 0 ? fallback : Math.min(Math.floor(value), fallback);
}
function boundedInteger(value, min, max, field) {
	if (!Number.isSafeInteger(value) || value < min || value > max) throw new LlmError(`The Antigravity ${field} option is invalid`, "INVALID_OPTIONS");
	return value;
}
function boundedNumber(value, min, max, field) {
	if (!Number.isFinite(value) || value < min || value > max) throw new LlmError(`The Antigravity ${field} option is invalid`, "INVALID_OPTIONS");
	return value;
}
function numberValue(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : void 0;
}
function stringValue(value) {
	return typeof value === "string" && value.length > 0 && value.length <= 16384 && !containsControl(value) ? value : void 0;
}
function safeProviderErrorCode(value) {
	const normalized = value?.toUpperCase();
	return normalized === "SAFETY" || normalized === "BLOCKED" || normalized === "RESOURCE_EXHAUSTED" || normalized === "INVALID_ARGUMENT" ? normalized : "UPSTREAM_ERROR";
}
function safeProviderStatus(value) {
	return value !== void 0 && Number.isInteger(value) && value >= 400 && value <= 599 ? value : void 0;
}
async function cancelResponse(response) {
	try {
		await response.body?.cancel();
	} catch {}
}
function isAborted(signal) {
	return signal !== void 0 && signal.aborted;
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isRetryableNetworkError(error) {
	if (!(error instanceof PrivateTransportError)) return false;
	return error.code === "offline" || error.code === "timeout" || error.code === "upstream";
}
async function waitRetryBackoff(delayMs, signal) {
	if (signal?.aborted === true) return;
	await new Promise((resolve) => {
		let timer;
		const onAbort = () => {
			if (timer !== void 0) clearTimeout(timer);
			resolve();
		};
		timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, delayMs);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
//#endregion
export { ANTIGRAVITY_AVAILABLE_MODELS_ENDPOINT, ANTIGRAVITY_GENERATE_ENDPOINT, ANTIGRAVITY_LLM_ROUTE, ANTIGRAVITY_PROVIDER, ANTIGRAVITY_STREAM_ENDPOINT, AntigravityAdapter, buildAntigravityGeneratePayload };
