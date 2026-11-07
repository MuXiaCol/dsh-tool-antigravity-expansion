/** Settings shell for value-safe Antigravity login status. */
import type { ReactNode } from 'react';
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client';
import type { AntigravityAuthRpcClient } from '../rpc-contract.ts';
import type { AntigravityImageSettings } from '../image.ts';
import type { AntigravityAuthKey } from './locales.ts';
export interface AntigravityAuthSettingsProps {
    rpc: AntigravityAuthRpcClient;
    t: (key: AntigravityAuthKey) => string;
    subscribe: (listener: () => void) => () => void;
    imageScope?: SettingsScope<AntigravityImageSettings> | undefined;
}
/** One navigable settings section; credentials remain Host-only and actions use typed RPC. */
export declare function AntigravityAuthSettings({ rpc, t, subscribe, imageScope }: AntigravityAuthSettingsProps): ReactNode;
//# sourceMappingURL=AntigravityAuthSettings.d.ts.map