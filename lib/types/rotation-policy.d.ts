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
import { type RateLimitReason } from '@cortexkit/antigravity-auth-core';
export type { RateLimitReason };
/**
 * How a refresh failure should be handled. `rotate` advances to the next account;
 * `stay` retries the same account after a backoff; `relogin` means the grant is dead and
 * no amount of rotation will help.
 */
export type RotationAction = 'rotate' | 'stay' | 'relogin';
export interface RotationDecision {
    readonly action: RotationAction;
    /** Rest duration for the failed account; only meaningful for `rotate`. */
    readonly cooldownMs: number;
    /** Wait before retrying; only meaningful for `stay`. */
    readonly retryAfterMs: number;
    readonly reason: RateLimitReason;
}
export interface RotationPolicyInput {
    /** Provider-supplied error code, if any (e.g. Google's `reason` field). */
    readonly reason?: string | undefined;
    /** Human-readable provider message, used only to classify the failure. */
    readonly message?: string | undefined;
    /** HTTP status of the failed refresh, if one was received. */
    readonly status?: number | undefined;
    /** Consecutive failures already recorded for this account. */
    readonly consecutiveFailures: number;
    /** A `Retry-After` header value in milliseconds, when the provider sent one. */
    readonly retryAfterMs?: number | null;
    readonly random?: (() => number) | undefined;
}
export declare function decideRotation(input: RotationPolicyInput): RotationDecision;
/**
 * Bounded retry budget for one user request, so a fully exhausted pool fails promptly
 * instead of cycling forever.
 */
export declare function rotationAttemptBudget(accountCount: number): number;
//# sourceMappingURL=rotation-policy.d.ts.map