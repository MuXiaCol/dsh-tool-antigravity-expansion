/** Host half of the private Antigravity bootstrap capability bundle. */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "antigravity-auth";
export declare const inject: string[];
export interface AntigravityAuthConfig {
    proxy?: string;
    /**
     * Sign in several accounts and rotate between them on quota exhaustion. On by default.
     */
    multiAccount?: boolean;
}
/** Mount the Host-only OAuth service and its guarded account RPC channel. */
export declare function apply(ctx: Context, config?: AntigravityAuthConfig): void;
export * from './pet-balance.ts';
export * from './auth-service.ts';
export * from './auth-store-pool.ts';
export * from './rotation-policy.ts';
export * from './credential-coordinator.ts';
export * from './rpc-contract.ts';
export * from './status.ts';
export * from './project-context.ts';
export * from './wire-identity.ts';
export * from './llm-adapter.ts';
export * from './private-transport.ts';
export * from './replay.ts';
export * from './quota.ts';
export * from './media-admission.ts';
export * from './model-catalog.ts';
export * from './capability-gates.ts';
export * from './live-gates.ts';
export * from './proxy-config.ts';
//# sourceMappingURL=index.d.ts.map