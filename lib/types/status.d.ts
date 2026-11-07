/** Value-free login and capability status shared by Host and browser code. */
import type { LoginActionResult, LoginCompletionResult, LoginErrorCode, LoginPhase, LoginStartResult, LoginStatusView } from './login-types.ts';
import type { CredentialStatusView, LogoutResult, RevokeActionResult, RevokeStatusView } from './credential-coordinator.ts';
import type { QuotaStatusView } from './quota.ts';
export declare const ANTIGRAVITY_PLUGIN_ID: "dsh-tool-antigravity";
export declare const CAPABILITY_ROW_IDS: readonly ["auth-llm", "image"];
export declare const LLM_FAMILY_IDS: readonly ["gemini", "claude", "gpt-oss"];
export type CapabilityRowId = (typeof CAPABILITY_ROW_IDS)[number];
export type LlmFamilyId = (typeof LLM_FAMILY_IDS)[number];
export type CapabilityGateState = 'available' | 'disabled' | 'poc-pending' | 'protocol-drift';
export type CapabilityGateReasonCode = 'gate-not-run' | 'project-unavailable' | 'capability-ready' | 'unauthenticated' | 'rate-limited' | 'cancelled' | 'gate-0-failed' | 'gate-failed' | 'protocol-drift';
export declare const CAPABILITY_GATE_OUTCOMES: readonly ["passed", "unauthenticated", "rate-limited", "cancelled", "attribution-rejected", "protocol-drift", "failed"];
export type CapabilityGateOutcome = (typeof CAPABILITY_GATE_OUTCOMES)[number];
export interface CapabilityGateResult {
    readonly outcome: CapabilityGateOutcome;
    readonly checkedAt: string;
}
export interface CapabilityGateEvidence {
    /** Credential-lineage fence; evidence from another account is ignored. */
    readonly subject?: string;
    readonly gate0?: CapabilityGateResult;
    readonly llmFamilies?: Readonly<Partial<Record<LlmFamilyId, CapabilityGateResult>>>;
    readonly capabilities?: Readonly<Partial<Record<CapabilityRowId, CapabilityGateResult>>>;
}
export type { LoginActionResult, LoginErrorCode, LoginPhase, LoginStartResult, LoginStatusView };
export interface CapabilityGateStatus {
    readonly id: CapabilityRowId;
    readonly state: CapabilityGateState;
    readonly reasonCode: CapabilityGateReasonCode;
}
/**
 * One signed-in account as the settings UI is allowed to see it.
 *
 * Deliberately value-safe: the address is masked, and the identity tag is a hash, so this
 * crosses the Host/browser boundary without carrying anything that identifies the account
 * on its own. No token, no refresh token, no raw address.
 */
export interface AccountSummary {
    /** Opaque handle the UI uses to address this account in an operation. */
    readonly id: string;
    /** Masked address for display, or absent when the account predates identity capture. */
    readonly email?: string;
    /** True for the account a credential request would currently resolve to. */
    readonly active: boolean;
    /** Epoch ms until which rotation skips this account; absent when it is ready. */
    readonly coolingUntil?: number;
    /** Consecutive rotation failures, so the UI can show a struggling account. */
    readonly failureCount?: number;
}
export interface AntigravityStatusView {
    readonly pluginId: typeof ANTIGRAVITY_PLUGIN_ID;
    readonly phase: 'bootstrap';
    readonly privateSelfUse: true;
    /**
     * True only while the install runs the single-record store. When the account pool is
     * enabled this is false and `accounts` carries the pool, so the UI can render either
     * shape from one contract.
     */
    readonly singleAccount: boolean;
    readonly riskAcknowledgementRequired: true;
    readonly riskAcknowledged: boolean;
    readonly login: LoginStatusView;
    /** Every signed-in account, in pool order. Empty for the single-record store. */
    readonly accounts: readonly AccountSummary[];
    /** Credential state is value-safe; tokens and grant errors never cross this boundary. */
    readonly credential?: CredentialStatusView;
    readonly revoke?: RevokeStatusView;
    readonly capabilities: readonly CapabilityGateStatus[];
}
export interface RiskAcknowledgementResult {
    readonly acknowledged: true;
}
export interface BootstrapStatusService {
    status(): Promise<AntigravityStatusView>;
    acknowledgeRisk(): Promise<RiskAcknowledgementResult>;
    startLogin(): Promise<LoginStartResult>;
    completeCallback(callbackUrl: string): Promise<LoginCompletionResult>;
    cancelLogin(): Promise<{
        readonly phase: LoginPhase;
        readonly errorCode?: LoginErrorCode;
    }>;
    logout(): Promise<LogoutResult>;
    revoke(confirmed: boolean, signal?: AbortSignal): Promise<RevokeActionResult>;
    usage?(signal?: AbortSignal, force?: boolean): Promise<QuotaStatusView>;
    dispose(): Promise<void>;
}
export declare function createStatusView(riskAcknowledged: boolean, login: LoginStatusView, credential?: CredentialStatusView, revoke?: RevokeStatusView, gates?: CapabilityGateEvidence, accounts?: readonly AccountSummary[]): AntigravityStatusView;
//# sourceMappingURL=status.d.ts.map