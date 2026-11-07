/**
 * dsh-pet 桌面宠物插件集成：注册 google-antigravity 专属的自定义多页余额气泡。
 *
 * 采用 dsh-pet 的 `shape: 'custom'` 规范：
 * - 声明式节点树，两端共用白名单渲染器，不修改 dsh-pet 公共层；
 * - 气泡顶端明确标注 `google-antigravity` 与模型分组标签（Gemini / Claude）；
 * - 额度统一展示为「剩余 XX%」，进度条如实体现剩余健康度；
 * - 多页循环切换：Gemini 与 Claude / 3P 分组各占一页，自动根据当前选中的模型优先排在首页；
 * - 计算当前组最告急窗口的已用百分比（0-100）作为 `percent`，驱动桌宠档位动画。
 *
 * @module antigravity-auth/pet-balance
 */
import type { Context } from '@deepseek-ai/cordis';
import type { AntigravityAuthService } from './auth-service.ts';
/** 自定义节点类型定义（与 dsh-pet CustomNode 对齐） */
export interface PetCustomNode {
    tag: 'div' | 'span' | 'i' | 'b' | 'strong' | 'em' | 'img';
    text?: string;
    src?: string;
    style?: Record<string, string>;
    children?: PetCustomNode[];
}
export interface PetCustomBalanceResult {
    ok: true;
    provider: string;
    shape: 'custom';
    data: {
        views: PetCustomNode[];
        percent?: number;
    };
}
/**
 * 监听 `petApi7340` 服务并在在场时注册 `google-antigravity` 自定义多页余额服务商。
 *
 * @param ctx 宿主 Cordis Context
 * @param service Antigravity 认证服务
 */
export declare function registerAntigravityPetBalance(ctx: Context, service: AntigravityAuthService): void;
//# sourceMappingURL=pet-balance.d.ts.map