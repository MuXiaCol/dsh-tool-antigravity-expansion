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
import { type AntigravityAuthRecord, type AntigravityAuthStore, type AuthStoreOptions } from './auth-store.ts';
export declare const AUTH_POOL_VERSION: 1;
/**
 * One pooled account. Mirrors the single-record shape so a migration is lossless, plus
 * the rotation bookkeeping the coordinator needs to skip a cooling account.
 */
export interface PooledAccount {
    readonly refreshToken: string;
    readonly projectId: string;
    /** Masked form, safe to display. Never the raw address. */
    readonly email?: string;
    /**
     * Salted hash of the raw account address. Used only to tell "signing in again" from
     * "signing in as someone else". The raw address is never persisted: the store holds no
     * plaintext identity, matching the single-record store's contract.
     */
    readonly emailTag?: string;
    /** Stable per-account fence; also the key used to find an account again. */
    readonly lineage: string;
    readonly addedAt: string;
    /** Epoch ms before which this account must not be selected again; absent means ready. */
    readonly cooldownUntil?: number;
    /**
     * Rotation failures that count as *consecutive*.
     *
     * Only meaningful together with `lastFailureAt`: the pair is read through
     * {@link effectiveFailureCount}, which resets the tally once the last failure is older
     * than the streak window. A raw counter would keep growing across unrelated failures
     * spread over hours, and the backoff ladder it feeds would over-punish a healthy account.
     */
    readonly consecutiveFailures?: number;
    /** Epoch ms of the most recent counted failure; anchors the streak window. */
    readonly lastFailureAt?: number;
}
/**
 * Derive a stable, non-reversible identity tag for an account address.
 *
 * The salt is fixed rather than per-install: the tag only has to be stable across logins
 * on the same machine, and a random salt would have to be persisted anyway. A SHA-256
 * digest of a normalised address is not reversible by inspection and never appears as
 * plaintext, which is what the store's privacy contract requires.
 */
export declare function emailTagFor(email: string | undefined): string | undefined;
/**
 * Mask an account address for storage. Only the first character of the local part and the
 * domain survive, so the persisted form identifies nothing on its own.
 */
export declare function maskForStorage(email: string): string;
/**
 * How long a failure keeps counting toward the streak.
 *
 * Matches the longest cooldown the ladder can assign (two hours), so a streak only survives
 * as long as the account it describes is still plausibly struggling. A failure older than
 * this is treated as the start of a fresh streak.
 */
export declare const FAILURE_STREAK_WINDOW_MS: number;
/**
 * The failure count that should actually drive the next backoff.
 *
 * The stored counter is only meaningful next to the time of its last update: an account that
 * failed once three hours ago and once just now has not failed twice in a row, so the older
 * entry must not inflate the ladder.
 */
export declare function effectiveFailureCount(account: Pick<PooledAccount, 'consecutiveFailures' | 'lastFailureAt'>, at: number): number;
export interface AuthPoolFile {
    readonly version: typeof AUTH_POOL_VERSION;
    readonly accounts: readonly PooledAccount[];
    /** Index into `accounts` used when no family-specific cursor applies. */
    readonly activeIndex: number;
    /** Per-LLM-family cursors so a Gemini-only exhaustion never rotates Claude. */
    readonly activeIndexByFamily?: Readonly<Record<string, number>>;
    /**
     * Optimistic-concurrency ticket, mirroring the single-record store's `revision`.
     * Starts at 0 for an empty pool so the first `compareAndCommit(0, …)` succeeds, which
     * is the exact call shape a fresh login makes.
     */
    readonly revision: number;
    readonly updatedAt: string;
}
export interface AuthStorePoolOptions extends AuthStoreOptions {
    /**
     * Selects which pooled account `read()` projects. Kept injectable so the credential
     * coordinator can drive family-aware rotation without this module knowing the model
     * families that exist.
     */
    readonly family?: () => string | undefined;
    /**
     * Path of a legacy single-record `auth.json` to fall back on while the pool is empty.
     * Adopting it on read keeps an existing install working after the upgrade without
     * rewriting anything until the next real write.
     */
    readonly legacyStorePath?: string;
}
export interface AuthStorePool extends AntigravityAuthStore {
    /** Read the whole pool; never exposed through the single-record interface. */
    readPool(): Promise<AuthPoolFile>;
    /** Number of accounts currently in cooldown-free rotation. */
    readyCount(): Promise<number>;
    /** Mark `lineage` cooling for `durationMs` and advance the cursor. */
    markCooldown(lineage: string, durationMs: number, family?: string): Promise<void>;
    /**
     * Point the cursor at `lineage` so the next read resolves to it.
     *
     * Deliberately does not clear a cooldown: selecting an account is a preference, not
     * proof that it can serve a request, so a resting account stays resting until tried.
     */
    setActive(lineage: string): Promise<boolean>;
    /** Drop an account entirely (logout of one account, or a revoked grant). */
    removeAccount(lineage: string): Promise<boolean>;
    /** Path of the backing `accounts.json`. */
    readonly path: string;
}
/** Resolve the pool path next to the legacy single-record store. */
export declare function defaultAuthPoolPath(authStorePath: string): string;
/**
 * Create the multi-account pool store. A missing pool file reads as empty, matching
 * the single-record store's absent-file behaviour.
 */
export declare function createAuthStorePool(path: string, options?: AuthStorePoolOptions): AuthStorePool;
export declare function readPoolFile(path: string, platform?: NodeJS.Platform): Promise<AuthPoolFile>;
export declare function writePoolFile(path: string, pool: AuthPoolFile): Promise<void>;
/**
 * Adopt a legacy single-record `auth.json` into an empty pool. Existing users keep
 * their session: the same refresh token, project, email and lineage carry over.
 */
export declare function migrateLegacyRecord(pool: AuthPoolFile, record: AntigravityAuthRecord): AuthPoolFile;
//# sourceMappingURL=auth-store-pool.d.ts.map