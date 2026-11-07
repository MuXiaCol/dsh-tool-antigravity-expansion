/** Host-side Antigravity risk gate, OAuth coordinator, and credential commit boundary. */
import type { AntigravityAuthStore } from './auth-store.ts';
import { type CredentialCoordinatorOptions, type HostCredential } from './credential-coordinator.ts';
import type { OAuthFlowCompletionResult, OAuthFlowOptions } from './oauth-flow.ts';
import type { ProjectDiscoveryOptions } from './project-context.ts';
import type { AntigravityStatusView, BootstrapStatusService, RiskAcknowledgementResult, LoginActionResult, LoginStartResult, CapabilityGateEvidence, LlmFamilyId } from './status.ts';
import { type QuotaServiceOptions } from './quota.ts';
import { type CapabilityGateRegistry } from './capability-gates.ts';
import type { CapabilityGateOutcome, CapabilityRowId } from './status.ts';
/**
 * Opaque handle for one pooled account.
 *
 * The UI needs to name an account to act on it, but the lineage is the fence every other
 * decision keys on, so it is not handed to the browser. A hash is stable across status
 * reads, which is all the UI requires.
 */
export declare function accountHandle(lineage: string): string;
export interface AntigravityAuthServiceOptions {
    readonly store?: AntigravityAuthStore;
    readonly storePath?: string;
    readonly flowOptions?: Omit<OAuthFlowOptions, 'commit' | 'validateProject'>;
    /** Inject a complete private transport only for deterministic Host tests. */
    readonly projectOptions?: ProjectDiscoveryOptions;
    readonly credentialOptions?: Omit<CredentialCoordinatorOptions, 'store'>;
    readonly quotaOptions?: Omit<QuotaServiceOptions, 'auth'>;
    readonly gates?: CapabilityGateRegistry;
    readonly gatePath?: string;
    readonly autoActivateGates?: boolean;
    /**
     * Sign in several accounts and rotate between them. On by default.
     * When enabled without an explicit `store`, the multi-account pool at `authPoolPath` is used.
     */
    readonly multiAccount?: boolean;
    /** Pool file location; defaults to `accounts.json` beside the single-record store. */
    readonly authPoolPath?: string;
}
export type { HostCredential } from './credential-coordinator.ts';
/** Outcome of an account-list operation the settings UI can invoke. */
export type AccountOperationResult = {
    readonly state: 'selected';
} | {
    readonly state: 'removed';
} | {
    readonly state: 'unknown-account';
};
export declare class AntigravityAuthService implements BootstrapStatusService {
    private readonly store;
    private readonly credentials;
    private readonly flow;
    private readonly quota;
    private readonly gates;
    private readonly autoActivate;
    private readonly accounts;
    private activeFamily;
    private riskAcknowledged;
    private activeFlowGeneration;
    private disposed;
    private readonly statusListeners;
    constructor(options?: AntigravityAuthServiceOptions);
    status(): Promise<AntigravityStatusView>;
    /**
     * Build the value-safe account list for the settings UI.
     *
     * Returns `undefined` for the single-record store, which is what tells `createStatusView`
     * the install is not pooled. Each account is addressed by a hash of its lineage rather
     * than the lineage itself, so the identifier the browser holds cannot be replayed against
     * any other surface.
     */
    private accountSummaries;
    acknowledgeRisk(): Promise<RiskAcknowledgementResult>;
    /** Observe value-safe gate changes so capability rows can register without polling secrets. */
    watchStatus(listener: () => void): () => void;
    recordGate0(outcome: CapabilityGateOutcome): Promise<void>;
    recordLlmFamilyGate(family: LlmFamilyId, outcome: CapabilityGateOutcome): Promise<void>;
    recordCapabilityGate(id: CapabilityRowId, outcome: CapabilityGateOutcome): Promise<void>;
    capabilityGateEvidence(): Promise<CapabilityGateEvidence>;
    /**
     * How many signed-in accounts a rotation may try. One for the single-record store, so
     * callers can use this as an attempt budget without special-casing the pool.
     */
    accountCount(): Promise<number>;
    /** Accounts that are not resting, which is what a rotation can actually pick from. */
    readyAccountCount(): Promise<number>;
    /**
     * Apply one refresh failure to the account pool and report what the caller should do.
     *
     * Rotation lives here rather than in the credential coordinator because only the pool
     * knows which account is current and how long it should rest. With the single-record
     * store there is nothing to rotate to, so the decision degrades to the same
     * stay/relogin advice without touching any file.
     */
    rotateOnFailure(failure: {
        readonly reason?: string | undefined;
        readonly message?: string | undefined;
        readonly status?: number | undefined;
        readonly retryAfterMs?: number | null;
        readonly family?: string | undefined;
    }): Promise<('rotate' | 'stay' | 'relogin' | 'exhausted')>;
    /**
     * Make a pooled account the one the next request resolves to.
     *
     * Only meaningful with the pool: the single-record store has exactly one account, so the
     * request is rejected rather than silently doing nothing.
     */
    selectAccount(handle: string): Promise<AccountOperationResult>;
    /**
     * Forget one pooled account.
     *
     * Removing the last account empties the pool, so `login` has to run again. The cached
     * access token is dropped when the removed account was the active one, so the next
     * request cannot keep using a credential whose account is gone.
     */
    removeAccount(handle: string): Promise<AccountOperationResult>;
    /** Map a UI handle back to the lineage it addresses, or undefined when unknown. */
    private resolveHandle;
    gate0Passed(): Promise<boolean>;
    capabilityAvailable(id: CapabilityRowId): Promise<boolean>;
    startLogin(): Promise<LoginStartResult>;
    completeCallback(callbackUrl: string): Promise<OAuthFlowCompletionResult>;
    cancelLogin(): Promise<LoginActionResult>;
    credential(signal?: AbortSignal, options?: {
        readonly forceRefresh?: boolean;
        readonly family?: string;
    }): Promise<HostCredential | undefined>;
    usage(signal?: AbortSignal, force?: boolean): Promise<import('./quota.ts').QuotaStatusView>;
    logout(): Promise<import('./credential-coordinator.ts').LogoutResult>;
    revoke(confirmed: boolean, signal?: AbortSignal): Promise<import('./credential-coordinator.ts').RevokeActionResult>;
    dispose(): Promise<void>;
    private commitCredential;
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
    private commitLogin;
    private notifyStatus;
    private gateEvidenceFor;
    private autoActivateGates;
    private requireRecord;
    private readRecord;
}
export declare function createAntigravityAuthService(options?: AntigravityAuthServiceOptions): AntigravityAuthService;
export declare function maskEmail(value: string | undefined): string | undefined;
//# sourceMappingURL=auth-service.d.ts.map