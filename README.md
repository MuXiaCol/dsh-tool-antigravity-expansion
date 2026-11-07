# dsh-tool-antigravity-expansion

[![GitHub](https://img.shields.io/github/license/MuXiaCol/dsh-tool-antigravity-expansion.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/MuXiaCol/dsh-tool-antigravity-expansion.svg?color=blue)](https://github.com/MuXiaCol/dsh-tool-antigravity-expansion/releases)
[![Tests](https://img.shields.io/badge/tests-pass-brightgreen.svg)](tests/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict%20Types-blue.svg)](tsconfig.json)

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) 打造的高性能 Antigravity 核心能力包插件。

提供私有 Google OAuth 2.0 PKCE 认证闭环、智能多账号池与额度用尽无感自动轮换、全系多模型路由服务（`google-antigravity`）、会话持久化 Nano Banana 2 图像生成与多轮编辑工具（`generate_image` / `list_images`），以及具备 SWR 容错缓存与实时配额看板的 Web 设置面板。

---

## 核心特性与架构设计

### 1. 高性能底层架构
- **底层长连接池（TLS Socket Keep-Alive）与会话复用**：内置 HTTP/1.1 长连接池与 TLS 票据复用机制，彻底消除逐请求建立 TLS 握手的固有延迟，显著降低首字响应时间（TTFT）。
- **高吞吐 Buffer 游标滑动 SSE 解析**：在二进制 Buffer 字节层精确定位换行符并切片解码，彻底消除流式推理时高频字符串累加带来的 V8 堆内存重新分配与 GC 抖动。
- **细粒度思考预算调控**：全面支持 Gemini 3.8/3.7/3.6 Flash、Gemini 3.1 Pro 与 Claude 系列模型的思维链深度配置（`low`, `medium`, `high`）。
- **前置幂等断线自愈**：在流式首字节发出前遇到瞬时网络异常（如 TLS RST / 502 / 503 / 504）时自动平滑重试最多 3 次，提升模型生成稳定性。
- **Windows 文件锁活性探测**：引入 `process.kill(pid, 0)` 探测，若持有锁的外部进程已异常退出，立即主动回收锁，杜绝 30 秒卡死等待。
- **配额看板 SWR 容错与微光动效**：重构 5 小时与每周配额解析算法，解决窗口周期判断漂移问题；在接口波动时展示缓存数据与微光动效。

### 2. 支持的模型列表 (`google-antigravity`)
| 模型标识符 | 显示名称 | 核心模态 | 思考预算支持 |
| :--- | :--- | :--- | :--- |
| `antigravity-gemini-4-argon` | Gemini 4 Argon | 文本, 视觉, 工具 | Low / Medium / High |
| `antigravity-gemini-3.8-flash` | Gemini 3.8 Flash | 文本, 视觉, 工具 | Low / Medium / High |
| `antigravity-gemini-3.5-flash` | Gemini 3.5 Flash | 文本, 视觉, 工具 | Low / Medium / High |
| `antigravity-claude-opus-5-5` | Claude Opus 5.5 | 文本, 视觉, 工具 | Low / Medium / High |
| `antigravity-claude-sonnet-5-5` | Claude Sonnet 5.5 | 文本, 视觉, 工具 | Low / Medium / High |
| `antigravity-gpt-oss-120b-medium` | GPT-OSS 120B Medium | 文本, 视觉, 工具 | 固定档位 |

### 3. Nano Banana 2 图片生成与多轮编辑工具
- **`generate_image`**：依托 Nano Banana 2（`gemini-3.1-flash-image`）原生多模态能力，支持基于自然语言提示词的图像生成，以及基于会话图片的图生图/多轮编辑。
- **`list_images`**：供智能体检索当前会话中生成的图片附件。
- 深度接入 DSH `AttachmentStore` 与 `FileSystem`，结合 TOCTOU 防穿越路径准入，杜绝将大量 Base64 直接回灌进对话上下文。

---

## 安装与快速上手

### 方式一：通过 GitHub 仓库安装（推荐）
在你的 DSH 桌面端目录执行：

```sh
pnpm add github:MuXiaCol/dsh-tool-antigravity-expansion
```

### 方式二：本地开发目录（profile 内副本）
不把 `file:` 直接指向仓库，而是让包在 profile 内部形成一个副本，再把依赖指向内部路径：

在 `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 中写：

```json
"dsh-tool-antigravity-expansion": "file:packages/dsh-tool-antigravity-expansion"
```

然后执行仓库根目录的 `sync.cmd`（或 `node scripts/sync-to-profile.mjs --fix-manifest`），
它会生成最终布局：

```
<profile>/packages/dsh-tool-antigravity-expansion   仓库产物的副本（脚本镜像）
<profile>/node_modules/dsh-tool-antigravity-expansion -> 上面这个目录（目录联接）
```

> **为什么不能把依赖直接写成 `file:D:/...`**
> DSH 只对位于 profile 目录树内的模块提供 `@deepseek-ai/*` 运行包解析。指向仓库外的 `file:`
> 依赖会装成软链，Node 随后 realpath 回仓库真实路径，插件内的
> `import ... from '@deepseek-ai/dsh-llm'` 以 `ERR_MODULE_NOT_FOUND` 失败，Host 插件行不会激活
> （provider 不注册、设置面板不出现、工具缺失）。把副本放在 profile 内后，即使之后在该 profile
> 里跑 `pnpm install`，pnpm 重建的链接也只指向 profile 内部，插件保持可用。
>
> 改完代码执行 `sync.cmd`，然后重启 DeepSeek Harness。

### Cordis 插件配置
在你的 `cordis.patch.yml` 或 DSH 配置文件中注入插件行：

```yaml
- id: antigravity-auth
  name: 'dsh-tool-antigravity-expansion'

- id: antigravity-image
  name: 'dsh-tool-antigravity-expansion/image'
```

---

## 常用指令与界面交互

### 终端斜杠命令 (Slash Commands)
在 DSH 命令行或交互输入框中可直接使用：

- `/antigravity-auth login`：启动 Google OAuth 2.0 PKCE 登录流程并自动唤起默认浏览器。
- `/antigravity-auth status`：查看当前账号登录状态、脱敏邮箱与 Project ID。
- `/antigravity-auth logout`：注销当前登录凭证并吊销 Token。
- `/antigravity-auth cancel`：取消正在进行的登录操作。

### 前端设置与仪表盘
在 DSH Web 前端设置页面中自动注入：
- **Antigravity Auth 设置卡片**：展示登录状态、账号身份及功能开关。
- **配额可视化仪表盘**：动态展示 5 小时与每周重置窗口的剩余配额百分比与倒计时。
- **图片生成设置卡片**：配置默认生图模型与批次大小。

---

## 安全机制与不可变约束

1. **凭证物理隔离**：`accessToken` 与 `refreshToken` 严格保留在宿主安全存储中，绝不泄露给前端 UI、日志或命令历史。
2. **严格 Loopback 守卫**：账号 RPC 接口仅在明确绑定 `127.0.0.1` 时生效，其他公网/未知 bind 默认阻断（Fail-Closed）。
3. **不可篡改线路签名**：严格维持已审计的 AGY CLI User-Agent（`antigravity/cli/1.1.24`）与归属载荷。
4. **多媒体路径逃逸防护**：强制进行目录穿越防范与符号链接安全检测。

---

## 免责声明

本项目为非官方、社区驱动的开源能力包，仅供个人学习、技术研究与独立开发使用。请严格遵守相关平台的服务条款。

---

## 许可证

[MIT](LICENSE) © [dsh-tool-antigravity contributors](LICENSE)
