/**
 * Account list for the settings card: shows every signed-in account, which one is in use,
 * and lets the user switch or remove one.
 *
 * Rendered only when the Host reports an account pool. The single-record install keeps its
 * previous presentation, so this component is additive.
 */
import { type ReactNode } from 'react';
import type { AccountSummary } from '../status.ts';
import type { AntigravityAuthSettingsProps } from './AntigravityAuthSettings.tsx';
type Translate = AntigravityAuthSettingsProps['t'];
export interface AccountListProps {
    readonly accounts: readonly AccountSummary[];
    readonly singleAccount: boolean;
    readonly t: Translate;
    readonly rpc: AntigravityAuthSettingsProps['rpc'];
    /** Reload the status view and quota after a successful operation. */
    readonly onChanged: () => void | Promise<void>;
}
export declare function AccountList({ accounts, singleAccount, t, rpc, onChanged }: AccountListProps): ReactNode;
export {};
//# sourceMappingURL=AccountList.d.ts.map