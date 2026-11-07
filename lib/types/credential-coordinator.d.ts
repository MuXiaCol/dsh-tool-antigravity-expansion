/** Host-only access-token cache, refresh single-flight, logout, and grant revocation. */
import type { AntigravityAuthRecord, AntigravityAuthStore } from './auth-store.ts';
export declare const ANTIGRAVITY_TOKEN_ENDPOINT: "https://oauth2.googleapis.com/token";
export declare const ANTIGRAVITY_REVOKE_ENDPOINT: "https://oauth2.googleapis.com/revoke";
export type CredentialState = 'logged-out' | 'logged-in' | 'refreshing' | 'refresh-failed' | 're-login-required';
export type CredentialErrorCode = 'invalid-grant' | 'network' | 'timeout' | 'rate-limited' | 'server-error' | 'http-error' | 'invalid-response' | 'conflict' | 'storage' | 'cancelled';
export interface HostCredential {
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly expiresAt: number;
    readonly projectId: string;
}
export interface RefreshAccessTokenResult {
    readonly accessToken: string;
    readonly refreshToken?: string;
    readonly expiresAt: number;
}
export interface RefreshAccessTokenInput {
    readonly refreshToken: string;
    readonly signal: AbortSignal;
}
export type RefreshAccessToken = (input: RefreshAccessTokenInput) => Promise<RefreshAccessTokenResult>;
export interface RevokeGrantInput {
    readonly token: string;
    readonly signal: AbortSignal;
}
export type RevokeGrant = (input: RevokeGrantInput) => Promise<void>;
export interface CredentialStatusView {
    readonly state: CredentialState;
    readonly configured: boolean;
    readonly expiresAt?: string;
    readonly lastRefreshAt?: string;
    readonly errorCode?: CredentialErrorCode;
}
export type RevokeState = 'idle' | 'pending' | 'confirmation-required' | 'revoked' | 'logged-out' | 'failed' | 'superseded';
export type RevokeErrorCode = Exclude<CredentialErrorCode, 'invalid-grant' | 'conflict' | 'cancelled'>;
export interface RevokeStatusView {
    readonly state: RevokeState;
    readonly errorCode?: RevokeErrorCode;
}
export type RevokeActionResult = {
    readonly state: 'confirmation-required';
} | {
    readonly state: 'revoked';
} | {
    readonly state: 'logged-out';
} | {
    readonly state: 'failed';
    readonly errorCode: RevokeErrorCode;
} | {
    readonly state: 'superseded';
};
export interface LogoutResult {
    readonly state: 'logged-out';
}
export interface RefreshFailureReport {
    /** This plugin's error code, used by the rotation policy to classify the failure. */
    readonly message: string;
    /** HTTP status the failure corresponds to, when one is known. */
    readonly status?: number;
    readonly reason?: string;
    readonly retryAfterMs?: number | null;
}
export interface CredentialCoordinatorOptions {
    readonly store: AntigravityAuthStore;
    readonly now?: () => number;
    readonly refreshLeadMs?: number;
    readonly operationTimeoutMs?: number;
    readonly refreshToken?: RefreshAccessToken;
    readonly revokeGrant?: RevokeGrant;
    readonly fetchImpl?: typeof fetch;
    /**
     * Notified when a refresh fails, so a multi-account pool can rest the account and
     * rotate. Omitted for the single-account store, which has nowhere to rotate to.
     */
    readonly onRefreshFailure?: (report: RefreshFailureReport) => Promise<unknown> | unknown;
}
export interface CredentialCoordinator {
    credential(signal?: AbortSignal, options?: {
        readonly forceRefresh?: boolean;
    }): Promise<HostCredential | undefined>;
    replaceFromLogin(credential: HostCredential, record: AntigravityAuthRecord): void;
    /**
     * Drop the cached access token without touching stored credentials.
     *
     * Used when the pool changes underneath the coordinator — the active account removed or
     * repointed — so the next request cannot serve a token belonging to an account that is no
     * longer selected.
     */
    invalidateCache(): void;
    status(): Promise<CredentialStatusView>;
    revokeStatus(): RevokeStatusView;
    logout(): Promise<LogoutResult>;
    revoke(confirmed: boolean, signal?: AbortSignal): Promise<RevokeActionResult>;
    dispose(): Promise<void>;
}
export declare class CredentialOperationError extends Error {
    readonly code: CredentialErrorCode;
    constructor(code: CredentialErrorCode, message?: string);
}
export declare function createCredentialCoordinator(options: CredentialCoordinatorOptions): CredentialCoordinator;
export declare function createGoogleRefreshTransport(fetchImpl?: typeof fetch, now?: () => number): RefreshAccessToken;
export declare function createGoogleRevokeTransport(fetchImpl?: typeof fetch): RevokeGrant;
export declare function credentialErrorMessage(code: string): string | undefined;
//# sourceMappingURL=credential-coordinator.d.ts.map