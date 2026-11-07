import { t as isBoundedSafeText } from "./safe-text-AlEyN8q_.js";
import { m as scopedHttpsFetch } from "./private-transport-DUrd-Qg2.js";
import { ProjectDiscoveryError, createProjectDiscovery, normalizeProjectId } from "./project-context.js";
import { a as createStatusView, i as LLM_FAMILY_IDS, n as CAPABILITY_GATE_OUTCOMES, r as CAPABILITY_ROW_IDS } from "./status-hE_LSout.js";
import { createQuotaService } from "./quota.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ANTIGRAVITY_CLIENT_ID, ANTIGRAVITY_CLIENT_SECRET, ANTIGRAVITY_REDIRECT_URI, ANTIGRAVITY_SCOPES, calculateBackoffMs, parseRateLimitReason } from "@cortexkit/antigravity-auth-core";
import { createServer } from "node:http";
const AUTH_STORE_LOCK_NAME = ".auth.lock";
const AUTH_STORE_LOCK_TIMEOUT_MS = 1e4;
const AUTH_STORE_LOCK_STALE_MS = 3e4;
const AUTH_STORE_LOCK_RETRY_MS = 10;
var AuthStoreError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "AuthStoreError";
		this.code = code;
	}
};
/** Plugin-owned credential directory, named after the plugin id. */
const AUTH_STORE_DIRNAME = "dsh-tool-antigravity";
/** Resolve the plugin-owned default path without reading it. */
function defaultAuthStorePath(env = process.env, home = env.HOME, platform = process.platform) {
	if (platform === "win32") {
		const windowsDataHome = env.LOCALAPPDATA ?? env.APPDATA;
		const base = typeof windowsDataHome === "string" && windowsDataHome.length > 0 ? windowsDataHome : env.USERPROFILE ?? home ?? "";
		return join(base, AUTH_STORE_DIRNAME, "auth.json");
	}
	const dataHome = env.XDG_DATA_HOME;
	const base = typeof dataHome === "string" && dataHome.length > 0 ? dataHome : join(home ?? "", ".local", "share");
	return join(base, AUTH_STORE_DIRNAME, "auth.json");
}
/** Create one store whose public API never exposes an access token field. */
function createAuthStore(path, options = {}) {
	const now = options.now ?? (() => Date.now());
	const platform = options.platform ?? process.platform;
	const enqueue = createMutationQueue();
	const read = () => readAuthRecordForPlatform(path, platform);
	return {
		read,
		commit: (draft) => enqueue(() => withStoreLock(path, async () => {
			const record = makeRecord(draft, ((await read())?.revision ?? 0) + 1, now());
			await writeAuthRecord(path, record);
			return record;
		})),
		compareAndCommit: (expectedRevision, draft, expectedLineage) => enqueue(() => withStoreLock(path, async () => {
			const current = await read();
			if ((current?.revision ?? 0) !== expectedRevision) return void 0;
			const lineage = expectedLineage ?? draft.lineage;
			if (lineage === void 0 ? current?.lineage !== void 0 : current?.lineage !== lineage) return void 0;
			const record = makeRecord(draft, expectedRevision + 1, now());
			await writeAuthRecord(path, record);
			return record;
		})),
		clearIfCurrent: (expectedRevision, expectedLineage) => enqueue(() => withStoreLock(path, async () => {
			const current = await read();
			if ((current?.revision ?? 0) !== expectedRevision) return false;
			if (expectedLineage === void 0 ? current?.lineage !== void 0 : current?.lineage !== expectedLineage) return false;
			try {
				await unlink(path);
			} catch (error) {
				if (!isNotFound$1(error)) throw storeIoError();
			}
			await syncDirectory(dirname(path));
			return true;
		})),
		clear: () => enqueue(() => withStoreLock(path, async () => {
			try {
				await unlink(path);
			} catch (error) {
				if (!isNotFound$1(error)) throw storeIoError();
			}
			await syncDirectory(dirname(path));
		}))
	};
}
function createMutationQueue() {
	let mutation = Promise.resolve();
	return function enqueue(operation) {
		const next = mutation.then(operation, operation);
		mutation = next.then(() => {}, () => {});
		return next;
	};
}
async function withStoreLock(path, operation) {
	const parent = dirname(path);
	await prepareParent$1(parent);
	const lockPath = join(parent, AUTH_STORE_LOCK_NAME);
	const deadline = Date.now() + AUTH_STORE_LOCK_TIMEOUT_MS;
	while (true) try {
		const handle = await open(lockPath, "wx", 384);
		try {
			await handle.writeFile(`${process.pid}\n`, "utf8");
			await handle.sync();
			return await operation();
		} finally {
			await handle.close().catch(() => {});
			await unlink(lockPath).catch(() => {});
		}
	} catch (error) {
		if (error instanceof AuthStoreError) throw error;
		if (!isAlreadyExists$1(error)) throw storeIoError();
		await removeStaleLock$1(lockPath);
		if (Date.now() >= deadline) throw conflictError();
		await new Promise((resolve) => setTimeout(resolve, AUTH_STORE_LOCK_RETRY_MS));
	}
}
async function prepareParent$1(parent) {
	try {
		const parentInfo = await lstat(parent);
		if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory()) throw unsafePermissionsError();
	} catch (error) {
		if (!isNotFound$1(error)) throw error;
	}
	try {
		await mkdir(parent, {
			recursive: true,
			mode: 448
		});
		await chmod(parent, 448);
	} catch (error) {
		if (error instanceof AuthStoreError) throw error;
		throw storeIoError();
	}
}
async function syncDirectory(path) {
	if (process.platform === "win32") return;
	const handle = await open(path, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close().catch(() => {});
	}
}
async function removeStaleLock$1(path) {
	try {
		const info = await lstat(path);
		if (Date.now() - info.mtimeMs > AUTH_STORE_LOCK_STALE_MS) await unlink(path).catch(() => {});
	} catch (error) {
		if (!isNotFound$1(error)) return;
	}
}
async function readAuthRecord(path) {
	return readAuthRecordForPlatform(path, process.platform);
}
async function readAuthRecordForPlatform(path, platform) {
	let fileInfo;
	try {
		fileInfo = await lstat(path);
	} catch (error) {
		if (isNotFound$1(error)) return void 0;
		throw storeIoError();
	}
	if (fileInfo.isSymbolicLink() || !fileInfo.isFile()) throw unsafePermissionsError();
	await assertOwnerOnly$1(path, platform);
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch {
		throw storeIoError();
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw corruptError();
	}
	return parseRecord(parsed);
}
async function writeAuthRecord(path, record) {
	const validated = parseRecord(record);
	const parent = dirname(path);
	try {
		await prepareParent$1(parent);
		const temporary = join(parent, `.${randomUUID()}.tmp`);
		try {
			const handle = await open(temporary, "wx", 384);
			try {
				await handle.writeFile(`${JSON.stringify(validated)}\n`, "utf8");
				await handle.sync();
			} finally {
				await handle.close().catch(() => {});
			}
			await chmod(temporary, 384);
			await rename(temporary, path);
			await chmod(path, 384);
			await syncDirectory(parent);
		} catch {
			await unlink(temporary).catch(() => {});
			throw storeIoError();
		}
	} catch (error) {
		if (error instanceof AuthStoreError) throw error;
		throw storeIoError();
	}
}
function makeRecord(draft, revision, now) {
	if (!isRecord$3(draft) || !isBoundedSafeText(draft.refreshToken, 4096) || !isBoundedSafeText(draft.projectId, 4096) || draft.lineage !== void 0 && !isBoundedSafeText(draft.lineage, 4096) || !Number.isSafeInteger(revision) || revision < 1 || !Number.isFinite(now)) throw corruptError();
	return {
		version: 1,
		refreshToken: draft.refreshToken,
		projectId: draft.projectId,
		revision,
		updatedAt: new Date(now).toISOString(),
		lineage: draft.lineage ?? randomUUID(),
		...draft.email === void 0 ? {} : { email: validateEmail(draft.email) }
	};
}
function parseRecord(value) {
	if (!isRecord$3(value)) throw corruptError();
	if (value.version !== 1) throw unsupportedVersionError();
	const keys = Object.keys(value).sort();
	const required = [
		"projectId",
		"refreshToken",
		"revision",
		"updatedAt",
		"version"
	];
	const withEmail = [...required, "email"].sort();
	const withLineage = [...required, "lineage"].sort();
	const withEmailAndLineage = [
		...required,
		"email",
		"lineage"
	].sort();
	const expected = keys.length === required.length ? required : keys.includes("lineage") ? keys.includes("email") ? withEmailAndLineage : withLineage : withEmail;
	if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw corruptError();
	const refreshToken = value.refreshToken;
	const projectId = value.projectId;
	const revision = value.revision;
	const updatedAt = value.updatedAt;
	const lineage = value.lineage;
	if (!isBoundedSafeText(refreshToken, 4096) || !isBoundedSafeText(projectId, 4096) || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1 || typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt)) || lineage !== void 0 && !isBoundedSafeText(lineage, 4096)) throw corruptError();
	const email = value.email;
	if (email !== void 0 && !isBoundedSafeText(email, 4096)) throw corruptError();
	return {
		version: 1,
		refreshToken,
		projectId,
		revision,
		updatedAt,
		...email === void 0 ? {} : { email },
		...lineage === void 0 ? {} : { lineage }
	};
}
async function assertOwnerOnly$1(path, platform) {
	try {
		const file = await lstat(path);
		const parent = await lstat(dirname(path));
		const unsafePosixMode = platform !== "win32" && ((file.mode & 63) !== 0 || (parent.mode & 63) !== 0);
		if (file.isSymbolicLink() || parent.isSymbolicLink() || !parent.isDirectory() || unsafePosixMode) throw unsafePermissionsError();
	} catch (error) {
		if (error instanceof AuthStoreError) throw error;
		throw storeIoError();
	}
}
function validateEmail(value) {
	if (!isBoundedSafeText(value, 4096) || !value.includes("@")) throw corruptError();
	return value;
}
function corruptError() {
	return new AuthStoreError("AUTH_STORE_CORRUPT", "The Antigravity auth store is not valid");
}
function unsupportedVersionError() {
	return new AuthStoreError("AUTH_STORE_UNSUPPORTED_VERSION", "The Antigravity auth store version is unsupported");
}
function unsafePermissionsError() {
	return new AuthStoreError("AUTH_STORE_UNSAFE_PERMISSIONS", "The Antigravity auth store permissions are unsafe");
}
function storeIoError() {
	return new AuthStoreError("AUTH_STORE_IO", "The Antigravity auth store could not be accessed");
}
function conflictError() {
	return new AuthStoreError("AUTH_STORE_CONFLICT", "The Antigravity auth store is busy");
}
function isAlreadyExists$1(error) {
	return error?.code === "EEXIST";
}
function isNotFound$1(error) {
	return error?.code === "ENOENT";
}
function isRecord$3(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
//#endregion
//#region src/auth-store-pool.ts
/**
* Multi-account pool store implementing the single-record {@link AntigravityAuthStore}
* contract.
*
* The pool keeps every signed-in Antigravity account in one `accounts.json` file and
* projects the *active* account onto the existing single-record interface. Callers keep
* their current semantics: `compareAndCommit` on an unseen lineage appends a new account
* instead of replacing the previous one, which is what turns one login slot into a pool.
*
* Deterministic and test-friendly: the store never reads the process clock or the
* environment on its own; `now` and platform checks stay injectable exactly like the
* single-record store this replaces.
*/
const AUTH_POOL_VERSION = 1;
const POOL_LOCK_NAME = ".pool.lock";
const POOL_LOCK_TIMEOUT_MS = 1e4;
const POOL_LOCK_STALE_MS = 3e4;
const POOL_LOCK_RETRY_MS = 10;
/**
* Derive a stable, non-reversible identity tag for an account address.
*
* The salt is fixed rather than per-install: the tag only has to be stable across logins
* on the same machine, and a random salt would have to be persisted anyway. A SHA-256
* digest of a normalised address is not reversible by inspection and never appears as
* plaintext, which is what the store's privacy contract requires.
*/
function emailTagFor(email) {
	if (email === void 0) return void 0;
	const normalized = email.trim().toLowerCase();
	const at = normalized.indexOf("@");
	if (at <= 0 || at === normalized.length - 1) return void 0;
	return createHash("sha256").update(`dsh-tool-antigravity/account/${normalized}`).digest("hex");
}
/**
* Mask an account address for storage. Only the first character of the local part and the
* domain survive, so the persisted form identifies nothing on its own.
*/
function maskForStorage(email) {
	const at = email.indexOf("@");
	if (at <= 0 || at === email.length - 1) return "***";
	const local = email.slice(0, at);
	const domain = email.slice(at + 1);
	if (local.endsWith("***")) return `${local}@${domain}`;
	return `${local.slice(0, 1)}***${local.length > 1 ? local.slice(-1) : ""}@${domain}`;
}
/**
* How long a failure keeps counting toward the streak.
*
* Matches the longest cooldown the ladder can assign (two hours), so a streak only survives
* as long as the account it describes is still plausibly struggling. A failure older than
* this is treated as the start of a fresh streak.
*/
const FAILURE_STREAK_WINDOW_MS = 72e5;
/**
* The failure count that should actually drive the next backoff.
*
* The stored counter is only meaningful next to the time of its last update: an account that
* failed once three hours ago and once just now has not failed twice in a row, so the older
* entry must not inflate the ladder.
*/
function effectiveFailureCount(account, at) {
	const count = account.consecutiveFailures;
	if (count === void 0 || count <= 0) return 0;
	const last = account.lastFailureAt;
	if (last === void 0) return count;
	return at - last > 72e5 ? 0 : count;
}
/** Resolve the pool path next to the legacy single-record store. */
function defaultAuthPoolPath(authStorePath) {
	return join(dirname(authStorePath), "accounts.json");
}
/**
* Create the multi-account pool store. A missing pool file reads as empty, matching
* the single-record store's absent-file behaviour.
*/
function createAuthStorePool(path, options = {}) {
	const now = options.now ?? (() => Date.now());
	const platform = options.platform ?? process.platform;
	const family = options.family ?? (() => void 0);
	const legacyStorePath = options.legacyStorePath;
	/**
	* Read the pool, adopting a legacy single-record file when the pool itself is empty.
	*
	* The adoption is read-only: `auth.json` is never modified or deleted, so an install
	* that upgrades and then disables multi-account still finds its original file intact.
	* The first genuine write persists the adopted account into the pool.
	*/
	const loadPool = async () => {
		const pool = await readPoolFile(path, platform);
		if (pool.accounts.length > 0 || legacyStorePath === void 0) return pool;
		const legacy = await readLegacyRecord(legacyStorePath);
		return legacy === void 0 ? pool : migrateLegacyRecord(pool, legacy);
	};
	/**
	* Seed for the first write: adopting a legacy account is the one case where a mutation
	* may start from something other than the durable pool file.
	*/
	const seedFromLegacy = async () => loadPool();
	const read = async () => {
		const pool = await loadPool();
		const account = selectAccount(pool, family(), now());
		if (account === void 0) return void 0;
		return {
			version: 1,
			refreshToken: account.refreshToken,
			projectId: account.projectId,
			...account.email === void 0 ? {} : { email: account.email },
			revision: pool.revision,
			updatedAt: pool.updatedAt,
			lineage: account.lineage
		};
	};
	return {
		path,
		read,
		readPool: () => loadPool(),
		commit: (draft) => mutatePool(path, platform, (pool) => {
			const exists = pool.accounts.some((account) => account.lineage === draft.lineage);
			return {
				...pool,
				accounts: exists ? pool.accounts.map((account) => account.lineage === draft.lineage ? applyDraft(account, draft) : account) : [...pool.accounts, accountFromDraft(draft, now())],
				revision: pool.revision + 1,
				updatedAt: new Date(now()).toISOString()
			};
		}, seedFromLegacy).then((pool) => projectCommitted(pool, draft, now())),
		compareAndCommit: (expectedRevision, draft, expectedLineage) => mutatePool(path, platform, (pool) => {
			if (pool.revision !== expectedRevision) return void 0;
			if (expectedLineage !== void 0) {
				if (!pool.accounts.some((account) => account.lineage === expectedLineage)) return;
				return {
					...pool,
					accounts: pool.accounts.map((account) => account.lineage === expectedLineage ? applyDraft(account, {
						...draft,
						lineage: expectedLineage
					}) : account),
					revision: pool.revision + 1,
					updatedAt: new Date(now()).toISOString()
				};
			}
			if (draft.lineage !== void 0) return {
				...pool,
				accounts: pool.accounts.some((account) => account.lineage === draft.lineage) ? pool.accounts.map((account) => account.lineage === draft.lineage ? applyDraft(account, draft) : account) : [...pool.accounts, accountFromDraft(draft, now())],
				revision: pool.revision + 1,
				updatedAt: new Date(now()).toISOString()
			};
			const current = selectAccount(pool, family(), now());
			if (current === void 0) return {
				...pool,
				accounts: [accountFromDraft(draft, now())],
				revision: pool.revision + 1,
				updatedAt: new Date(now()).toISOString()
			};
			return {
				...pool,
				accounts: pool.accounts.map((account) => account.lineage === current.lineage ? applyDraft(account, draft) : account),
				revision: pool.revision + 1,
				updatedAt: new Date(now()).toISOString()
			};
		}, seedFromLegacy).then((pool) => pool === void 0 ? void 0 : projectCommitted(pool, draft, now())),
		clearIfCurrent: (expectedRevision, expectedLineage) => mutatePool(path, platform, (pool) => {
			const current = selectAccount(pool, family(), now());
			if (pool.revision !== expectedRevision) return false;
			if (expectedLineage === void 0 ? current?.lineage !== void 0 : current?.lineage !== expectedLineage) return false;
			const remaining = current === void 0 ? pool.accounts : pool.accounts.filter((account) => account.lineage !== current.lineage);
			return {
				...pool,
				accounts: remaining,
				activeIndex: reindexAfterRemoval(pool.activeIndex, remaining.length),
				revision: pool.revision + 1,
				updatedAt: new Date(now()).toISOString()
			};
		}, seedFromLegacy).then((result) => result !== false),
		clear: () => withPoolLock(path, async () => {
			try {
				await unlink(path);
			} catch (error) {
				if (!isNotFound(error)) throw new AuthStoreError("AUTH_STORE_IO", "The Antigravity account pool could not be cleared");
			}
		}),
		readyCount: async () => {
			const pool = await loadPool();
			const at = now();
			return pool.accounts.filter((account) => !isCooling(account, at)).length;
		},
		markCooldown: (lineage, durationMs, targetFamily) => mutatePool(path, platform, (pool) => {
			const at = now();
			const until = at + Math.max(0, durationMs);
			const accounts = pool.accounts.map((account) => {
				if (account.lineage !== lineage) return account;
				const streak = effectiveFailureCount(account, at) + 1;
				return {
					...account,
					cooldownUntil: until,
					consecutiveFailures: streak,
					lastFailureAt: at
				};
			});
			return {
				...pool,
				accounts,
				...targetFamily === void 0 ? { activeIndex: advanceIndex(pool.activeIndex, accounts.length) } : { activeIndexByFamily: {
					...pool.activeIndexByFamily ?? {},
					[targetFamily]: advanceIndex(pool.activeIndexByFamily?.[targetFamily] ?? pool.activeIndex, accounts.length)
				} },
				revision: pool.revision + 1,
				updatedAt: new Date(now()).toISOString()
			};
		}, seedFromLegacy).then(() => {}),
		setActive: (lineage) => mutatePool(path, platform, (pool) => {
			const index = pool.accounts.findIndex((account) => account.lineage === lineage);
			if (index < 0) return false;
			return {
				...pool,
				activeIndex: index,
				activeIndexByFamily: Object.fromEntries(Object.keys(pool.activeIndexByFamily ?? {}).map((family) => [family, index])),
				revision: pool.revision + 1,
				updatedAt: new Date(now()).toISOString()
			};
		}, seedFromLegacy).then((result) => result !== false),
		removeAccount: (lineage) => mutatePool(path, platform, (pool) => {
			const accounts = pool.accounts.filter((account) => account.lineage !== lineage);
			if (accounts.length === pool.accounts.length) return false;
			return {
				...pool,
				accounts,
				activeIndex: reindexAfterRemoval(pool.activeIndex, accounts.length),
				revision: pool.revision + 1,
				updatedAt: new Date(now()).toISOString()
			};
		}, seedFromLegacy).then((result) => result !== false)
	};
}
/**
* Pick the account `read()` should project.
*
* Selection is cursor-first: the family cursor (falling back to the pool cursor) names
* the preferred account, and only if that account is cooling do we scan forward. A
* per-family cursor is what keeps a Gemini-only exhaustion from rotating Claude, so the
* scan must never leak across families: it starts from this family's own cursor.
*
* When every account is cooling the cursor account is still returned, so credential
* errors surface as provider failures instead of a misleading "not logged in".
*/
function selectAccount(pool, targetFamily, at) {
	if (pool.accounts.length === 0) return void 0;
	const cursor = (targetFamily === void 0 ? void 0 : pool.activeIndexByFamily?.[targetFamily]) ?? pool.activeIndex;
	const start = Number.isSafeInteger(cursor) ? Math.max(0, cursor) % pool.accounts.length : 0;
	for (let step = 0; step < pool.accounts.length; step += 1) {
		const account = pool.accounts[(start + step) % pool.accounts.length];
		if (account !== void 0 && !isCooling(account, at)) return account;
	}
	return pool.accounts[start];
}
function isCooling(account, at) {
	return account.cooldownUntil !== void 0 && account.cooldownUntil > at;
}
function advanceIndex(index, length) {
	if (length <= 0) return 0;
	return ((Number.isSafeInteger(index) ? Math.max(0, index) : 0) + 1) % length;
}
function reindexAfterRemoval(index, length) {
	if (length <= 0) return 0;
	const base = Number.isSafeInteger(index) ? Math.max(0, index) : 0;
	return base >= length ? length - 1 : base;
}
/**
* Project the account a `compareAndCommit` just wrote.
*
* The single-record store returns the record it committed, and callers depend on that: the
* credential coordinator adopts the returned record as the credential it is about to use.
* Returning whichever account the cursor happens to point at would hand the caller a
* different account's token, so the write's own lineage is resolved instead.
*/
function projectCommitted(pool, draft, at) {
	const account = draft.lineage === void 0 ? selectAccount(pool, void 0, at) : pool.accounts.find((entry) => entry.lineage === draft.lineage);
	if (account === void 0) throw new AuthStoreError("AUTH_STORE_CONFLICT", "The committed Antigravity account is missing from the pool");
	return {
		version: 1,
		refreshToken: account.refreshToken,
		projectId: account.projectId,
		...account.email === void 0 ? {} : { email: account.email },
		revision: pool.revision,
		updatedAt: pool.updatedAt,
		lineage: account.lineage
	};
}
function applyDraft(account, draft) {
	const { cooldownUntil: _cooldown, consecutiveFailures: _failures, lastFailureAt: _lastFailure, ...rest } = account;
	const tag = emailTagFor(draft.email);
	return {
		...rest,
		refreshToken: draft.refreshToken,
		projectId: draft.projectId,
		...draft.email === void 0 ? {} : { email: maskForStorage(draft.email) },
		...tag === void 0 ? {} : { emailTag: tag }
	};
}
function accountFromDraft(draft, at) {
	const tag = emailTagFor(draft.email);
	return {
		refreshToken: draft.refreshToken,
		projectId: draft.projectId,
		...draft.email === void 0 ? {} : { email: maskForStorage(draft.email) },
		...tag === void 0 ? {} : { emailTag: tag },
		lineage: draft.lineage ?? randomUUID(),
		addedAt: new Date(at).toISOString()
	};
}
/**
* Apply one atomic pool mutation. The callback returns either a replacement pool (which
* is persisted) or one of the sentinel values `false`/`undefined` (which abort the write
* and are returned verbatim so predicates such as `clearIfCurrent` can report "no-op").
*/
/**
* Read a legacy single-record `auth.json` without creating, migrating, or modifying it.
*
* A missing file and an unreadable one are both "no legacy account": a corrupted legacy
* file must not stop the pool from working, because the pool is what the user is moving
* to and the legacy file is only a convenience.
*/
async function readLegacyRecord(path) {
	try {
		return await readAuthRecord(path);
	} catch {
		return;
	}
}
async function mutatePool(path, platform, mutate, seed) {
	return withPoolLock(path, async () => {
		const durable = await readPoolFile(path, platform);
		const next = mutate(durable.accounts.length === 0 && seed !== void 0 ? await seed() : durable);
		if (isPoolFile(next)) await writePoolFile(path, next);
		return next;
	});
}
function isPoolFile(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) && "accounts" in value && "version" in value;
}
async function readPoolFile(path, platform = process.platform) {
	let fileInfo;
	try {
		fileInfo = await lstat(path);
	} catch (error) {
		if (isNotFound(error)) return emptyPool();
		throw new AuthStoreError("AUTH_STORE_IO", "The Antigravity account pool could not be accessed");
	}
	if (fileInfo.isSymbolicLink() || !fileInfo.isFile()) throw new AuthStoreError("AUTH_STORE_UNSAFE_PERMISSIONS", "The Antigravity account pool permissions are unsafe");
	try {
		await assertOwnerOnly(path, platform);
	} catch {
		throw new AuthStoreError("AUTH_STORE_UNSAFE_PERMISSIONS", "The Antigravity account pool permissions are unsafe");
	}
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch {
		throw new AuthStoreError("AUTH_STORE_IO", "The Antigravity account pool could not be accessed");
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new AuthStoreError("AUTH_STORE_CORRUPT", "The Antigravity account pool is not valid");
	}
	return parsePool(parsed);
}
async function writePoolFile(path, pool) {
	const validated = parsePool(pool);
	const parent = dirname(path);
	try {
		await prepareParent(parent);
		const temporary = join(parent, `.${randomUUID()}.pool.tmp`);
		try {
			const handle = await open(temporary, "wx", 384);
			try {
				await handle.writeFile(`${JSON.stringify(validated)}\n`, "utf8");
				await handle.sync();
			} finally {
				await handle.close().catch(() => {});
			}
			await chmod(temporary, 384);
			await rename(temporary, path);
			await chmod(path, 384);
		} catch {
			await unlink(temporary).catch(() => {});
			throw new AuthStoreError("AUTH_STORE_IO", "The Antigravity account pool could not be written");
		}
	} catch (error) {
		if (error instanceof AuthStoreError) throw error;
		throw new AuthStoreError("AUTH_STORE_IO", "The Antigravity account pool could not be written");
	}
}
function emptyPool() {
	return {
		version: 1,
		accounts: [],
		activeIndex: 0,
		revision: 0,
		updatedAt: (/* @__PURE__ */ new Date(0)).toISOString()
	};
}
function parsePool(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw poolCorrupt();
	const record = value;
	if (record.version !== 1) throw new AuthStoreError("AUTH_STORE_UNSUPPORTED_VERSION", "The Antigravity account pool version is unsupported");
	if (!Array.isArray(record.accounts)) throw poolCorrupt();
	const accounts = [];
	for (const entry of record.accounts) accounts.push(parseAccount(entry));
	const activeIndex = Number.isSafeInteger(record.activeIndex) && record.activeIndex >= 0 ? Math.min(record.activeIndex, Math.max(0, accounts.length - 1)) : 0;
	const byFamily = record.activeIndexByFamily;
	const activeIndexByFamily = typeof byFamily === "object" && byFamily !== null && !Array.isArray(byFamily) ? Object.fromEntries(Object.entries(byFamily).filter(([, index]) => Number.isSafeInteger(index) && index >= 0).map(([key, index]) => [key, index])) : void 0;
	const updatedAt = typeof record.updatedAt === "string" && Number.isFinite(Date.parse(record.updatedAt)) ? record.updatedAt : (/* @__PURE__ */ new Date(0)).toISOString();
	const revision = Number.isSafeInteger(record.revision) && record.revision >= 0 ? record.revision : 0;
	return {
		version: 1,
		accounts: dedupeByLineage(accounts),
		activeIndex,
		revision,
		...activeIndexByFamily === void 0 ? {} : { activeIndexByFamily },
		updatedAt
	};
}
function parseAccount(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw poolCorrupt();
	const record = value;
	const refreshToken = record.refreshToken;
	const projectId = record.projectId;
	const lineage = record.lineage;
	if (!isBoundedSafeText(refreshToken, 4096) || !isBoundedSafeText(projectId, 4096) || !isBoundedSafeText(lineage, 4096)) throw poolCorrupt();
	const email = record.email;
	if (email !== void 0 && !isBoundedSafeText(email, 4096)) throw poolCorrupt();
	const emailTag = record.emailTag;
	if (emailTag !== void 0 && (typeof emailTag !== "string" || !/^[0-9a-f]{64}$/u.test(emailTag))) throw poolCorrupt();
	const addedAt = typeof record.addedAt === "string" && Number.isFinite(Date.parse(record.addedAt)) ? record.addedAt : (/* @__PURE__ */ new Date(0)).toISOString();
	const cooldownUntil = typeof record.cooldownUntil === "number" && Number.isFinite(record.cooldownUntil) ? record.cooldownUntil : void 0;
	const consecutiveFailures = Number.isSafeInteger(record.consecutiveFailures) && record.consecutiveFailures >= 0 ? record.consecutiveFailures : void 0;
	const lastFailureAt = typeof record.lastFailureAt === "number" && Number.isFinite(record.lastFailureAt) ? record.lastFailureAt : void 0;
	return {
		refreshToken,
		projectId,
		...email === void 0 ? {} : { email },
		...emailTag === void 0 ? {} : { emailTag },
		lineage,
		addedAt,
		...cooldownUntil === void 0 ? {} : { cooldownUntil },
		...consecutiveFailures === void 0 ? {} : { consecutiveFailures },
		...lastFailureAt === void 0 ? {} : { lastFailureAt }
	};
}
/** Keep the first entry per lineage: a duplicate lineage would break cursor indexing. */
function dedupeByLineage(accounts) {
	const seen = /* @__PURE__ */ new Set();
	const output = [];
	for (const account of accounts) {
		if (seen.has(account.lineage)) continue;
		seen.add(account.lineage);
		output.push(account);
	}
	return output;
}
/**
* Adopt a legacy single-record `auth.json` into an empty pool. Existing users keep
* their session: the same refresh token, project, email and lineage carry over.
*/
function migrateLegacyRecord(pool, record) {
	const lineage = record.lineage ?? randomUUID();
	if (pool.accounts.some((account) => account.lineage === lineage)) return pool;
	return {
		...pool,
		accounts: [...pool.accounts, {
			refreshToken: record.refreshToken,
			projectId: record.projectId,
			...record.email === void 0 ? {} : { email: record.email },
			lineage,
			addedAt: (/* @__PURE__ */ new Date()).toISOString()
		}],
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
}
async function withPoolLock(path, operation) {
	const parent = dirname(path);
	await prepareParent(parent);
	const lockPath = join(parent, POOL_LOCK_NAME);
	const deadline = Date.now() + POOL_LOCK_TIMEOUT_MS;
	for (;;) try {
		const handle = await open(lockPath, "wx", 384);
		try {
			await handle.writeFile(`${process.pid}\n`, "utf8");
			await handle.sync();
			return await operation();
		} finally {
			await handle.close().catch(() => {});
			await unlink(lockPath).catch(() => {});
		}
	} catch (error) {
		if (error instanceof AuthStoreError) throw error;
		if (!isAlreadyExists(error)) throw new AuthStoreError("AUTH_STORE_IO", "The Antigravity account pool could not be accessed");
		await removeStaleLock(lockPath);
		if (Date.now() >= deadline) throw new AuthStoreError("AUTH_STORE_CONFLICT", "The Antigravity account pool is busy");
		await new Promise((resolve) => setTimeout(resolve, POOL_LOCK_RETRY_MS));
	}
}
async function prepareParent(parent) {
	try {
		const info = await lstat(parent);
		if (info.isSymbolicLink() || !info.isDirectory()) throw new AuthStoreError("AUTH_STORE_UNSAFE_PERMISSIONS", "The Antigravity account pool permissions are unsafe");
	} catch (error) {
		if (!isNotFound(error)) throw error;
	}
	try {
		await mkdir(parent, {
			recursive: true,
			mode: 448
		});
		await chmod(parent, 448);
	} catch (error) {
		if (error instanceof AuthStoreError) throw error;
		throw new AuthStoreError("AUTH_STORE_IO", "The Antigravity account pool could not be accessed");
	}
}
async function removeStaleLock(path) {
	try {
		const info = await lstat(path);
		if (Date.now() - info.mtimeMs > POOL_LOCK_STALE_MS) await unlink(path).catch(() => {});
	} catch (error) {
		if (!isNotFound(error)) return;
	}
}
async function assertOwnerOnly(path, platform) {
	const file = await lstat(path);
	const parent = await lstat(dirname(path));
	const unsafePosixMode = platform !== "win32" && ((file.mode & 63) !== 0 || (parent.mode & 63) !== 0);
	if (file.isSymbolicLink() || parent.isSymbolicLink() || !parent.isDirectory() || unsafePosixMode) throw new AuthStoreError("AUTH_STORE_UNSAFE_PERMISSIONS", "The Antigravity account pool permissions are unsafe");
}
function poolCorrupt() {
	return new AuthStoreError("AUTH_STORE_CORRUPT", "The Antigravity account pool is not valid");
}
function isAlreadyExists(error) {
	return error?.code === "EEXIST";
}
function isNotFound(error) {
	return error?.code === "ENOENT";
}
//#endregion
//#region src/rotation-policy.ts
/**
* Account rotation policy for the multi-account pool.
*
* Kept deliberately small: this module decides *whether* a failure should move to the
* next account and *how long* the failed account rests. The pool store owns the cursor
* and the cooldown bookkeeping; the credential coordinator owns when a refresh failed.
*
* The distinction that matters is capacity vs. account. A 503/529 means Google is
* overloaded, which is not this account's fault, so rotating would burn every account's
* reputation for nothing. Only failures that are genuinely account-scoped rotate.
*/
/**
* Error codes meaning "this grant is dead". Both spellings appear in practice: Google's
* OAuth body uses `invalid_grant`, while this plugin's own CredentialOperationError uses
* the hyphenated `invalid-grant`.
*/
const DEAD_GRANT_CODES = /* @__PURE__ */ new Set([
	"INVALID_GRANT",
	"INVALID-GRANT",
	"UNAUTHENTICATED",
	"AUTHENTICATION",
	"RELOGIN-REQUIRED"
]);
/**
* Classify one refresh failure into a rotation decision.
*
* Callers pass whatever they know; `parseRateLimitReason` handles the provider-specific
* vocabulary so this stays a thin policy layer over the shared core.
*/
/**
* A dead grant can arrive three ways: as a structured `reason`, inside the message text,
* or as a bare 401. All three mean "this account cannot be refreshed", and rotating to
* another account would not help because the caller must sign in again.
*/
function isDeadGrant(input) {
	const code = input.reason?.toUpperCase();
	if (code !== void 0 && DEAD_GRANT_CODES.has(code)) return true;
	const message = input.message?.toUpperCase();
	if (message !== void 0 && [...DEAD_GRANT_CODES].some((dead) => message.includes(dead))) return true;
	return input.status === 401;
}
function decideRotation(input) {
	if (isDeadGrant(input)) return {
		action: "relogin",
		cooldownMs: 0,
		retryAfterMs: 0,
		reason: "UNKNOWN"
	};
	const reason = parseRateLimitReason(input.reason, input.message, input.status);
	const backoff = calculateBackoffMs(reason, input.consecutiveFailures, input.retryAfterMs ?? null, input.random);
	switch (reason) {
		case "QUOTA_EXHAUSTED":
		case "RATE_LIMIT_EXCEEDED": return {
			action: "rotate",
			cooldownMs: backoff,
			retryAfterMs: 0,
			reason
		};
		case "MODEL_CAPACITY_EXHAUSTED":
		case "SERVER_ERROR": return {
			action: "stay",
			cooldownMs: 0,
			retryAfterMs: backoff,
			reason
		};
		case "UNKNOWN": return {
			action: "rotate",
			cooldownMs: backoff,
			retryAfterMs: 0,
			reason
		};
		default: return {
			action: "rotate",
			cooldownMs: backoff,
			retryAfterMs: 0,
			reason
		};
	}
}
/**
* Bounded retry budget for one user request, so a fully exhausted pool fails promptly
* instead of cycling forever.
*/
function rotationAttemptBudget(accountCount) {
	return Math.max(1, accountCount);
}
//#endregion
//#region src/credential-coordinator.ts
const ANTIGRAVITY_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const ANTIGRAVITY_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const DEFAULT_REFRESH_LEAD_MS = 3e4;
const DEFAULT_OPERATION_TIMEOUT_MS = 1e4;
const MAX_REFRESH_ATTEMPTS = 2;
const MAX_RESPONSE_BYTES = 65536;
const MAX_EXPIRES_IN_SECONDS = 31536e3;
var CredentialOperationError = class extends Error {
	code;
	constructor(code, message = credentialErrorMessage(code) ?? "The Antigravity credential operation failed") {
		super(message);
		this.name = "CredentialOperationError";
		this.code = code;
	}
};
function createCredentialCoordinator(options) {
	const now = options.now ?? (() => Date.now());
	const refreshAccessToken = options.refreshToken ?? createGoogleRefreshTransport(options.fetchImpl ?? scopedHttpsFetch, now);
	const revokeGrant = options.revokeGrant ?? createGoogleRevokeTransport(options.fetchImpl ?? scopedHttpsFetch);
	const refreshLeadMs = Math.max(0, options.refreshLeadMs ?? DEFAULT_REFRESH_LEAD_MS);
	const operationTimeoutMs = Math.max(1, options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS);
	const onRefreshFailure = options.onRefreshFailure;
	let cached;
	let observedRevision = 0;
	let observedLineage;
	let state = "logged-out";
	let errorCode;
	let lastRefreshAt;
	let refreshFlight;
	let revokeFlight;
	let revokeStatus = { state: "idle" };
	let generation = 0;
	let disposed = false;
	const lifecycleAbort = new AbortController();
	const operations = /* @__PURE__ */ new Set();
	const coordinator = {
		credential: async (signal, credentialOptions) => {
			ensureNotDisposed();
			if (signal?.aborted === true) throw new CredentialOperationError("cancelled");
			const record = await options.store.read();
			if (record === void 0) {
				clearObservedCredential();
				return;
			}
			observe(record);
			if (state === "re-login-required") return void 0;
			if (credentialOptions?.forceRefresh !== true && cached !== void 0 && sameRecord(cached, record) && isFresh(cached.value, now(), refreshLeadMs)) {
				state = "logged-in";
				errorCode = void 0;
				return await waitForCaller(Promise.resolve(cached.value), signal);
			}
			if (refreshFlight === void 0) {
				const flight = refreshCredential(generation);
				refreshFlight = flight;
				flight.then(() => clearRefreshFlight(flight), () => clearRefreshFlight(flight));
			}
			return await waitForCaller(refreshFlight, signal);
		},
		replaceFromLogin: (credential, record) => {
			if (disposed) return;
			generation += 1;
			abortOperations();
			cached = {
				value: { ...credential },
				revision: record.revision,
				...record.lineage === void 0 ? {} : { lineage: record.lineage }
			};
			observedRevision = record.revision;
			observedLineage = record.lineage;
			state = "logged-in";
			errorCode = void 0;
			lastRefreshAt = void 0;
			revokeStatus = { state: "idle" };
			refreshFlight = void 0;
			revokeFlight = void 0;
		},
		invalidateCache: () => {
			if (disposed) return;
			cached = void 0;
			lastRefreshAt = void 0;
		},
		status: async () => {
			ensureNotDisposed();
			const record = await options.store.read();
			if (record === void 0) clearObservedCredential();
			else observe(record);
			return makeCredentialStatus(record);
		},
		revokeStatus: () => ({ ...revokeStatus }),
		logout: async () => {
			ensureNotDisposed();
			generation += 1;
			const logoutGeneration = generation;
			abortOperations();
			refreshFlight = void 0;
			revokeFlight = void 0;
			cached = void 0;
			observedRevision = 0;
			observedLineage = void 0;
			const record = await options.store.read();
			if (!isActive(logoutGeneration)) return { state: "logged-out" };
			let cleared = true;
			if (record !== void 0) cleared = await options.store.clearIfCurrent(record.revision, record.lineage);
			if (!isActive(logoutGeneration)) return { state: "logged-out" };
			if (!cleared) {
				const latest = await options.store.read();
				if (!isActive(logoutGeneration)) return { state: "logged-out" };
				if (latest === void 0) {
					clearObservedCredential();
					revokeStatus = { state: "logged-out" };
				} else observe(latest);
				return { state: "logged-out" };
			}
			state = "logged-out";
			errorCode = void 0;
			lastRefreshAt = void 0;
			revokeStatus = { state: "logged-out" };
			return { state: "logged-out" };
		},
		revoke: async (confirmed, signal) => {
			ensureNotDisposed();
			if (!confirmed) {
				revokeStatus = { state: "confirmation-required" };
				return { state: "confirmation-required" };
			}
			if (signal?.aborted === true) throw new CredentialOperationError("cancelled");
			if (revokeFlight !== void 0) return await waitForCaller(revokeFlight, signal);
			generation += 1;
			abortOperations();
			refreshFlight = void 0;
			const revokeGeneration = generation;
			const record = await options.store.read();
			if (!isActive(revokeGeneration)) return { state: "superseded" };
			if (record === void 0) {
				clearObservedCredential();
				revokeStatus = { state: "logged-out" };
				return { state: "logged-out" };
			}
			revokeStatus = { state: "pending" };
			const flight = revokeCredential(record, revokeGeneration);
			revokeFlight = flight;
			flight.then(() => clearRevokeFlight(flight), () => clearRevokeFlight(flight));
			return await waitForCaller(flight, signal);
		},
		dispose: async () => {
			if (disposed) return;
			disposed = true;
			generation += 1;
			lifecycleAbort.abort(new CredentialOperationError("cancelled", "The Antigravity credential service was disposed"));
			abortOperations();
			refreshFlight = void 0;
			revokeFlight = void 0;
			cached = void 0;
			operations.clear();
		}
	};
	function ensureNotDisposed() {
		if (disposed) throw new CredentialOperationError("cancelled", "The Antigravity credential service is unavailable");
	}
	function beginOperation() {
		const controller = new AbortController();
		operations.add(controller);
		if (lifecycleAbort.signal.aborted) controller.abort(lifecycleAbort.signal.reason);
		return controller;
	}
	function endOperation(controller) {
		operations.delete(controller);
	}
	function abortOperations() {
		for (const controller of operations) controller.abort(new CredentialOperationError("cancelled"));
		operations.clear();
	}
	function clearRefreshFlight(flight) {
		if (refreshFlight === flight) refreshFlight = void 0;
	}
	function clearRevokeFlight(flight) {
		if (revokeFlight === flight) revokeFlight = void 0;
	}
	function clearObservedCredential() {
		cached = void 0;
		observedRevision = 0;
		observedLineage = void 0;
		if (!disposed) {
			state = "logged-out";
			errorCode = void 0;
			lastRefreshAt = void 0;
		}
	}
	function observe(record) {
		const lineageChanged = observedRevision !== 0 && observedLineage !== record.lineage;
		if (observedRevision !== 0 && (observedRevision !== record.revision || lineageChanged)) {
			cached = void 0;
			state = "logged-in";
			errorCode = void 0;
			lastRefreshAt = void 0;
		}
		observedRevision = record.revision;
		observedLineage = record.lineage;
		if (state === "logged-out") state = "logged-in";
	}
	function isFresh(credential, timestamp, lead) {
		return Number.isFinite(credential.expiresAt) && credential.expiresAt - timestamp > lead;
	}
	function sameRecord(value, record) {
		return value.revision === record.revision && value.lineage === record.lineage;
	}
	function makeCredentialStatus(record) {
		const configured = record !== void 0;
		const expiresAt = cached === void 0 ? void 0 : new Date(cached.value.expiresAt).toISOString();
		return {
			state: configured ? state : "logged-out",
			configured,
			...expiresAt === void 0 ? {} : { expiresAt },
			...lastRefreshAt === void 0 ? {} : { lastRefreshAt: new Date(lastRefreshAt).toISOString() },
			...errorCode === void 0 ? {} : { errorCode }
		};
	}
	async function refreshCredential(startGeneration) {
		if (disposed || startGeneration !== generation) return void 0;
		let record = await options.store.read();
		if (!isActive(startGeneration)) return void 0;
		if (record === void 0) {
			clearObservedCredential();
			return;
		}
		observe(record);
		if (state === "re-login-required") return void 0;
		for (let attempt = 0; attempt < MAX_REFRESH_ATTEMPTS; attempt += 1) {
			if (!isActive(startGeneration)) return void 0;
			state = "refreshing";
			errorCode = void 0;
			const operation = beginOperation();
			let result;
			try {
				result = await runBounded((signal) => refreshAccessToken({
					refreshToken: record.refreshToken,
					signal
				}), operation, operationTimeoutMs);
				validateRefreshResult(result);
			} catch (error) {
				endOperation(operation);
				if (!isActive(startGeneration) || isCancelled(error)) return void 0;
				setRefreshFailure(error);
				return;
			}
			endOperation(operation);
			if (!isActive(startGeneration)) return void 0;
			const current = await options.store.read();
			if (!isActive(startGeneration)) return void 0;
			const responseRefreshToken = result.refreshToken ?? record.refreshToken;
			if (current === void 0) {
				clearObservedCredential();
				return;
			}
			if (sameLineage(current, record) && current.revision !== record.revision) {
				if (current.refreshToken === responseRefreshToken) return adoptRefreshedCredential(result, current, startGeneration);
				record = current;
				observe(record);
				continue;
			}
			if (!sameLineage(current, record)) {
				record = current;
				observe(record);
				continue;
			}
			const committed = await options.store.compareAndCommit(record.revision, {
				refreshToken: responseRefreshToken,
				projectId: record.projectId,
				...record.email === void 0 ? {} : { email: record.email },
				...record.lineage === void 0 ? {} : { lineage: record.lineage }
			}, record.lineage);
			if (committed !== void 0) return adoptRefreshedCredential(result, committed, startGeneration);
			const latest = await options.store.read();
			if (!isActive(startGeneration)) return void 0;
			if (latest === void 0) {
				clearObservedCredential();
				return;
			}
			if (latest.refreshToken === responseRefreshToken && sameLineage(latest, record)) return adoptRefreshedCredential(result, latest, startGeneration);
			record = latest;
			observe(record);
		}
		if (isActive(startGeneration)) {
			state = "refresh-failed";
			errorCode = "conflict";
		}
	}
	async function adoptRefreshedCredential(result, record, startGeneration) {
		if (!isActive(startGeneration)) return void 0;
		const credential = {
			accessToken: result.accessToken,
			refreshToken: result.refreshToken ?? record.refreshToken,
			expiresAt: result.expiresAt,
			projectId: record.projectId
		};
		cached = {
			value: credential,
			revision: record.revision,
			...record.lineage === void 0 ? {} : { lineage: record.lineage }
		};
		observedRevision = record.revision;
		observedLineage = record.lineage;
		state = "logged-in";
		errorCode = void 0;
		lastRefreshAt = now();
		return { ...credential };
	}
	async function revokeCredential(record, revokeGeneration) {
		const operation = beginOperation();
		try {
			await runBounded((signal) => revokeGrant({
				token: record.refreshToken,
				signal
			}), operation, operationTimeoutMs);
		} catch (error) {
			endOperation(operation);
			if (!isActive(revokeGeneration) || isCancelled(error)) return { state: "superseded" };
			const code = toRevokeErrorCode(error);
			revokeStatus = {
				state: "failed",
				errorCode: code
			};
			return {
				state: "failed",
				errorCode: code
			};
		}
		endOperation(operation);
		if (!isActive(revokeGeneration)) return { state: "superseded" };
		let cleared;
		try {
			cleared = await options.store.clearIfCurrent(record.revision, record.lineage);
		} catch {
			if (!isActive(revokeGeneration)) return { state: "superseded" };
			revokeStatus = {
				state: "failed",
				errorCode: "storage"
			};
			return {
				state: "failed",
				errorCode: "storage"
			};
		}
		if (!isActive(revokeGeneration)) return { state: "superseded" };
		if (!cleared) {
			revokeStatus = { state: "superseded" };
			return { state: "superseded" };
		}
		cached = void 0;
		observedRevision = 0;
		observedLineage = void 0;
		state = "logged-out";
		errorCode = void 0;
		lastRefreshAt = void 0;
		revokeStatus = { state: "revoked" };
		return { state: "revoked" };
	}
	function isActive(expectedGeneration) {
		return !disposed && expectedGeneration === generation;
	}
	function setRefreshFailure(error) {
		const code = error instanceof CredentialOperationError ? error.code : "network";
		state = code === "invalid-grant" ? "re-login-required" : "refresh-failed";
		errorCode = code;
		cached = void 0;
		reportFailure(error);
	}
	/**
	* Forward one refresh failure to the rotation hook, if one was provided.
	*
	* Fire-and-forget by design. The credential result the caller observes must stay the
	* provider error; whether the pool managed to bench the account is bookkeeping.
	*/
	function reportFailure(error) {
		if (onRefreshFailure === void 0) return;
		const code = error instanceof CredentialOperationError ? error.code : "network";
		const status = code === "rate-limited" ? 429 : code === "server-error" ? 503 : code === "invalid-grant" ? 400 : void 0;
		try {
			Promise.resolve(onRefreshFailure({
				message: code,
				...status === void 0 ? {} : { status }
			})).catch(() => {});
		} catch {}
	}
	function sameLineage(left, right) {
		if (left.lineage !== void 0 || right.lineage !== void 0) return left.lineage === right.lineage;
		return left.revision === right.revision;
	}
	function toRevokeErrorCode(error) {
		const code = error instanceof CredentialOperationError ? error.code : "network";
		if (code === "invalid-grant" || code === "conflict" || code === "cancelled") return "http-error";
		return code;
	}
	return coordinator;
}
function createGoogleRefreshTransport(fetchImpl = scopedHttpsFetch, now = () => Date.now()) {
	return async ({ refreshToken, signal }) => {
		let response;
		try {
			response = await fetchImpl(ANTIGRAVITY_TOKEN_ENDPOINT, {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Accept: "application/json"
				},
				body: new URLSearchParams({
					client_id: ANTIGRAVITY_CLIENT_ID,
					client_secret: ANTIGRAVITY_CLIENT_SECRET,
					grant_type: "refresh_token",
					refresh_token: refreshToken
				}),
				signal
			});
		} catch (error) {
			if (isAbortError(error)) throw new CredentialOperationError("cancelled");
			throw new CredentialOperationError("network");
		}
		if (!response.ok && (response.status === 429 || response.status >= 500)) throw responseError(response.status);
		const body = await readJsonBody(response);
		if (!response.ok) throw responseError(response.status, body);
		if (!isRecord$2(body) || typeof body.access_token !== "string" || !isBoundedSafeText(body.access_token, 4096)) throw new CredentialOperationError("invalid-response");
		const expiresIn = body.expires_in;
		if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0 || expiresIn > MAX_EXPIRES_IN_SECONDS) throw new CredentialOperationError("invalid-response");
		const nextRefreshToken = body.refresh_token;
		if (nextRefreshToken !== void 0 && (typeof nextRefreshToken !== "string" || !isBoundedSafeText(nextRefreshToken, 4096))) throw new CredentialOperationError("invalid-response");
		return {
			accessToken: body.access_token,
			expiresAt: now() + expiresIn * 1e3,
			...nextRefreshToken === void 0 ? {} : { refreshToken: nextRefreshToken }
		};
	};
}
function createGoogleRevokeTransport(fetchImpl = scopedHttpsFetch) {
	return async ({ token, signal }) => {
		let response;
		try {
			response = await fetchImpl(ANTIGRAVITY_REVOKE_ENDPOINT, {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Accept: "*/*"
				},
				body: new URLSearchParams({ token }),
				signal
			});
		} catch (error) {
			if (isAbortError(error)) throw new CredentialOperationError("cancelled");
			throw new CredentialOperationError("network");
		}
		if (!response.ok) throw responseError(response.status);
	};
}
async function runBounded(operation, parent, timeoutMs) {
	const controller = new AbortController();
	let timer;
	let removeParentAbort;
	const operationPromise = Promise.resolve().then(() => operation(controller.signal));
	operationPromise.catch(() => {});
	const timeoutPromise = new Promise((_, reject) => {
		timer = setTimeout(() => {
			controller.abort(new CredentialOperationError("timeout"));
			reject(new CredentialOperationError("timeout"));
		}, timeoutMs);
	});
	const abortPromise = new Promise((_, reject) => {
		const abort = () => {
			controller.abort(parent.signal.reason);
			reject(new CredentialOperationError("cancelled"));
		};
		removeParentAbort = () => parent.signal.removeEventListener("abort", abort);
		if (parent.signal.aborted) abort();
		else parent.signal.addEventListener("abort", abort, { once: true });
	});
	try {
		return await Promise.race([
			operationPromise,
			timeoutPromise,
			abortPromise
		]);
	} finally {
		if (timer !== void 0) clearTimeout(timer);
		removeParentAbort?.();
		controller.abort();
	}
}
async function waitForCaller(promise, signal) {
	if (signal === void 0) return await promise;
	if (signal.aborted) throw new CredentialOperationError("cancelled");
	return await new Promise((resolve, reject) => {
		let settled = false;
		const abort = () => {
			if (settled) return;
			settled = true;
			reject(new CredentialOperationError("cancelled"));
		};
		signal.addEventListener("abort", abort, { once: true });
		promise.then((value) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", abort);
			resolve(value);
		}, (error) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", abort);
			reject(error);
		});
	});
}
async function readJsonBody(response) {
	const length = response.headers.get("content-length");
	if (length !== null && Number.isFinite(Number(length)) && Number(length) > MAX_RESPONSE_BYTES) throw new CredentialOperationError("invalid-response");
	let text;
	try {
		text = await response.text();
	} catch {
		throw new CredentialOperationError("invalid-response");
	}
	if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new CredentialOperationError("invalid-response");
	if (text.length === 0) return {};
	try {
		return JSON.parse(text);
	} catch {
		throw new CredentialOperationError("invalid-response");
	}
}
function responseError(status, body) {
	if (status === 400 && isRecord$2(body) && body.error === "invalid_grant") return new CredentialOperationError("invalid-grant");
	if (status === 408 || status === 504) return new CredentialOperationError("timeout");
	if (status === 429) return new CredentialOperationError("rate-limited");
	if (status >= 500 && status <= 599) return new CredentialOperationError("server-error");
	return new CredentialOperationError("http-error");
}
function validateRefreshResult(value) {
	if (!isRecord$2(value) || typeof value.accessToken !== "string" || !isBoundedSafeText(value.accessToken, 4096) || typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt)) throw new CredentialOperationError("invalid-response");
	if (value.refreshToken !== void 0 && (typeof value.refreshToken !== "string" || !isBoundedSafeText(value.refreshToken, 4096))) throw new CredentialOperationError("invalid-response");
}
function isCancelled(error) {
	return error instanceof CredentialOperationError && error.code === "cancelled";
}
function isAbortError(error) {
	return error instanceof Error && error.name === "AbortError";
}
function credentialErrorMessage(code) {
	switch (code) {
		case "invalid-grant": return "The Antigravity grant requires login again";
		case "timeout": return "The Antigravity authentication request timed out";
		case "rate-limited": return "The Antigravity authentication service is rate-limited";
		case "server-error": return "The Antigravity authentication service is unavailable";
		case "network": return "The Antigravity authentication request failed";
		case "invalid-response": return "The Antigravity authentication response was invalid";
		case "conflict": return "The Antigravity credential changed while it was refreshing";
		case "storage": return "The Antigravity credential store failed";
		case "cancelled": return "The Antigravity authentication request was cancelled";
		case "http-error": return "The Antigravity authentication service rejected the request";
		default: return;
	}
}
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
//#endregion
//#region src/oauth-flow.ts
/** Host-only PKCE, loopback callback, and token-exchange coordinator. */
const ANTIGRAVITY_CALLBACK_PORT = 51121;
const ANTIGRAVITY_CALLBACK_HOSTS = Object.freeze([
	`localhost:${String(ANTIGRAVITY_CALLBACK_PORT)}`,
	`127.0.0.1:${String(ANTIGRAVITY_CALLBACK_PORT)}`,
	`[::1]:${String(ANTIGRAVITY_CALLBACK_PORT)}`,
	"localhost",
	"127.0.0.1",
	"[::1]"
]);
const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const MAX_CALLBACK_VALUE_LENGTH = 4096;
const MAX_TOKEN_RESPONSE_BYTES = 65536;
const EMPTY_RESPONSE_HEADERS = Object.freeze({
	"Cache-Control": "no-store",
	"Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
	"Content-Type": "text/html; charset=utf-8",
	"X-Content-Type-Options": "nosniff"
});
var OAuthFlowError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "OAuthFlowError";
		this.code = code;
	}
};
/** Create one process-local, one-shot OAuth flow. */
function createOAuthFlow(options = {}) {
	const clock = options.clock ?? systemClock();
	const random = options.randomBytes ?? ((size) => randomBytes(size));
	const listenerFactory = options.listenerFactory ?? createNodeLoopbackListenerFactory();
	const exchangeCode = options.exchangeCode ?? createGoogleTokenExchanger(options.fetchImpl ?? scopedHttpsFetch, clock);
	const validateProject = options.validateProject ?? (async () => void 0);
	const commit = options.commit ?? (async () => {});
	const ttlMs = options.ttlMs ?? 3e5;
	let pending;
	let processing;
	let generation = 0;
	let committingGeneration;
	let currentStatus = { phase: "idle" };
	let disposed = false;
	let listenerClosing = Promise.resolve();
	const closeListener = (candidate) => {
		const listener = candidate.listener;
		candidate.listener = void 0;
		if (listener === void 0) return listenerClosing;
		listenerClosing = listenerClosing.then(() => Promise.resolve(listener.close()).catch(() => {}), () => Promise.resolve(listener.close()).catch(() => {}));
		return listenerClosing;
	};
	const flow = {
		generation: () => committingGeneration ?? generation,
		start: async () => {
			if (disposed) throw new OAuthFlowError("internal", "The OAuth flow is unavailable");
			if (pending !== void 0) await cancelPending(pending, "cancelled");
			if (processing !== void 0) {
				if (!processing.commitStarted) processing.controller.abort(new OAuthFlowError("cancelled", "The OAuth login was cancelled"));
				processing = void 0;
			}
			const verifier = encodeBase64Url(randomBytes$1(random, 32));
			const state = encodeBase64Url(randomBytes$1(random, 32));
			const authorizationUrl = buildAuthorizationUrl(state, verifier);
			const expiresAt = clock.now() + ttlMs;
			const controller = new AbortController();
			const candidateGeneration = generation + 1;
			generation = candidateGeneration;
			const candidate = {
				authorizationUrl,
				expiresAt,
				state,
				verifier,
				controller,
				generation: candidateGeneration,
				timeout: clock.setTimeout(() => {
					expire(candidate);
				}, ttlMs),
				active: true,
				commitStarted: false
			};
			pending = candidate;
			currentStatus = {
				phase: "pending",
				authorizationUrl,
				expiresAt: new Date(expiresAt).toISOString()
			};
			try {
				await listenerClosing;
				if (!candidate.active || pending !== candidate) throw new OAuthFlowError("cancelled", "The OAuth login was cancelled");
				candidate.listener = await listenerFactory.listen((request) => handleLoopbackRequest(request));
				if (!candidate.active || pending !== candidate) {
					await closeListener(candidate);
					throw new OAuthFlowError("cancelled", "The OAuth login was cancelled");
				}
			} catch (error) {
				clock.clearTimeout(candidate.timeout);
				if (pending === candidate) pending = void 0;
				candidate.active = false;
				const safe = asListenerError(error);
				updateStatus(candidate, {
					phase: safe.code === "port-conflict" ? "port-conflict" : "failed",
					errorCode: safe.code
				});
				throw safe;
			}
			return {
				started: true,
				phase: "pending",
				authorizationUrl,
				expiresAt: new Date(expiresAt).toISOString()
			};
		},
		status: () => currentStatus,
		completeCallbackUrl: async (callbackUrl) => {
			if (typeof callbackUrl !== "string" || callbackUrl.length === 0 || callbackUrl.length > MAX_CALLBACK_VALUE_LENGTH) throw new OAuthFlowError("invalid-callback-url", "The callback URL is invalid");
			let parsed;
			try {
				parsed = new URL(callbackUrl);
			} catch {
				throw new OAuthFlowError("invalid-callback-url", "The callback URL is invalid");
			}
			if (parsed.protocol !== "http:" || parsed.username.length > 0 || parsed.password.length > 0 || parsed.hash.length > 0) throw new OAuthFlowError("invalid-callback-url", "The callback URL is invalid");
			return completeCallback({
				method: "GET",
				host: parsed.host,
				url: `${parsed.pathname}${parsed.search}`
			});
		},
		cancel: async () => {
			if (pending !== void 0) await cancelPending(pending, "cancelled");
			if (processing !== void 0) {
				const active = processing;
				if (active.commitStarted) return currentStatus;
				active.controller.abort(new OAuthFlowError("cancelled", "The OAuth login was cancelled"));
				updateStatus(active, {
					phase: "cancelled",
					errorCode: "cancelled"
				});
				return currentStatus;
			}
			return currentStatus;
		},
		dispose: async () => {
			if (disposed) return;
			disposed = true;
			if (pending !== void 0) await cancelPending(pending, "cancelled");
			if (processing !== void 0) {
				if (!processing.commitStarted) processing.controller.abort(new OAuthFlowError("cancelled", "The OAuth login was cancelled"));
				processing = void 0;
			}
			await listenerClosing;
		}
	};
	async function completeCallback(request) {
		if (disposed) throw new OAuthFlowError("internal", "The OAuth flow is unavailable");
		const candidate = pending;
		if (candidate === void 0 || !candidate.active) throw noPendingError(currentStatus);
		assertCallbackRequest(request);
		const callback = parseCallback(request.url);
		if (callback.state !== candidate.state) throw new OAuthFlowError("state-mismatch", "The OAuth callback state was not accepted");
		candidate.active = false;
		pending = void 0;
		processing = candidate;
		clock.clearTimeout(candidate.timeout);
		closeListener(candidate);
		if (callback.error !== void 0) {
			processing = void 0;
			candidate.controller.abort(new OAuthFlowError("oauth-error", "The OAuth provider rejected authorization"));
			updateStatus(candidate, {
				phase: "failed",
				errorCode: "oauth-error"
			});
			return {
				completed: false,
				phase: "failed",
				errorCode: "oauth-error"
			};
		}
		if (callback.code === void 0) {
			processing = void 0;
			updateStatus(candidate, {
				phase: "failed",
				errorCode: "missing-code"
			});
			return {
				completed: false,
				phase: "failed",
				errorCode: "missing-code"
			};
		}
		const operation = combineSignals(candidate.controller.signal);
		try {
			const token = await exchangeCode({
				code: callback.code,
				verifier: candidate.verifier,
				signal: operation.signal
			});
			if (operation.signal.aborted) throw new OAuthFlowError("cancelled", "The OAuth login was cancelled");
			assertToken(token);
			let project;
			try {
				project = await validateProject(token.accessToken, operation.signal);
			} catch (error) {
				if (operation.signal.aborted) throw new OAuthFlowError("cancelled", "The OAuth login was cancelled");
				if (error instanceof ProjectDiscoveryError) {
					if (error.code === "cancelled") throw new OAuthFlowError("cancelled", "The OAuth login was cancelled");
					throw new OAuthFlowError(projectErrorCode(error.code), projectErrorMessage(error.code));
				}
				throw error instanceof OAuthFlowError ? error : new OAuthFlowError("project-validation-failed", "Project validation failed");
			}
			if (operation.signal.aborted) throw new OAuthFlowError("cancelled", "The OAuth login was cancelled");
			if (project === void 0) throw new OAuthFlowError("project-unavailable", "No usable project is available for this account");
			project = normalizeProject(project);
			try {
				if (operation.signal.aborted) throw new OAuthFlowError("cancelled", "The OAuth login was cancelled");
				candidate.commitStarted = true;
				committingGeneration = candidate.generation;
				try {
					await commit(token, project, operation.signal);
				} finally {
					committingGeneration = void 0;
				}
			} catch (error) {
				if (operation.signal.aborted) throw new OAuthFlowError("cancelled", "The OAuth login was cancelled");
				throw error instanceof OAuthFlowError ? error : new OAuthFlowError("persistence-failed", "The login could not be saved");
			}
			updateStatus(candidate, { phase: "success" });
			return {
				completed: true,
				phase: "success"
			};
		} catch (error) {
			const safe = classifyCompletionError(error, candidate.controller.signal);
			if (safe.code === "cancelled") {
				updateStatus(candidate, {
					phase: "cancelled",
					errorCode: "cancelled"
				});
				return {
					completed: false,
					phase: "cancelled",
					errorCode: "cancelled"
				};
			}
			updateStatus(candidate, {
				phase: "failed",
				errorCode: safe.code
			});
			return {
				completed: false,
				phase: "failed",
				errorCode: safe.code
			};
		} finally {
			operation.cleanup();
			if (processing === candidate) processing = void 0;
		}
	}
	async function handleLoopbackRequest(request) {
		try {
			const result = await completeCallback(request);
			if (result.completed) return callbackResponse(200, "success");
			return callbackResponse(result.phase === "cancelled" ? 409 : 400, result.errorCode);
		} catch (error) {
			const safe = error instanceof OAuthFlowError ? error : new OAuthFlowError("internal", "The callback could not be processed");
			return callbackResponse(callbackStatus(safe.code), safe.code);
		}
	}
	async function expire(candidate) {
		if (pending !== candidate || !candidate.active) return;
		await cancelPending(candidate, "expired");
	}
	async function cancelPending(candidate, phase) {
		if (!candidate.active && pending !== candidate) return;
		candidate.active = false;
		if (pending === candidate) pending = void 0;
		clock.clearTimeout(candidate.timeout);
		candidate.controller.abort(new OAuthFlowError(phase, phase === "expired" ? "The OAuth login expired" : "The OAuth login was cancelled"));
		await closeListener(candidate);
		updateStatus(candidate, {
			phase,
			errorCode: phase
		});
	}
	function updateStatus(candidate, status) {
		if (candidate.generation === generation) currentStatus = status;
	}
	return flow;
}
/** Create the production loopback listener; it never binds a non-loopback address. */
function createNodeLoopbackListenerFactory() {
	return { listen: (handler) => new Promise((resolve, reject) => {
		const server = createServer((request, response) => {
			serveRequest(handler, request, response);
		});
		let settled = false;
		const onError = (error) => {
			if (!settled) {
				settled = true;
				reject(error);
			}
		};
		server.once("error", onError);
		server.listen(ANTIGRAVITY_CALLBACK_PORT, "127.0.0.1", () => {
			settled = true;
			server.removeListener("error", onError);
			resolve({ close: () => new Promise((resolveClose, rejectClose) => {
				if (!server.listening) {
					resolveClose();
					return;
				}
				server.close((error) => error === void 0 ? resolveClose() : rejectClose(error));
			}) });
		});
	}) };
}
/** Build the authorization URL without ever putting the verifier in browser state. */
function buildAuthorizationUrl(state, verifier) {
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	const url = new URL(AUTHORIZATION_ENDPOINT);
	url.searchParams.set("client_id", ANTIGRAVITY_CLIENT_ID);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("redirect_uri", ANTIGRAVITY_REDIRECT_URI);
	url.searchParams.set("scope", ANTIGRAVITY_SCOPES.join(" "));
	url.searchParams.set("code_challenge", challenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("state", state);
	url.searchParams.set("access_type", "offline");
	url.searchParams.set("prompt", "consent");
	return url.toString();
}
/** Testable Google token exchange; response bodies are parsed only in Host memory. */
function createGoogleTokenExchanger(fetchImpl = scopedHttpsFetch, clock = systemClock()) {
	return async ({ code, verifier, signal }) => {
		const response = await fetchImpl(TOKEN_ENDPOINT, {
			method: "POST",
			headers: {
				Accept: "*/*",
				"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
			},
			body: new URLSearchParams({
				client_id: ANTIGRAVITY_CLIENT_ID,
				client_secret: ANTIGRAVITY_CLIENT_SECRET,
				code,
				code_verifier: verifier,
				grant_type: "authorization_code",
				redirect_uri: ANTIGRAVITY_REDIRECT_URI
			}),
			signal
		});
		if (!response.ok) {
			try {
				await response.body?.cancel();
			} catch {}
			throw new OAuthFlowError("token-exchange-failed", "The authorization code could not be exchanged");
		}
		const payload = await readJsonBounded(response, signal);
		if (!isRecord$1(payload) || typeof payload.access_token !== "string" || payload.access_token.length === 0 || typeof payload.refresh_token !== "string" || payload.refresh_token.length === 0) throw new OAuthFlowError("token-exchange-failed", "The token response was not accepted");
		const expiresIn = typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in) && payload.expires_in > 0 ? payload.expires_in : 3600;
		return {
			accessToken: payload.access_token,
			refreshToken: payload.refresh_token,
			expiresAt: clock.now() + expiresIn * 1e3,
			...emailFromTokenResponse(payload)
		};
	};
}
/**
* Extract the account address from a token response, preferring a top-level `email` and
* falling back to the `id_token` claims where Google actually puts it.
*
* Returns an empty object rather than an explicit `undefined` so the optional field is
* omitted under `exactOptionalPropertyTypes`.
*/
function emailFromTokenResponse(payload) {
	if (typeof payload.email === "string" && payload.email.length > 0) return { email: payload.email };
	const idToken = payload.id_token;
	if (typeof idToken !== "string") return {};
	const email = decodeIdTokenClaims(idToken)?.email;
	return typeof email === "string" && email.length > 0 ? { email } : {};
}
/**
* Decode the claims segment of a JWT without verifying its signature.
*
* The token came to us directly from Google over TLS in response to our own exchange, so
* the payload is already trusted; only the address is read from it, and only as an
* identifier. A malformed token yields `undefined` rather than throwing, because a missing
* address must not fail an otherwise valid login.
*/
function decodeIdTokenClaims(idToken) {
	const segments = idToken.split(".");
	if (segments.length !== 3) return void 0;
	const encoded = segments[1];
	if (encoded === void 0 || encoded.length === 0 || encoded.length > 16384) return void 0;
	try {
		const decoded = Buffer.from(encoded, "base64url").toString("utf8");
		const parsed = JSON.parse(decoded);
		return isRecord$1(parsed) ? parsed : void 0;
	} catch {
		return;
	}
}
function assertCallbackRequest(request) {
	if (request.method !== "GET") throw new OAuthFlowError("invalid-method", "The OAuth callback method is not accepted");
	if (typeof request.host !== "string" || !isAllowedCallbackHost(request.host)) throw new OAuthFlowError("invalid-host", "The OAuth callback host is not accepted");
	let parsed;
	try {
		parsed = new URL(request.url, `http://${request.host}`);
	} catch {
		throw new OAuthFlowError("invalid-path", "The OAuth callback URL is not accepted");
	}
	if (parsed.protocol !== "http:" || !isAllowedCallbackHost(parsed.host) || parsed.username.length > 0 || parsed.password.length > 0 || parsed.pathname !== "/oauth-callback" || parsed.hash.length > 0) throw new OAuthFlowError("invalid-path", "The OAuth callback path is not accepted");
}
function parseCallback(value) {
	let parsed;
	try {
		parsed = new URL(value, `http://${ANTIGRAVITY_CALLBACK_HOSTS[0]}`);
	} catch {
		throw new OAuthFlowError("invalid-path", "The OAuth callback URL is not accepted");
	}
	const seen = /* @__PURE__ */ new Set();
	for (const [key, paramValue] of parsed.searchParams) {
		if (seen.has(key)) throw new OAuthFlowError("duplicate-parameter", "The OAuth callback contains duplicate parameters");
		if (!safeCallbackValue(key) || !safeCallbackValue(paramValue)) throw new OAuthFlowError("invalid-parameters", "The OAuth callback parameters are not accepted");
		seen.add(key);
	}
	const state = parsed.searchParams.get("state");
	if (state === null || !safeCallbackValue(state)) throw new OAuthFlowError("missing-state", "The OAuth callback state is missing");
	const code = parsed.searchParams.get("code");
	const error = parsed.searchParams.get("error");
	if (error !== null) {
		if (code !== null || !safeCallbackValue(error)) throw new OAuthFlowError("invalid-parameters", "The OAuth callback parameters are not accepted");
		return {
			state,
			error
		};
	}
	if (parsed.searchParams.has("error_description") || parsed.searchParams.has("error_uri")) throw new OAuthFlowError("invalid-parameters", "The OAuth callback parameters are not accepted");
	if (code === null || !safeCallbackValue(code)) throw new OAuthFlowError("missing-code", "The OAuth callback code is missing");
	return {
		state,
		code
	};
}
function isAllowedCallbackHost(value) {
	return ANTIGRAVITY_CALLBACK_HOSTS.includes(value.toLowerCase());
}
function safeCallbackValue(value) {
	return isBoundedSafeText(value, MAX_CALLBACK_VALUE_LENGTH);
}
function randomBytes$1(random, size) {
	const bytes = random(size);
	if (!(bytes instanceof Uint8Array) || bytes.byteLength !== size) throw new OAuthFlowError("internal", "The OAuth random source is unavailable");
	return bytes;
}
function encodeBase64Url(bytes) {
	return Buffer.from(bytes).toString("base64url");
}
function systemClock() {
	return {
		now: () => Date.now(),
		setTimeout: (handler, delayMs) => setTimeout(handler, delayMs),
		clearTimeout: (handle) => clearTimeout(handle)
	};
}
function noPendingError(status) {
	if (status.phase === "expired") return new OAuthFlowError("expired", "The OAuth login expired");
	if (status.phase === "cancelled") return new OAuthFlowError("cancelled", "The OAuth login was cancelled");
	return new OAuthFlowError("no-pending-flow", "There is no pending OAuth login");
}
function asListenerError(error) {
	if (error instanceof OAuthFlowError) return error;
	if (isRecord$1(error) && error.code === "EADDRINUSE") return new OAuthFlowError("port-conflict", "The fixed OAuth callback port is already in use");
	return new OAuthFlowError("internal", "The OAuth callback listener could not start");
}
function classifyCompletionError(error, signal) {
	if (signal.aborted || error instanceof OAuthFlowError && error.code === "cancelled") return new OAuthFlowError("cancelled", "The OAuth login was cancelled");
	if (error instanceof OAuthFlowError) return error;
	return new OAuthFlowError("token-exchange-failed", "The OAuth login could not be completed");
}
function assertToken(value) {
	if (!isRecord$1(value) || typeof value.accessToken !== "string" || value.accessToken.length === 0 || typeof value.refreshToken !== "string" || value.refreshToken.length === 0 || typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt)) throw new OAuthFlowError("token-exchange-failed", "The token response was not accepted");
}
function normalizeProject(value) {
	if (!isRecord$1(value)) throw new OAuthFlowError("project-validation-failed", "Project validation failed");
	const projectId = normalizeProjectId(value.projectId);
	if (projectId === void 0) throw new OAuthFlowError("project-validation-failed", "Project validation failed");
	return {
		projectId,
		...typeof value.email === "string" ? { email: value.email } : {}
	};
}
function projectErrorCode(code) {
	if (code === "authentication") return "project-authentication-failed";
	if (code === "forbidden") return "project-forbidden";
	if (code === "rate-limited") return "project-rate-limited";
	if (code === "offline") return "project-offline";
	if (code === "malformed") return "project-malformed";
	return "project-protocol-drift";
}
function projectErrorMessage(code) {
	if (code === "authentication") return "The Antigravity project probe requires authentication";
	if (code === "forbidden") return "The Antigravity project probe was forbidden";
	if (code === "rate-limited") return "The Antigravity project probe is rate-limited";
	if (code === "offline") return "The Antigravity project probe is offline";
	if (code === "malformed") return "The Antigravity project response was malformed";
	if (code === "protocol-drift") return "The Antigravity project protocol changed";
	return "The Antigravity project probe was cancelled";
}
function callbackResponse(status, outcome) {
	return {
		status,
		headers: EMPTY_RESPONSE_HEADERS,
		body: outcome === "success" ? "<!doctype html><meta charset=\"utf-8\"><title>Authorization complete</title><p>Authorization complete. You may return to DeepSeek Harness.</p>" : "<!doctype html><meta charset=\"utf-8\"><title>Authorization could not be completed</title><p>Authorization could not be completed. Return to DeepSeek Harness for details.</p>"
	};
}
function callbackStatus(code) {
	if (code === "port-conflict") return 409;
	if (code === "internal") return 500;
	return 400;
}
async function serveRequest(handler, request, response) {
	const host = typeof request.headers.host === "string" ? request.headers.host : void 0;
	const result = await handler({
		method: request.method ?? "",
		...host === void 0 ? {} : { host },
		url: request.url ?? ""
	});
	response.writeHead(result.status, result.headers);
	response.end(result.body);
}
async function readJsonBounded(response, signal) {
	if (response.body === null) {
		const text = await response.text();
		if (new TextEncoder().encode(text).byteLength > MAX_TOKEN_RESPONSE_BYTES) throw new OAuthFlowError("token-exchange-failed", "The token response was not accepted");
		try {
			return JSON.parse(text);
		} catch {
			throw new OAuthFlowError("token-exchange-failed", "The token response was not accepted");
		}
	}
	const reader = response.body.getReader();
	const chunks = [];
	let total = 0;
	try {
		while (true) {
			if (signal.aborted) throw new OAuthFlowError("cancelled", "The OAuth login was cancelled");
			const next = await reader.read();
			if (next.done) break;
			total += next.value.byteLength;
			if (total > MAX_TOKEN_RESPONSE_BYTES) throw new OAuthFlowError("token-exchange-failed", "The token response was not accepted");
			chunks.push(next.value);
		}
	} finally {
		try {
			reader.releaseLock();
		} catch {}
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return JSON.parse(Buffer.from(bytes).toString("utf8"));
	} catch {
		throw new OAuthFlowError("token-exchange-failed", "The token response was not accepted");
	}
}
function combineSignals(primary) {
	const controller = new AbortController();
	const onAbort = () => {
		if (!controller.signal.aborted) controller.abort(primary.reason);
	};
	if (primary.aborted) controller.abort(primary.reason);
	else primary.addEventListener("abort", onAbort, { once: true });
	return {
		signal: controller.signal,
		cleanup: () => primary.removeEventListener("abort", onAbort)
	};
}
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
//#endregion
//#region src/capability-gates.ts
/** Value-free live-gate evidence used to keep capability registration honest. */
const GATE_FILE_VERSION = 2;
const MAX_GATE_FILE_BYTES = 65536;
const PERSISTED_CAPABILITY_IDS = CAPABILITY_ROW_IDS.filter((id) => id !== "auth-llm");
/** Resolve a gate record next to the plugin-owned auth record without reading either. */
function defaultCapabilityGatePath(authStorePath) {
	return join(dirname(authStorePath), "gates.json");
}
function createMemoryCapabilityGates(initial = {}, now = () => Date.now()) {
	let current = cloneEvidence(initial);
	return {
		read: async () => cloneEvidence(current),
		recordGate0: async (subject, outcome) => {
			current = {
				subject: checkedSubject(subject),
				gate0: result(outcome, now)
			};
			return cloneEvidence(current);
		},
		recordLlmFamily: async (subject, family, outcome) => {
			current = evidenceForSubject(current, subject);
			current = {
				...current,
				llmFamilies: {
					...current.llmFamilies,
					[family]: result(outcome, now)
				}
			};
			return cloneEvidence(current);
		},
		recordCapability: async (subject, id, outcome) => {
			current = evidenceForSubject(current, subject);
			current = {
				...current,
				capabilities: {
					...current.capabilities,
					[id]: result(outcome, now)
				}
			};
			return cloneEvidence(current);
		},
		clear: async () => {
			current = {};
		}
	};
}
function createFileCapabilityGates(path, options = {}) {
	const now = options.now ?? (() => Date.now());
	const platform = options.platform ?? process.platform;
	let mutation = Promise.resolve();
	const read = async () => {
		let text;
		try {
			const [file, directory] = await Promise.all([lstat(path), lstat(dirname(path))]);
			const unsafePosixMode = platform !== "win32" && ((file.mode & 63) !== 0 || (directory.mode & 63) !== 0);
			if (file.isSymbolicLink() || !file.isFile() || directory.isSymbolicLink() || !directory.isDirectory() || file.size > MAX_GATE_FILE_BYTES || unsafePosixMode) throw new Error("unsafe gate record");
			text = await readFile(path, "utf8");
			if (text.length > MAX_GATE_FILE_BYTES) throw new Error("oversized gate record");
		} catch (error) {
			if (error.code === "ENOENT") return {};
			throw new Error("The Antigravity capability gate record could not be read");
		}
		let value;
		try {
			value = JSON.parse(text);
		} catch {
			throw new Error("The Antigravity capability gate record is malformed");
		}
		return parseFile(value);
	};
	const update = async (mutate) => {
		let output = {};
		const operation = mutation.then(async () => {
			output = mutate(await read());
			await writeEvidence(path, output);
		});
		mutation = operation.catch(() => {});
		await operation;
		return cloneEvidence(output);
	};
	return {
		read,
		recordGate0: (subject, outcome) => update(() => ({
			subject: checkedSubject(subject),
			gate0: result(outcome, now)
		})),
		recordLlmFamily: (subject, family, outcome) => update((current) => {
			const owned = evidenceForSubject(current, subject);
			return {
				...owned,
				llmFamilies: {
					...owned.llmFamilies,
					[family]: result(outcome, now)
				}
			};
		}),
		recordCapability: (subject, id, outcome) => update((current) => {
			const owned = evidenceForSubject(current, subject);
			return {
				...owned,
				capabilities: {
					...owned.capabilities,
					[id]: result(outcome, now)
				}
			};
		}),
		clear: async () => {
			const operation = mutation.then(async () => {
				await rm(path, { force: true });
			});
			mutation = operation.catch(() => {});
			await operation;
		}
	};
}
async function writeEvidence(path, evidence) {
	const directory = dirname(path);
	await mkdir(directory, {
		recursive: true,
		mode: 448
	});
	await chmod(directory, 448);
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	const encoded = `${JSON.stringify({
		version: GATE_FILE_VERSION,
		...evidence
	})}\n`;
	try {
		await writeFile(temporary, encoded, {
			encoding: "utf8",
			mode: 384,
			flag: "wx"
		});
		await rename(temporary, path);
		await chmod(path, 384);
	} finally {
		await rm(temporary, { force: true }).catch(() => {});
	}
}
function parseFile(value) {
	if (!isRecord(value) || value.version !== GATE_FILE_VERSION) throw new Error("The Antigravity capability gate record is malformed");
	if (Object.keys(value).some((key) => ![
		"version",
		"subject",
		"gate0",
		"llmFamilies",
		"capabilities"
	].includes(key))) throw new Error("The Antigravity capability gate record is malformed");
	if (typeof value.subject !== "string" || !isBoundedSafeText(value.subject, 128)) throw new Error("The Antigravity capability gate record is malformed");
	const gate0 = value.gate0 === void 0 ? void 0 : parseResult(value.gate0);
	const llmFamilies = value.llmFamilies === void 0 ? void 0 : parseLlmFamilies(value.llmFamilies);
	const capabilities = value.capabilities === void 0 ? void 0 : parseCapabilities(value.capabilities);
	return {
		subject: value.subject,
		...gate0 === void 0 ? {} : { gate0 },
		...llmFamilies === void 0 ? {} : { llmFamilies },
		...capabilities === void 0 ? {} : { capabilities }
	};
}
function parseLlmFamilies(value) {
	if (!isRecord(value) || Object.keys(value).some((key) => !LLM_FAMILY_IDS.includes(key))) throw new Error("The Antigravity capability gate record is malformed");
	const output = {};
	for (const family of LLM_FAMILY_IDS) if (value[family] !== void 0) output[family] = parseResult(value[family]);
	return output;
}
function parseCapabilities(value) {
	if (!isRecord(value)) throw new Error("The Antigravity capability gate record is malformed");
	const output = {};
	for (const id of PERSISTED_CAPABILITY_IDS) if (value[id] !== void 0) output[id] = parseResult(value[id]);
	return output;
}
function parseResult(value) {
	if (!isRecord(value) || Object.keys(value).length !== 2 || !Object.prototype.hasOwnProperty.call(value, "outcome") || !Object.prototype.hasOwnProperty.call(value, "checkedAt") || typeof value.outcome !== "string" || !CAPABILITY_GATE_OUTCOMES.includes(value.outcome) || typeof value.checkedAt !== "string" || value.checkedAt.length > 64 || !Number.isFinite(Date.parse(value.checkedAt))) throw new Error("The Antigravity capability gate record is malformed");
	return {
		outcome: value.outcome,
		checkedAt: value.checkedAt
	};
}
function result(outcome, now) {
	if (!CAPABILITY_GATE_OUTCOMES.includes(outcome)) throw new Error("The Antigravity capability gate outcome is invalid");
	const timestamp = now();
	if (!Number.isFinite(timestamp)) throw new Error("The Antigravity capability gate clock is invalid");
	return {
		outcome,
		checkedAt: new Date(timestamp).toISOString()
	};
}
function checkedSubject(subject) {
	if (!isBoundedSafeText(subject, 128)) throw new Error("The Antigravity capability gate subject is invalid");
	return subject;
}
function evidenceForSubject(current, subject) {
	const checked = checkedSubject(subject);
	return current.subject === checked ? current : { subject: checked };
}
function cloneEvidence(value) {
	return {
		...value.subject === void 0 ? {} : { subject: value.subject },
		...value.gate0 === void 0 ? {} : { gate0: { ...value.gate0 } },
		...value.llmFamilies === void 0 ? {} : { llmFamilies: Object.fromEntries(Object.entries(value.llmFamilies).map(([id, entry]) => [id, entry === void 0 ? void 0 : { ...entry }])) },
		...value.capabilities === void 0 ? {} : { capabilities: Object.fromEntries(Object.entries(value.capabilities).map(([id, entry]) => [id, entry === void 0 ? void 0 : { ...entry }])) }
	};
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
//#endregion
//#region src/auth-service.ts
/** Host-side Antigravity risk gate, OAuth coordinator, and credential commit boundary. */
/**
* Opaque handle for one pooled account.
*
* The UI needs to name an account to act on it, but the lineage is the fence every other
* decision keys on, so it is not handed to the browser. A hash is stable across status
* reads, which is all the UI requires.
*/
function accountHandle(lineage) {
	return createHash("sha256").update(`dsh-tool-antigravity/handle/${lineage}`).digest("hex").slice(0, 32);
}
var AntigravityAuthService = class {
	store;
	credentials;
	flow;
	quota;
	gates;
	autoActivate;
	accounts;
	activeFamily;
	riskAcknowledged = false;
	activeFlowGeneration = 0;
	disposed = false;
	statusListeners = /* @__PURE__ */ new Set();
	constructor(options = {}) {
		this.autoActivate = options.autoActivateGates ?? false;
		const storePath = options.storePath ?? defaultAuthStorePath();
		this.accounts = options.multiAccount !== false && options.store === void 0 ? createAuthStorePool(options.authPoolPath ?? defaultAuthPoolPath(storePath), {
			family: () => this.activeFamily,
			legacyStorePath: storePath
		}) : void 0;
		this.store = options.store ?? this.accounts ?? createAuthStore(storePath);
		this.gates = options.gates ?? (options.gatePath !== void 0 ? createFileCapabilityGates(options.gatePath) : options.store === void 0 ? createFileCapabilityGates(defaultCapabilityGatePath(storePath)) : createMemoryCapabilityGates());
		this.credentials = createCredentialCoordinator({
			...options.credentialOptions,
			store: this.store,
			...this.accounts === void 0 ? {} : { onRefreshFailure: (report) => this.rotateOnFailure(report) }
		});
		this.quota = createQuotaService({
			...options.quotaOptions,
			auth: this.credentials
		});
		const projectDiscovery = createProjectDiscovery(options.projectOptions);
		this.flow = createOAuthFlow({
			...options.flowOptions,
			validateProject: (accessToken, signal) => projectDiscovery.discover(accessToken, signal),
			commit: (token, project, signal) => this.commitCredential(token, project, signal)
		});
	}
	async status() {
		const record = await this.readRecord();
		const flowStatus = this.flow.status();
		const phase = flowStatus.phase === "idle" && record !== void 0 ? "success" : flowStatus.phase;
		const maskedEmail = maskEmail(record?.email);
		const credentialStatus = await this.credentials.status();
		const gateEvidence = await this.gateEvidenceFor(record);
		const login = {
			phase,
			configured: record !== void 0,
			projectAvailable: record?.projectId !== void 0,
			...flowStatus.authorizationUrl === void 0 ? {} : { authorizationUrl: flowStatus.authorizationUrl },
			...flowStatus.expiresAt === void 0 ? {} : { expiresAt: flowStatus.expiresAt },
			...maskedEmail === void 0 ? {} : { maskedEmail },
			...flowStatus.errorCode === void 0 ? {} : { errorCode: flowStatus.errorCode }
		};
		return createStatusView(this.riskAcknowledged, login, credentialStatus, this.credentials.revokeStatus(), gateEvidence, await this.accountSummaries(record));
	}
	/**
	* Build the value-safe account list for the settings UI.
	*
	* Returns `undefined` for the single-record store, which is what tells `createStatusView`
	* the install is not pooled. Each account is addressed by a hash of its lineage rather
	* than the lineage itself, so the identifier the browser holds cannot be replayed against
	* any other surface.
	*/
	async accountSummaries(active) {
		const pool = this.accounts;
		if (pool === void 0) return void 0;
		const state = await pool.readPool();
		const nowMs = Date.now();
		return state.accounts.map((account) => {
			const masked = account.email === void 0 ? void 0 : maskEmail(account.email);
			const cooling = account.cooldownUntil !== void 0 && account.cooldownUntil > nowMs ? { coolingUntil: account.cooldownUntil } : {};
			const liveFailures = effectiveFailureCount(account, nowMs);
			const failures = liveFailures <= 0 ? {} : { failureCount: liveFailures };
			return {
				id: accountHandle(account.lineage),
				...masked === void 0 ? {} : { email: masked },
				active: active !== void 0 && account.lineage === active.lineage,
				...cooling,
				...failures
			};
		});
	}
	async acknowledgeRisk() {
		this.riskAcknowledged = true;
		this.notifyStatus();
		return { acknowledged: true };
	}
	/** Observe value-safe gate changes so capability rows can register without polling secrets. */
	watchStatus(listener) {
		this.statusListeners.add(listener);
		return () => {
			this.statusListeners.delete(listener);
		};
	}
	async recordGate0(outcome) {
		const subject = gateSubject(await this.requireRecord());
		await this.gates.recordGate0(subject, outcome);
		this.notifyStatus();
	}
	async recordLlmFamilyGate(family, outcome) {
		const subject = gateSubject(await this.requireRecord());
		await this.gates.recordLlmFamily(subject, family, outcome);
		this.notifyStatus();
	}
	async recordCapabilityGate(id, outcome) {
		const subject = gateSubject(await this.requireRecord());
		if (id === "auth-llm") throw new OAuthFlowError("internal", "Auth/LLM availability is derived from independent family evidence");
		await this.gates.recordCapability(subject, id, outcome);
		this.notifyStatus();
	}
	async capabilityGateEvidence() {
		return this.gateEvidenceFor(await this.readRecord());
	}
	/**
	* How many signed-in accounts a rotation may try. One for the single-record store, so
	* callers can use this as an attempt budget without special-casing the pool.
	*/
	async accountCount() {
		if (this.accounts === void 0) return await this.readRecord() === void 0 ? 0 : 1;
		return (await this.accounts.readPool()).accounts.length;
	}
	/** Accounts that are not resting, which is what a rotation can actually pick from. */
	async readyAccountCount() {
		if (this.accounts === void 0) return this.accountCount();
		return this.accounts.readyCount();
	}
	/**
	* Apply one refresh failure to the account pool and report what the caller should do.
	*
	* Rotation lives here rather than in the credential coordinator because only the pool
	* knows which account is current and how long it should rest. With the single-record
	* store there is nothing to rotate to, so the decision degrades to the same
	* stay/relogin advice without touching any file.
	*/
	async rotateOnFailure(failure) {
		if (failure.family !== void 0) this.activeFamily = failure.family;
		const record = await this.readRecord();
		if (record === void 0) return "relogin";
		const pool = this.accounts;
		if (pool === void 0) return decideRotation({
			...failure,
			consecutiveFailures: 0
		}).action;
		const current = (await pool.readPool()).accounts.find((account) => account.lineage === record.lineage);
		const decision = decideRotation({
			...failure,
			consecutiveFailures: current === void 0 ? 0 : effectiveFailureCount(current, Date.now())
		});
		if (decision.action !== "rotate") return decision.action;
		if (record.lineage !== void 0) await pool.markCooldown(record.lineage, decision.cooldownMs, failure.family);
		this.credentials.invalidateCache();
		this.quota.invalidate?.();
		this.notifyStatus();
		return await pool.readyCount() === 0 ? "exhausted" : "rotate";
	}
	/**
	* Make a pooled account the one the next request resolves to.
	*
	* Only meaningful with the pool: the single-record store has exactly one account, so the
	* request is rejected rather than silently doing nothing.
	*/
	async selectAccount(handle) {
		const pool = this.accounts;
		if (pool === void 0) throw new OAuthFlowError("internal", "This install does not use an account pool");
		const lineage = await this.resolveHandle(pool, handle);
		if (lineage === void 0) return { state: "unknown-account" };
		await pool.setActive(lineage);
		this.credentials.invalidateCache();
		this.quota.invalidate?.();
		this.notifyStatus();
		return { state: "selected" };
	}
	/**
	* Forget one pooled account.
	*
	* Removing the last account empties the pool, so `login` has to run again. The cached
	* access token is dropped when the removed account was the active one, so the next
	* request cannot keep using a credential whose account is gone.
	*/
	async removeAccount(handle) {
		const pool = this.accounts;
		if (pool === void 0) throw new OAuthFlowError("internal", "This install does not use an account pool");
		const lineage = await this.resolveHandle(pool, handle);
		if (lineage === void 0) return { state: "unknown-account" };
		if (!await pool.removeAccount(lineage)) return { state: "unknown-account" };
		this.credentials.invalidateCache();
		this.quota.invalidate?.();
		this.notifyStatus();
		return { state: "removed" };
	}
	/** Map a UI handle back to the lineage it addresses, or undefined when unknown. */
	async resolveHandle(pool, handle) {
		if (typeof handle !== "string" || handle.length === 0 || handle.length > 128) return void 0;
		return (await pool.readPool()).accounts.find((account) => accountHandle(account.lineage) === handle)?.lineage;
	}
	async gate0Passed() {
		return (await this.capabilityGateEvidence()).gate0?.outcome === "passed";
	}
	async capabilityAvailable(id) {
		return (await this.status()).capabilities.some((capability) => capability.id === id && capability.state === "available");
	}
	async startLogin() {
		if (this.disposed) throw new OAuthFlowError("internal", "The Antigravity login is unavailable");
		if (!this.riskAcknowledged) throw new OAuthFlowError("risk-acknowledgement-required", "Risk acknowledgement is required before login");
		const started = await this.flow.start();
		this.activeFlowGeneration = this.flow.generation();
		this.notifyStatus();
		return started;
	}
	async completeCallback(callbackUrl) {
		if (this.disposed) throw new OAuthFlowError("internal", "The Antigravity login is unavailable");
		try {
			return await this.flow.completeCallbackUrl(callbackUrl);
		} finally {
			this.notifyStatus();
		}
	}
	async cancelLogin() {
		const status = await this.flow.cancel();
		if (status.phase !== "success") this.activeFlowGeneration = 0;
		this.notifyStatus();
		return {
			phase: status.phase,
			...status.errorCode === void 0 ? {} : { errorCode: status.errorCode }
		};
	}
	async credential(signal, options) {
		if (options?.family !== void 0) this.activeFamily = options.family;
		return await this.credentials.credential(signal, options);
	}
	async usage(signal, force = false) {
		return await this.quota.refresh(signal, force);
	}
	async logout() {
		if (this.disposed) throw new OAuthFlowError("internal", "The Antigravity login is unavailable");
		this.activeFlowGeneration = 0;
		await this.flow.cancel();
		try {
			const result = await this.credentials.logout();
			this.quota.invalidate?.();
			await this.gates.clear();
			this.notifyStatus();
			return result;
		} catch {
			throw new OAuthFlowError("persistence-failed", "The local Antigravity credential could not be cleared");
		}
	}
	async revoke(confirmed, signal) {
		if (this.disposed) throw new OAuthFlowError("internal", "The Antigravity login is unavailable");
		const result = await this.credentials.revoke(confirmed, signal);
		if (result.state === "revoked" || result.state === "logged-out" || result.state === "superseded") {
			this.quota.invalidate?.();
			await this.gates.clear();
		}
		this.notifyStatus();
		return result;
	}
	async dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.activeFlowGeneration = 0;
		this.statusListeners.clear();
		await Promise.all([
			this.flow.dispose(),
			this.credentials.dispose(),
			this.quota.dispose()
		]);
	}
	async commitCredential(token, project, signal) {
		const flowGeneration = this.flow.generation();
		if (this.disposed || flowGeneration !== this.activeFlowGeneration || signal.aborted) throw new OAuthFlowError("cancelled", "The OAuth login was cancelled");
		const current = await this.readRecord();
		if (this.disposed || flowGeneration !== this.activeFlowGeneration || signal.aborted) throw new OAuthFlowError("cancelled", "The OAuth login was cancelled");
		const rawEmail = project.email ?? token.email;
		const draft = {
			refreshToken: token.refreshToken,
			projectId: project.projectId,
			...rawEmail === void 0 ? {} : { email: this.accounts === void 0 ? maskEmail(rawEmail) ?? rawEmail : rawEmail }
		};
		const committed = await this.commitLogin(current, draft);
		if (committed === void 0) throw new OAuthFlowError("credential-conflict", "The login changed while it was completing");
		if (this.autoActivate) {
			const subject = committed.lineage ?? "legacy-account";
			await this.autoActivateGates(subject);
		} else await this.gates.clear().catch(() => {});
		this.credentials.replaceFromLogin({
			accessToken: token.accessToken,
			refreshToken: token.refreshToken,
			expiresAt: token.expiresAt,
			projectId: project.projectId
		}, committed);
		this.quota.invalidate?.();
		this.notifyStatus();
	}
	/**
	* Persist one completed login, deciding whether it refreshes an existing account or
	* adds a new one.
	*
	* The distinction cannot come from the single-record store: it only ever holds one
	* account, so `compareAndCommit` with the observed lineage means "replace". The pool
	* instead keys on a hashed identity tag — signing in with the same address refreshes
	* that account, a new address joins the pool. The raw address is used only to compute
	* the tag and is never written.
	*/
	async commitLogin(current, draft) {
		const pool = this.accounts;
		if (pool === void 0) return await this.store.compareAndCommit(current?.revision ?? 0, draft, current?.lineage);
		const state = await pool.readPool();
		const tag = emailTagFor(draft.email);
		const existing = tag === void 0 ? void 0 : state.accounts.find((account) => account.emailTag === tag);
		if (existing !== void 0) return await pool.compareAndCommit(state.revision, {
			...draft,
			lineage: existing.lineage
		}, existing.lineage);
		return await pool.compareAndCommit(state.revision, {
			...draft,
			lineage: randomUUID()
		}, void 0);
	}
	notifyStatus() {
		for (const listener of this.statusListeners) try {
			listener();
		} catch {}
	}
	async gateEvidenceFor(record) {
		try {
			const evidence = await this.gates.read();
			if (record === void 0) return {};
			const subject = gateSubject(record);
			if (evidence.subject === subject) return evidence;
			if (this.autoActivate && record.projectId !== void 0) {
				await this.autoActivateGates(subject);
				return await this.gates.read();
			}
			return {};
		} catch {
			return { gate0: {
				outcome: "protocol-drift",
				checkedAt: (/* @__PURE__ */ new Date()).toISOString()
			} };
		}
	}
	async autoActivateGates(subject) {
		try {
			await this.gates.recordGate0(subject, "passed");
			await this.gates.recordLlmFamily(subject, "gemini", "passed");
			await this.gates.recordLlmFamily(subject, "claude", "passed");
			await this.gates.recordLlmFamily(subject, "gpt-oss", "passed");
			await this.gates.recordCapability(subject, "image", "passed");
		} catch {}
	}
	async requireRecord() {
		const record = await this.readRecord();
		if (record === void 0) throw new OAuthFlowError("internal", "Antigravity login is required");
		return record;
	}
	async readRecord() {
		try {
			return await this.store.read();
		} catch {
			throw new OAuthFlowError("persistence-failed", "The Antigravity auth store could not be read");
		}
	}
};
function gateSubject(record) {
	return record.lineage ?? "legacy-account";
}
function createAntigravityAuthService(options = {}) {
	return new AntigravityAuthService(options);
}
function maskEmail(value) {
	if (!isBoundedSafeText(value, 4096)) return void 0;
	const at = value.indexOf("@");
	if (at <= 0 || at === value.length - 1) return void 0;
	const local = value.slice(0, at);
	const domain = value.slice(at + 1);
	if (!/^[^\s@]+$/u.test(local) || !/^[^\s@]+$/u.test(domain)) return void 0;
	if (local.endsWith("***")) return `${local}@${domain}`;
	return `${local.slice(0, 1)}***${local.length > 1 ? local.slice(-1) : ""}@${domain}`;
}
//#endregion
//#region src/capability-lifecycle.ts
/** Register a capability set atomically and dispose every owned member best-effort. */
function registerCapabilitySet(values, register) {
	const disposers = [];
	const disposeAll = () => {
		for (const dispose of disposers.splice(0).reverse()) try {
			dispose();
		} catch {}
	};
	try {
		for (const value of values) disposers.push(register(value));
	} catch (error) {
		disposeAll();
		throw error;
	}
	return disposeAll;
}
function mountCapabilityLifecycle(options) {
	let gateReady = false;
	let registration;
	let generation = 0;
	let disposed = false;
	const sync = () => {
		if (disposed) return;
		const shouldRegister = options.enabled() && gateReady;
		if (shouldRegister && registration === void 0) try {
			registration = options.register();
		} catch {
			gateReady = false;
		}
		else if (!shouldRegister && registration !== void 0) {
			const dispose = registration;
			registration = void 0;
			try {
				dispose();
			} catch {}
		}
	};
	const refresh = async () => {
		const currentGeneration = ++generation;
		let ready = false;
		try {
			const status = await options.auth.status();
			ready = status.login.projectAvailable && status.capabilities.some((capability) => capability.id === options.id && capability.state === "available");
		} catch {
			ready = false;
		}
		if (disposed || currentGeneration !== generation) return;
		gateReady = ready;
		sync();
	};
	const unwatch = options.auth.watchStatus?.(() => {
		refresh();
	}) ?? (() => {});
	options.ctx.effect?.(() => async () => {
		if (disposed) return;
		disposed = true;
		generation += 1;
		try {
			unwatch();
		} finally {
			const dispose = registration;
			registration = void 0;
			try {
				dispose?.();
			} finally {
				try {
					await options.cleanup?.();
				} finally {
					if (options.ownsAuth) await options.auth.dispose?.();
				}
			}
		}
	}, options.label);
	sync();
	refresh();
	return {
		sync,
		refresh
	};
}
//#endregion
export { defaultAuthStorePath as A, defaultAuthPoolPath as C, migrateLegacyRecord as D, maskForStorage as E, readPoolFile as O, createAuthStorePool as S, emailTagFor as T, credentialErrorMessage as _, createAntigravityAuthService as a, AUTH_POOL_VERSION as b, createMemoryCapabilityGates as c, ANTIGRAVITY_REVOKE_ENDPOINT as d, ANTIGRAVITY_TOKEN_ENDPOINT as f, createGoogleRevokeTransport as g, createGoogleRefreshTransport as h, accountHandle as i, writePoolFile as k, defaultCapabilityGatePath as l, createCredentialCoordinator as m, registerCapabilitySet as n, maskEmail as o, CredentialOperationError as p, AntigravityAuthService as r, createFileCapabilityGates as s, mountCapabilityLifecycle as t, OAuthFlowError as u, decideRotation as v, effectiveFailureCount as w, FAILURE_STREAK_WINDOW_MS as x, rotationAttemptBudget as y };
