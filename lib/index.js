import { A as defaultAuthStorePath, C as defaultAuthPoolPath, D as migrateLegacyRecord, E as maskForStorage, O as readPoolFile, S as createAuthStorePool, T as emailTagFor, _ as credentialErrorMessage, a as createAntigravityAuthService, b as AUTH_POOL_VERSION, c as createMemoryCapabilityGates, d as ANTIGRAVITY_REVOKE_ENDPOINT, f as ANTIGRAVITY_TOKEN_ENDPOINT, g as createGoogleRevokeTransport, h as createGoogleRefreshTransport, i as accountHandle, k as writePoolFile, l as defaultCapabilityGatePath, m as createCredentialCoordinator, o as maskEmail, p as CredentialOperationError, r as AntigravityAuthService, s as createFileCapabilityGates, t as mountCapabilityLifecycle, u as OAuthFlowError, v as decideRotation, w as effectiveFailureCount, x as FAILURE_STREAK_WINDOW_MS, y as rotationAttemptBudget } from "./capability-lifecycle-C17wqMBr.js";
import { a as DEFAULT_PRIVATE_RESPONSE_HEADER_TIMEOUT_MS, c as assertPrivateEndpoint, d as privateStatusError, f as readPrivateBytes, g as PrivateTransportError, h as setExplicitProxy, i as DEFAULT_PRIVATE_RESPONSE_BYTES, l as createPrivateTransport, m as scopedHttpsFetch, n as DEFAULT_PRIVATE_IDLE_TIMEOUT_MS, o as DEFAULT_PRIVATE_TOTAL_TIMEOUT_MS, p as readPrivateText, r as DEFAULT_PRIVATE_REQUEST_BYTES, s as MAX_PRIVATE_REQUEST_BYTES, t as DEFAULT_PRIVATE_FRAME_BYTES, u as iteratePrivateSse } from "./private-transport-DUrd-Qg2.js";
import { AGY_PROVIDER_USER_AGENT, ANTIGRAVITY_WIRE_ORIGIN, ANTIGRAVITY_WIRE_ORIGINS, ANTIGRAVITY_WIRE_PATHS, DSH_ATTRIBUTION_HEADER, WireIdentityError, assertWireIdentityInvariant, buildWireIdentityHeaders, createWireIdentity } from "./wire-identity.js";
import { PROJECT_DISCOVERY_ENDPOINT, PROJECT_DISCOVERY_PATH, ProjectDiscoveryError, createProjectContext, createProjectDiscovery, normalizeProjectId } from "./project-context.js";
import { a as createStatusView, i as LLM_FAMILY_IDS, n as CAPABILITY_GATE_OUTCOMES, r as CAPABILITY_ROW_IDS, t as ANTIGRAVITY_PLUGIN_ID } from "./status-hE_LSout.js";
import { ANTIGRAVITY_QUOTA_ENDPOINT, QUOTA_REFRESH_MIN_INTERVAL_MS, QuotaNormalizationError, createQuotaService, normalizeQuotaResponse } from "./quota.js";
import { ANTIGRAVITY_REPLAY_VERSION, antigravityModelFamily, buildFunctionDeclarations, compatibleReplayState, createReplayState, sanitizeToolSchemas } from "./replay.js";
import { ANTIGRAVITY_AVAILABLE_MODELS_ENDPOINT, ANTIGRAVITY_GENERATE_ENDPOINT, ANTIGRAVITY_LLM_ROUTE, ANTIGRAVITY_PROVIDER, ANTIGRAVITY_STREAM_ENDPOINT, AntigravityAdapter, buildAntigravityGeneratePayload } from "./llm-adapter.js";
import { a as parseStatusResult, c as isSafeRpcErrorCode, i as parseModelCatalogResult, l as safeRpcErrorMessage, n as ANTIGRAVITY_AUTH_RPC_NAMESPACE, o as parseUsageResult, r as createAntigravityAuthRpcClient, s as ANTIGRAVITY_MODEL_CATALOG_STATES, t as ANTIGRAVITY_AUTH_RPC_CHANNEL } from "./rpc-contract-DUpvGr6D.js";
import { DEFAULT_INLINE_IMAGE_BYTES, DEFAULT_VIDEO_BYTES, IMAGE_HANDLE_PATTERN, MediaAdmissionError, admitBase64Image, admitImageBytes, admitSessionImage, admitWorkspaceImage, admitWorkspaceVideo, detectImageMediaType, imageHandle, isMp4, sessionImageCatalog } from "./media-admission.js";
import { LIVE_ACKNOWLEDGEMENT, LIVE_GATE_IDS, runLiveGateCli } from "./live-gates.js";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { clientRequestSchema } from "@deepseek-ai/dsh-client-connection";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
//#region src/loopback-rpc.ts
const LOOPBACK_REQUIRED_MESSAGE = "Antigravity account controls require a loopback-bound DSH Host";
/**
* Decide the account RPC activation from the public WebServer bind. Only an
* explicitly loopback-bound Web service is enabled; a missing, non-loopback,
* or unknown bind is blocked because absence of WebServer is not proof of an
* owned carrier.
*
* This is a Host activation policy, not a per-request source check. DSH
* 0.1.2-alpha.5 exposes no public method-level or carrier authority context.
*/
function loopbackMode(webServerHost) {
	return webServerHost === "127.0.0.1" ? "enabled" : "blocked";
}
/** Command-entry denial shown when the Host exposes the commands seam beyond loopback. */
const ACCOUNT_COMMAND_DENIED_MESSAGE = "Antigravity account commands require a local DSH Host (no WebServer or 127.0.0.1-bound)";
/**
* Decide slash-command activation for one Host composition. The account
* command is the local-terminal login entry point: a composition with no
* WebServer can only dispatch through local UI adapters, and a loopback-bound
* WebServer is the same machine, so both are enabled. Any other WebServer bind
* exposes the shared commands seam to remote callers, and DSH 0.1.2-alpha.5
* command invocations carry no caller/carrier authority with which to exempt
* the local terminal, so those compositions fail closed for every caller.
*
* This is a Host activation policy, not a per-request source check.
*/
function commandAccountMode(webServer) {
	if (webServer === void 0) return "enabled";
	return loopbackMode(webServer.host);
}
/**
* Select the real RPC dispatcher only for an explicitly loopback-bound Web
* service; any other composition registers a value-free inert dispatcher that
* never calls the delegate.
*/
function createLoopbackRpcGuard(webServerHost, delegate) {
	if (loopbackMode(webServerHost) === "blocked") return {
		mode: "blocked",
		handler: async () => ({
			ok: false,
			error: {
				code: "loopback-required",
				message: LOOPBACK_REQUIRED_MESSAGE,
				details: {}
			}
		})
	};
	return {
		mode: "enabled",
		handler: delegate
	};
}
//#endregion
//#region src/open-authorization-url.ts
/**
* Best-effort Host browser launch that hands the terminal user the OAuth
* authorization URL without persisting it in the session's `command/done`
* event (that event follows ordinary session persistence).
*
* DSH exposes no public transient-presentation or browser-authority API for
* plugins to hand off an external login URL, so this module spawns the
* platform default opener directly, mirroring the best-effort helper the DSH
* TUI renderer uses for its own hrefs, and reports every failure as `false`: a
* Host without a desktop browser simply cannot complete interactive Google
* sign-in from the terminal (documented limitation; no public Host API exists
* to close it).
*
* @module antigravity-auth/open-authorization-url
*/
/** The Google authorization endpoint this plugin starts logins against. */
const AUTHORIZATION_HOST = "accounts.google.com";
/**
* Resolve the host default-browser opener. Darwin uses `open`, Windows
* `cmd /c start`, elsewhere `xdg-open`.
*
* The Windows command line is `cmd /c start "" "<url>"`: the empty quoted token
* is the `start` window title (without it `start` treats the URL as the title),
* and the quoted URL keeps its `&`-separated query parameters from being read
* as command separators. Both quotes reach `cmd` verbatim because Node's
* default argument handling would leave a `&`-only argument unquoted.
* @param platform - `process.platform` snapshot.
* @param url - already-validated https authorization URL.
*/
function openerSpec(platform, url) {
	if (platform === "darwin") return {
		command: "open",
		args: [url],
		verbatimArguments: false
	};
	if (platform === "win32") return {
		command: "cmd",
		args: [
			"/c",
			"start",
			"\"\"",
			`"${url}"`
		],
		verbatimArguments: true
	};
	return {
		command: "xdg-open",
		args: [url],
		verbatimArguments: false
	};
}
/**
* Whether a candidate is the Google authorization endpoint this plugin starts.
* @param value - candidate authorization URL.
*/
function isAntigravityAuthorizationUrl(value) {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "https:" && parsed.hostname === AUTHORIZATION_HOST && parsed.pathname.startsWith("/o/oauth2/");
	} catch {
		return false;
	}
}
/**
* Open the authorization URL in the host default browser, best effort.
* @param url - the Google authorization URL returned by `OAuthFlow.start()`.
* @param spawnFn - injectable spawn.
* @param platform - injectable platform.
* @returns true once the opener process spawned; false when the URL is not an
* Antigravity authorization URL, spawn threw, or the opener could not start.
* The URL never enters the returned value or a diagnostic.
*/
async function openAuthorizationUrl(url, spawnFn = spawn, platform = process.platform) {
	if (!isAntigravityAuthorizationUrl(url)) return false;
	const spec = openerSpec(platform, url);
	try {
		const child = spawnFn(spec.command, spec.args, {
			detached: true,
			stdio: "ignore",
			windowsVerbatimArguments: spec.verbatimArguments
		});
		return await new Promise((resolve) => {
			child.once("error", () => {
				resolve(false);
			});
			child.once("spawn", () => {
				child.unref();
				resolve(true);
			});
		});
	} catch {
		return false;
	}
}
//#endregion
//#region src/auth-command.ts
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
function formatStatus(status) {
	const login = status.login;
	const parts = [login.configured ? "configured" : "not configured", login.projectAvailable ? "project available" : "no project"];
	if (login.maskedEmail !== void 0) parts.push(login.maskedEmail);
	if (login.phase === "pending") parts.push("authorization pending");
	else if (login.phase !== "idle" && login.phase !== "success") parts.push(`phase ${login.phase}`);
	if (login.errorCode !== void 0) parts.push(`error ${login.errorCode}`);
	const available = status.capabilities.filter((capability) => capability.state === "available").map((capability) => capability.id);
	if (available.length > 0) parts.push(`available: ${available.join(", ")}`);
	return `Antigravity auth: ${parts.join("; ")}`;
}
/**
* Build the slash command shared by every interactive DSH surface.
* @param service - the shared Host auth service.
* @param accountMode - live account-control activation for this Host
* composition (enabled on a local terminal Host with no WebServer or a
* loopback-bound WebServer, blocked on a public Web bind); when blocked the
* command denies every operation without touching the auth service.
* @param openUrl - best-effort Host browser launcher for the authorization
* URL; the URL is delivered there and never echoed into the command result,
* because `CommandResult.text` is persisted verbatim into `command/done`. The
* resolved false value means the Host has no usable browser launch, which the
* command reports without reproducing the URL.
*/
function createAntigravityAuthCommand(service, accountMode, openUrl = openAuthorizationUrl) {
	return {
		name: "antigravity-auth",
		description: "Inspect or start the Antigravity OAuth login",
		input: { hint: "[status|login|cancel|logout]" },
		handler: async ({ rawInput }) => {
			if (accountMode() === "blocked") return {
				kind: "error",
				text: ACCOUNT_COMMAND_DENIED_MESSAGE
			};
			const operation = rawInput.trim() || "status";
			if (operation === "status") try {
				return {
					kind: "success",
					text: formatStatus(await service.status())
				};
			} catch (error) {
				return {
					kind: "error",
					text: `reading Antigravity auth status failed: ${errorMessage(error)}`
				};
			}
			if (operation === "login") try {
				const replaced = (await service.status()).login.phase === "pending";
				await service.acknowledgeRisk();
				if (!await openUrl((await service.startLogin()).authorizationUrl)) return {
					kind: "error",
					text: "Antigravity authorization started, but this Host could not open a browser automatically; complete sign-in in a browser on this Host, then run /antigravity-auth status."
				};
				return {
					kind: "success",
					text: replaced ? "Previous Antigravity authorization cancelled and a new one started (unofficial Antigravity channel, personal use); complete Google sign-in in the opened browser, then run /antigravity-auth status." : "Antigravity authorization started (unofficial Antigravity channel, personal use); complete Google sign-in in the opened browser, then run /antigravity-auth status."
				};
			} catch (error) {
				return {
					kind: "error",
					text: `starting Antigravity login failed: ${errorMessage(error)}`
				};
			}
			if (operation === "cancel") try {
				const result = await service.cancelLogin();
				return result.phase === "cancelled" ? {
					kind: "success",
					text: "Antigravity authorization cancelled."
				} : {
					kind: "error",
					text: `Antigravity authorization could not be cancelled (phase ${result.phase}).`
				};
			} catch (error) {
				return {
					kind: "error",
					text: `cancelling Antigravity login failed: ${errorMessage(error)}`
				};
			}
			if (operation === "logout") try {
				await service.logout();
				return {
					kind: "success",
					text: "Antigravity logged out."
				};
			} catch (error) {
				return {
					kind: "error",
					text: `logging out of Antigravity failed: ${errorMessage(error)}`
				};
			}
			return {
				kind: "error",
				text: `unknown operation "${operation}" (available: status, login, cancel, logout)`
			};
		}
	};
}
//#endregion
//#region src/account-routes.ts
/** Plugin-owned account RPC carried by Connection's authenticated /api routes. */
/** Register exact routes without creating a separate physical RPC carrier. */
function registerAccountRoutes(connection, namespace, endpoints, handler) {
	const disposers = endpoints.map((endpoint) => connection.fetch.register({
		path: `/api/${namespace}/${endpoint}`,
		methods: ["POST"],
		requestBody: "buffered",
		fetch: async (request) => {
			if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return new Response("content type must be application/json", { status: 415 });
			let body;
			try {
				body = await request.json();
			} catch {
				return new Response("invalid JSON", { status: 400 });
			}
			const envelope = clientRequestSchema.safeParse(body);
			if (!envelope.success) return new Response("invalid account request", { status: 400 });
			const { rpcId, method, payload } = envelope.data;
			const failure = (code, message) => ({
				ok: false,
				error: {
					code,
					message,
					details: {}
				}
			});
			let result;
			try {
				result = method === `${namespace}/${endpoint}` ? await handler(endpoint, payload, request.signal) : failure("bad-request", "Account request method does not match its endpoint");
			} catch {
				result = failure("internal", "Account request failed");
			}
			return Response.json({
				type: "server-response",
				rpcId,
				result
			});
		}
	}));
	return async () => {
		await Promise.all(disposers.map((dispose) => dispose()));
	};
}
//#endregion
//#region src/proxy-config.ts
/** Persistent proxy configuration for Antigravity tools. */
const PROXY_CONFIG_FILE_PATH = join(dirname(defaultAuthStorePath()), "config.json");
let customConfigFilePath;
function getProxyConfigFile() {
	return customConfigFilePath ?? PROXY_CONFIG_FILE_PATH;
}
function setCustomProxyConfigFile(path) {
	customConfigFilePath = path;
}
function getStoredProxy() {
	try {
		const raw = readFileSync(getProxyConfigFile(), "utf-8");
		const data = JSON.parse(raw);
		return typeof data?.proxy === "string" ? data.proxy.trim() : "";
	} catch {
		return "";
	}
}
function setStoredProxy(proxy) {
	try {
		const file = getProxyConfigFile();
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, JSON.stringify({ proxy }), "utf-8");
	} catch {}
}
function applyProxySetting(proxyValue) {
	const proxy = typeof proxyValue === "string" && proxyValue.trim().length > 0 ? proxyValue.trim() : void 0;
	setExplicitProxy(proxy);
}
//#endregion
//#region src/rpc.ts
/** Dispatch closed, value-safe requests; callback URLs are never echoed. */
async function handleAntigravityAuthRpc(service, endpoint, payload, signal, modelCatalog) {
	if (signal?.aborted === true) return cancelled();
	try {
		if (endpoint === "status") {
			if (!isEmptyRecord(payload)) return badRequest("status expects an empty payload");
			return {
				ok: true,
				value: { status: await service.status() }
			};
		}
		if (endpoint === "select-account") {
			if (!isAccountHandlePayload(payload)) return badRequest("select-account expects { id: string }");
			if (service.selectAccount === void 0) return badRequest("account selection is unavailable");
			return {
				ok: true,
				value: await service.selectAccount(payload.id)
			};
		}
		if (endpoint === "remove-account") {
			if (!isAccountHandlePayload(payload)) return badRequest("remove-account expects { id: string }");
			if (service.removeAccount === void 0) return badRequest("account removal is unavailable");
			return {
				ok: true,
				value: await service.removeAccount(payload.id)
			};
		}
		if (endpoint === "models") {
			if (!isRefreshPayload(payload)) return badRequest("models expects {} or { force: boolean }");
			if (modelCatalog === void 0) return badRequest("model catalog is unavailable");
			const status = await service.status();
			return {
				ok: true,
				value: status.login.projectAvailable && status.capabilities.some((capability) => capability.id === "auth-llm" && capability.state === "available") ? await modelCatalog.modelCatalog(signal, payload.force) : modelCatalog.catalogSnapshot()
			};
		}
		if (endpoint === "usage") {
			if (!isRefreshPayload(payload)) return badRequest("usage expects {} or { force: boolean }");
			if (service.usage === void 0) return {
				ok: true,
				value: { state: "protocol-drift" }
			};
			return {
				ok: true,
				value: await service.usage(signal, payload.force)
			};
		}
		if (endpoint === "acknowledge-risk") {
			if (!isAcknowledgement(payload)) return badRequest("acknowledge-risk expects { acknowledge: true }");
			return {
				ok: true,
				value: await service.acknowledgeRisk()
			};
		}
		if (endpoint === "login") {
			if (!isEmptyRecord(payload)) return badRequest("login expects an empty payload");
			return {
				ok: true,
				value: await service.startLogin()
			};
		}
		if (endpoint === "cancel" || endpoint === "cancel-login") {
			if (!isEmptyRecord(payload)) return badRequest("cancel expects an empty payload");
			return {
				ok: true,
				value: await service.cancelLogin()
			};
		}
		if (endpoint === "logout") {
			if (!isEmptyRecord(payload)) return badRequest("logout expects an empty payload");
			return {
				ok: true,
				value: await service.logout()
			};
		}
		if (endpoint === "revoke") {
			if (!isRevokePayload(payload)) return badRequest("revoke expects { confirmed: true }");
			return {
				ok: true,
				value: await service.revoke(true, signal)
			};
		}
		if (endpoint === "get-proxy") return {
			ok: true,
			value: { proxy: getStoredProxy() }
		};
		if (endpoint === "set-proxy") {
			const proxy = isRecord(payload) && typeof payload.proxy === "string" ? payload.proxy.trim() : "";
			setStoredProxy(proxy);
			applyProxySetting(proxy);
			return {
				ok: true,
				value: { proxy }
			};
		}
		return badRequest("unknown Antigravity auth endpoint");
	} catch (error) {
		return safeFailure(error);
	}
}
function badRequest(message) {
	return {
		ok: false,
		error: {
			code: "bad-request",
			message,
			details: { issues: [] }
		}
	};
}
function cancelled() {
	return {
		ok: false,
		error: {
			code: "cancelled",
			message: "antigravity-auth: request cancelled",
			details: {}
		}
	};
}
function safeFailure(error) {
	const credentialError = error instanceof CredentialOperationError ? error : void 0;
	const candidate = error instanceof OAuthFlowError ? error.code : credentialError?.code ?? "internal";
	const code = isSafeRpcErrorCode(candidate) ? candidate : "internal";
	return {
		ok: false,
		error: {
			code,
			message: credentialError === void 0 ? safeRpcErrorMessage(code) : credentialErrorMessage(credentialError.code) ?? safeRpcErrorMessage(code),
			details: {}
		}
	};
}
function isEmptyRecord(value) {
	return isRecord(value) && Object.keys(value).length === 0;
}
function isRefreshPayload(value) {
	return isRecord(value) && Object.keys(value).every((key) => key === "force") && (value.force === void 0 || typeof value.force === "boolean");
}
/**
* The account handle payload is closed to a single bounded string.
*
* The handle is an opaque hash the Host produced, so anything outside the shape it
* emits is a malformed request rather than an account that happens to be unknown.
*/
function isAccountHandlePayload(value) {
	return isRecord(value) && Object.keys(value).length === 1 && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 128;
}
function isAcknowledgement(value) {
	return isRecord(value) && Object.keys(value).length === 1 && value.acknowledge === true;
}
function isRevokePayload(value) {
	return isRecord(value) && Object.keys(value).length === 1 && value.confirmed === true;
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
//#endregion
//#region src/pet-balance.ts
const INK = "#1f1f1f";
const MUTED = "rgba(43,43,43,.6)";
const TRACK = "rgba(43,43,43,.12)";
/** 剩余百分比对应的进度条色彩（剩余充足为绿，剩余 <= 30% 为橙黄，剩余 <= 10% 为危急红） */
function petBarColor(remPct) {
	if (remPct <= 10) return "#e53935";
	if (remPct <= 30) return "#e8952f";
	return "#2e9e4f";
}
/** ISO 重置时间转相对倒计时文案 */
function petResetInText(iso) {
	if (!iso) return "";
	const t = new Date(iso).getTime();
	if (!Number.isFinite(t)) return "";
	const delta = t - Date.now();
	if (delta <= 0) return "已重置";
	const hoursF = delta / 36e5;
	if (hoursF >= 96) return `${(Math.round(hoursF / 24 * 10) / 10).toFixed(1)} 天重置`;
	return `${Math.max(.1, Math.round(hoursF * 10) / 10).toFixed(1)} 小时重置`;
}
/** 构建一个模型分组对应的声明式视图页 */
function createPetGroupPage(badgeLabel, pageIndex, totalPages, windows, hint) {
	const win5h = windows.find((w) => w.window === "5h");
	const winWeekly = windows.find((w) => w.window === "weekly");
	const children = [{
		tag: "div",
		style: {
			display: "flex",
			justifyContent: "space-between",
			alignItems: "center",
			marginBottom: "0.25em"
		},
		children: [{
			tag: "div",
			style: {
				display: "flex",
				alignItems: "center",
				gap: "0.3em"
			},
			children: [{
				tag: "span",
				text: "google-antigravity",
				style: {
					fontSize: "0.82em",
					fontWeight: "650",
					color: INK
				}
			}, {
				tag: "span",
				text: badgeLabel,
				style: {
					fontSize: "0.62em",
					color: "#2e9e4f",
					border: "1px solid rgba(46,158,79,.5)",
					borderRadius: "0.25em",
					padding: "0 0.25em"
				}
			}]
		}, totalPages > 1 ? {
			tag: "span",
			text: `${pageIndex + 1}/${totalPages} ›`,
			style: {
				fontSize: "0.68em",
				color: MUTED
			}
		} : { tag: "span" }]
	}];
	const validWindows = [win5h, winWeekly].filter((w) => w !== void 0);
	for (const win of validWindows) {
		const label = win.window === "5h" ? "5h 额度" : "周额度";
		const fraction = typeof win.remainingFraction === "number" ? win.remainingFraction : 1;
		const remPct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
		const color = petBarColor(remPct);
		const reset = petResetInText(win.resetTime);
		children.push({
			tag: "div",
			style: { marginTop: "0.2em" },
			children: [{
				tag: "div",
				style: {
					display: "flex",
					justifyContent: "space-between",
					alignItems: "baseline",
					gap: "0.3em"
				},
				children: [{
					tag: "span",
					text: label,
					style: {
						fontSize: "0.75em",
						color: MUTED
					}
				}, {
					tag: "span",
					text: `剩余 ${remPct}%`,
					style: {
						fontSize: "0.8em",
						fontWeight: "650",
						color: INK
					}
				}]
			}, {
				tag: "div",
				style: {
					display: "flex",
					alignItems: "center",
					gap: "0.3em",
					marginTop: "0.12em"
				},
				children: [{
					tag: "div",
					style: {
						flex: "1 1 auto",
						height: "0.3em",
						borderRadius: "0.15em",
						background: TRACK,
						overflow: "hidden"
					},
					children: [{
						tag: "i",
						style: {
							display: "block",
							height: "100%",
							width: `${remPct}%`,
							background: color
						}
					}]
				}, reset ? {
					tag: "span",
					text: reset,
					style: {
						fontSize: "0.7em",
						color: MUTED,
						whiteSpace: "nowrap"
					}
				} : { tag: "span" }]
			}]
		});
	}
	if (totalPages > 1 && hint) children.push({
		tag: "div",
		style: {
			fontSize: "0.65em",
			color: MUTED,
			marginTop: "0.3em",
			textAlign: "center"
		},
		text: hint
	});
	return {
		tag: "div",
		style: { minWidth: "13em" },
		children
	};
}
/**
* 监听 `petApi7340` 服务并在在场时注册 `google-antigravity` 自定义多页余额服务商。
*
* @param ctx 宿主 Cordis Context
* @param service Antigravity 认证服务
*/
function registerAntigravityPetBalance(ctx, service) {
	const dynamicCtx = ctx;
	dynamicCtx.inject?.(["petApi7340"], (petCtx) => {
		const unregister = petCtx.petApi7340?.balance?.register?.({
			id: "google-antigravity",
			async fetch({ provider }) {
				const usage = await service.usage();
				if (!usage || typeof usage !== "object") throw new Error("Antigravity 配额不可用");
				if (usage.state === "unauthenticated") throw new Error("Antigravity 未登录，请先在设置中完成 Google 授权");
				if (usage.state === "rate-limited") throw new Error("Antigravity 配额查询被限流，请稍后重试");
				if (usage.state === "forbidden") throw new Error("当前账号无权查询 Antigravity 配额");
				if (usage.state !== "available") throw new Error(`Antigravity 配额状态异常（${usage.state}）`);
				const groups = Array.isArray(usage.groups) ? usage.groups : [];
				if (groups.length === 0) throw new Error("Antigravity 响应缺少配额分组");
				const geminiGroup = groups.find((g) => g.group === "gemini");
				const nonGeminiGroup = groups.find((g) => g.group === "non-gemini");
				let currentModel = "";
				try {
					currentModel = ((petCtx.get?.("agentDefaultModel") ?? dynamicCtx.get?.("agentDefaultModel") ?? dynamicCtx.agentDefaultModel)?.currentSelection?.()?.model ?? "").toLowerCase();
				} catch {}
				const isGptModel = currentModel.includes("gpt") || currentModel.includes("openai");
				const isNonGemini = isGptModel || currentModel.includes("claude") || currentModel.includes("anthropic") || currentModel.includes("3p");
				const nonGeminiBadge = isGptModel ? "GPT-OSS" : "Claude";
				const groupEntries = [];
				if (isNonGemini) {
					if (nonGeminiGroup) groupEntries.push({
						group: nonGeminiGroup,
						badge: nonGeminiBadge
					});
					if (geminiGroup) groupEntries.push({
						group: geminiGroup,
						badge: "Gemini"
					});
				} else {
					if (geminiGroup) groupEntries.push({
						group: geminiGroup,
						badge: "Gemini"
					});
					if (nonGeminiGroup) groupEntries.push({
						group: nonGeminiGroup,
						badge: nonGeminiBadge
					});
				}
				for (const g of groups) if (!groupEntries.some((e) => e.group === g)) groupEntries.push({
					group: g,
					badge: g.group
				});
				const totalPages = Math.min(4, groupEntries.length);
				const views = [];
				let activeMinRemaining = 1;
				for (let i = 0; i < totalPages; i++) {
					const entry = groupEntries[i];
					const nextEntry = groupEntries[(i + 1) % totalPages];
					const hint = totalPages > 1 ? `点击切换至 ${nextEntry.badge} 额度` : "";
					views.push(createPetGroupPage(entry.badge, i, totalPages, entry.group.windows ?? [], hint));
					if (i === 0) {
						for (const win of entry.group.windows ?? []) if (typeof win.remainingFraction === "number") activeMinRemaining = Math.min(activeMinRemaining, win.remainingFraction);
					}
				}
				return {
					ok: true,
					provider,
					shape: "custom",
					data: {
						views,
						percent: Math.max(0, Math.min(100, Math.round((1 - activeMinRemaining) * 100)))
					}
				};
			}
		});
		return () => unregister?.();
	});
}
//#endregion
//#region src/index.ts
const name = "antigravity-auth";
const inject = ["llm", "attachments"];
/** Mount the Host-only OAuth service and its guarded account RPC channel. */
function apply(ctx, config = {}) {
	const initial = config.proxy || getStoredProxy();
	if (initial) applyProxySetting(initial);
	ctx.on?.("config", (nextConfig) => {
		if (nextConfig) applyProxySetting(nextConfig.proxy || getStoredProxy());
	});
	const service = createAntigravityAuthService({
		storePath: defaultAuthStorePath(),
		autoActivateGates: true,
		multiAccount: config.multiAccount !== false
	});
	let accountMode = "enabled";
	const runtime = ctx;
	/** fs is optional: a mounted filesystem only enriches offload placeholders with a recovery path. */
	const fs = runtime.reflect?.get?.("fs", false);
	const adapter = new AntigravityAdapter({
		auth: service,
		...runtime.attachments === void 0 ? {} : { attachments: runtime.attachments },
		...fs === void 0 ? {} : { fs }
	});
	const unprovide = ctx.provide?.("antigravityAuth", service) ?? (() => {});
	ctx.inject(["connection"], (connectionCtx) => {
		const webServer = connectionCtx.get("webServer");
		accountMode = commandAccountMode(webServer);
		const guard = createLoopbackRpcGuard(webServer?.host, (endpoint, payload, signal) => handleAntigravityAuthRpc(service, endpoint, payload, signal, adapter));
		if (guard.mode === "blocked") connectionCtx.logger.warn("antigravity-auth: account RPC is disabled because the WebServer is not loopback-bound");
		return registerAccountRoutes(connectionCtx.connection, ANTIGRAVITY_AUTH_RPC_NAMESPACE, [
			"status",
			"models",
			"usage",
			"select-account",
			"remove-account",
			"acknowledge-risk",
			"login",
			"cancel",
			"cancel-login",
			"logout",
			"revoke",
			"get-proxy",
			"set-proxy"
		], guard.handler);
	});
	mountCapabilityLifecycle({
		ctx,
		auth: service,
		id: "auth-llm",
		enabled: () => runtime.llm?.registerAdapter !== void 0,
		register: () => {
			if (runtime.llm?.registerAdapter === void 0) return void 0;
			if (runtime.llm.listProviders?.().some((provider) => provider.id === "google-antigravity")) return void 0;
			const dispose = runtime.llm.registerAdapter([ANTIGRAVITY_PROVIDER], adapter);
			return () => {
				try {
					dispose();
				} finally {
					adapter.invalidateModelCatalog();
				}
			};
		},
		ownsAuth: true,
		cleanup: unprovide,
		label: "antigravity-auth: OAuth and LLM operations"
	});
	ctx.inject(["commands"], (commandCtx) => commandCtx.commands.register(createAntigravityAuthCommand(service, () => accountMode)));
	registerAntigravityPetBalance(ctx, service);
}
//#endregion
export { AGY_PROVIDER_USER_AGENT, ANTIGRAVITY_AUTH_RPC_CHANNEL, ANTIGRAVITY_AUTH_RPC_NAMESPACE, ANTIGRAVITY_AVAILABLE_MODELS_ENDPOINT, ANTIGRAVITY_GENERATE_ENDPOINT, ANTIGRAVITY_LLM_ROUTE, ANTIGRAVITY_MODEL_CATALOG_STATES, ANTIGRAVITY_PLUGIN_ID, ANTIGRAVITY_PROVIDER, ANTIGRAVITY_QUOTA_ENDPOINT, ANTIGRAVITY_REPLAY_VERSION, ANTIGRAVITY_REVOKE_ENDPOINT, ANTIGRAVITY_STREAM_ENDPOINT, ANTIGRAVITY_TOKEN_ENDPOINT, ANTIGRAVITY_WIRE_ORIGIN, ANTIGRAVITY_WIRE_ORIGINS, ANTIGRAVITY_WIRE_PATHS, AUTH_POOL_VERSION, AntigravityAdapter, AntigravityAuthService, CAPABILITY_GATE_OUTCOMES, CAPABILITY_ROW_IDS, CredentialOperationError, DEFAULT_INLINE_IMAGE_BYTES, DEFAULT_PRIVATE_FRAME_BYTES, DEFAULT_PRIVATE_IDLE_TIMEOUT_MS, DEFAULT_PRIVATE_REQUEST_BYTES, DEFAULT_PRIVATE_RESPONSE_BYTES, DEFAULT_PRIVATE_RESPONSE_HEADER_TIMEOUT_MS, DEFAULT_PRIVATE_TOTAL_TIMEOUT_MS, DEFAULT_VIDEO_BYTES, DSH_ATTRIBUTION_HEADER, FAILURE_STREAK_WINDOW_MS, IMAGE_HANDLE_PATTERN, LIVE_ACKNOWLEDGEMENT, LIVE_GATE_IDS, LLM_FAMILY_IDS, MAX_PRIVATE_REQUEST_BYTES, MediaAdmissionError, PROJECT_DISCOVERY_ENDPOINT, PROJECT_DISCOVERY_PATH, PROXY_CONFIG_FILE_PATH, PrivateTransportError, ProjectDiscoveryError, QUOTA_REFRESH_MIN_INTERVAL_MS, QuotaNormalizationError, WireIdentityError, accountHandle, admitBase64Image, admitImageBytes, admitSessionImage, admitWorkspaceImage, admitWorkspaceVideo, antigravityModelFamily, apply, applyProxySetting, assertPrivateEndpoint, assertWireIdentityInvariant, buildAntigravityGeneratePayload, buildFunctionDeclarations, buildWireIdentityHeaders, compatibleReplayState, createAntigravityAuthRpcClient, createAntigravityAuthService, createAuthStorePool, createCredentialCoordinator, createFileCapabilityGates, createGoogleRefreshTransport, createGoogleRevokeTransport, createMemoryCapabilityGates, createPrivateTransport, createProjectContext, createProjectDiscovery, createQuotaService, createReplayState, createStatusView, createWireIdentity, credentialErrorMessage, decideRotation, defaultAuthPoolPath, defaultCapabilityGatePath, detectImageMediaType, effectiveFailureCount, emailTagFor, getProxyConfigFile, getStoredProxy, imageHandle, inject, isMp4, iteratePrivateSse, maskEmail, maskForStorage, migrateLegacyRecord, name, normalizeProjectId, normalizeQuotaResponse, parseModelCatalogResult, parseStatusResult, parseUsageResult, privateStatusError, readPoolFile, readPrivateBytes, readPrivateText, registerAntigravityPetBalance, rotationAttemptBudget, runLiveGateCli, sanitizeToolSchemas, scopedHttpsFetch, sessionImageCatalog, setCustomProxyConfigFile, setExplicitProxy, setStoredProxy, writePoolFile };
