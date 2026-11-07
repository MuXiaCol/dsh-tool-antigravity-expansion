# dsh-tool-antigravity-expansion

[![GitHub release](https://img.shields.io/github/v/release/MuXiaCol/dsh-tool-antigravity-expansion.svg?color=blue)](https://github.com/MuXiaCol/dsh-tool-antigravity-expansion)
[![license](https://img.shields.io/github/license/MuXiaCol/dsh-tool-antigravity-expansion.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-pass-brightgreen.svg)](tests/)
[![DeepSeek Harness](https://img.shields.io/badge/DSH-Profile%20Bundle-ff69b4.svg)](https://github.com/deepseek-ai/deepseek-harness)

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) 打造的 Antigravity 核心能力包**深度调优与扩展增强版**（基于上游 `Jaylor-Wang/dsh-tool-antigravity v0.5.3` 改造）。

提供私有 Google OAuth 2.0 PKCE 认证闭环、智能多账号池与额度自动轮换、全系多模型路由服务（`google-antigravity`）、会话持久化 Nano Banana 2 图像生成与多轮编辑工具（`generate_image` / `list_images`），以及具备实时配额看板与代理绑定的 Web 设置面板。

---

## 🌟 扩展版核心优化特性 (Expansion Highlights)

本仓库针对原版在实际工程使用中的痛点进行了全方位的底层加固与性能重构：

### 1. Claude 独立模型条目固化（告别传参冲突）
- **独立顶格模型**：正式引入并暴露 `antigravity-claude-sonnet-5-5-high`（**Claude Sonnet 5.5 · 高**）与 `antigravity-claude-opus-5-5-medium`（**Claude Opus 5.5 · 中**）为独立可用模型，直接绑定上游最优线协议；
- **消除二级混乱**：去除了 Claude 不支持的分离式二级推理等级下拉框，选定模型即锁定思考深度，杜绝参数错位；
- **旧路由平滑兼容**：传入不带后缀的旧模型 ID 时，自动缺省映射到高/中档位，旧会话无缝兼容。

### 2. Claude 工具 Schema 异构联合终极清洗
- **彻底解决 HTTP 400 (`PROTOCOL_DRIFT`) 报错**：Anthropic Claude 官方接口严格禁止工具参数（`input_schema`）出现任何 `anyOf` / `oneOf` 复合联合体；
- **补全官方漏网之鱼**：原版仅处理全对象或全字符串联合，本扩展版引入深度递归压平机制，将现实开发中常见的 `string | object` 等异构联合体（如 `schedule_create`、`schedule_update` 里的 `at` 字段）自动无损坍缩合并，让全工作区 55+ 复杂工具 100% 稳定通过 Claude 校验。

### 3. Gemini 4 Argon 独立周配额看板恢复
- **突破原本写死的 2 组硬限制**：原版将返回分组硬编码限制为 `groups.length <= 2` 并只认 `gemini` 和 `non-gemini`，导致 Google 官方为 Pro 订阅返回的第 3 组 Argon 配额被判定为非法直接丢弃；
- **全链路打通**：在 `quota.js` 分组识别、RPC 契约校验及客户端 UI 中完整放行并渲染 `GEMINI 4 ARGON` 独立周额度进度条与中英语言包。

### 4. 思考签名长会话免死自愈（优化二）
- **根治长对话崩溃**：多轮长会话经历上下文截断、软件重启或跨模型切换后，历史旧思考块（Thinking Block）往往丢失有效签名，原版会触发 Google 远端 `400: Invalid signature in thinking block` 导致整场会话彻底报废；
- **自动免检通行**：在消息历史回溯组装时，自动检测无签名的历史思考块并赋予 Google 官方免校验通行证（`SKIP_THOUGHT_SIGNATURE`），会话寿命无限延长。

### 5. Keep-Alive 本地代理长连接池（优化四，首字响应秒开）
- **消灭握手冷启动延迟**：原版每发一句话都强制声明 `Connection: close` 并销毁 Socket，导致每次交互都要重复走 TCP 握手 $\rightarrow$ CONNECT 代理握手 $\rightarrow$ TLS 1.3 双向加密握手，白白浪费 300ms ~ 800ms；
- **单例代理长连接池**：在底层构建常驻 `proxySocketPool`，多轮对话与工具调用直接复用空闲长连接通道，并自带对端断开无感静默重连兜底，大幅降低首字响应时间（TTFT）。

---

## 🤖 支持的模型列表 (`google-antigravity`)

| 模型标识符 | 界面显示名称 | 模态支持 | 思考档位特性 |
| :--- | :--- | :--- | :--- |
| `antigravity-gemini-4-argon` | **Gemini 4 Argon** | 文本, 视觉, 工具 | 独立选择 Low / Medium / High |
| `antigravity-gemini-3.8-flash` | **Gemini 3.8 Flash** | 文本, 视觉, 工具 | 独立选择 Low / Medium / High |
| `antigravity-gemini-3.5-flash` | **Gemini 3.5 Flash** | 文本, 视觉, 工具 | 独立选择 Low / Medium / High |
| `antigravity-gemini-3.1-flash-image` | **Gemini 3.1 Flash Image** | 文本, 图像生成 | 专职图像模型，无思考档位 |
| `antigravity-claude-sonnet-5-5-high` | **Claude Sonnet 5.5 · 高** | 文本, 视觉, 工具 | 固化高档思考，免二级下拉配置 |
| `antigravity-claude-opus-5-5-medium` | **Claude Opus 5.5 · 中** | 文本, 视觉, 工具 | 固化中档思考，免二级下拉配置 |
| `antigravity-gpt-oss-120b-medium` | **GPT-OSS 120B Medium** | 文本, 视觉, 工具 | 固定档位 |

---

## 🎨 Nano Banana 2 图片生成与多轮编辑工具

- **`generate_image`**：依托 Nano Banana 2（`gemini-3.1-flash-image`）原生多模态能力，支持基于自然语言提示词的图像生成，以及基于会话图片的图生图/多轮编辑。
- **`list_images`**：供智能体检索当前会话中生成的图片附件。
- 深度接入 DSH `AttachmentStore` 与 `FileSystem`，结合 TOCTOU 防穿越路径准入，杜绝将大量 Base64 直接回灌进对话上下文。

---

## 🚀 安装与使用

### 本地开发链接（推荐，免受任何上游覆盖影响）

在你的 DSH 桌面端配置文件（`~/.dsh/profiles/desktop/package.json`）中直接通过 `file:` 引用本地仓库：

```json
{
  "dependencies": {
    "dsh-tool-antigravity": "file:D:/work/plugins/dsh-tool-antigravity"
  }
}
```

随后在 profile 目录执行 `pnpm install` 并重启 DSH 桌面端即可。

### Cordis 插件配置
在你的 `cordis.patch.yml` 中注入插件行：

```yaml
- id: antigravity-auth
  name: 'dsh-tool-antigravity'

- id: antigravity-image
  name: 'dsh-tool-antigravity/image'
```

---

## 🛠️ 常用指令与界面交互

### 终端斜杠命令 (Slash Commands)
在 DSH 命令行或交互输入框中可直接使用：

- `/antigravity-auth login`：启动 Google OAuth 2.0 PKCE 登录流程并自动唤起默认浏览器。
- `/antigravity-auth status`：查看当前账号登录状态、脱敏邮箱与 Project ID。
- `/antigravity-auth logout`：注销当前登录凭证并吊销 Token。
- `/antigravity-auth cancel`：取消正在进行的登录操作。

### 前端设置与仪表盘
在 DSH Web 前端设置页面中自动注入：
- **Antigravity Auth 设置卡片**：展示登录状态、多账号列表、冷却状态与网络代理设置。
- **配额可视化仪表盘**：动态展示 Gemini、Claude/GPT 以及 **Gemini 4 Argon** 的 5 小时与每周重置窗口配额百分比与倒计时。
- **图片生成设置卡片**：配置默认生图模型与批次大小。

---

## 🔒 安全机制与约束

1. **凭证物理隔离**：`accessToken` 与 `refreshToken` 严格保留在宿主安全存储中，绝不泄露给前端 UI、日志或命令历史。
2. **严格 Loopback 守卫**：账号 RPC 接口仅在明确绑定 `127.0.0.1` 时生效，其他公网/未知 bind 默认阻断（Fail-Closed）。
3. **线路签名保真**：严格维持已审计的 AGY CLI User-Agent（`antigravity/cli/1.1.24`）与归属载荷。
4. **多媒体路径逃逸防护**：强制进行目录穿越防范与符号链接安全检测。

---

## 📄 许可证

[MIT](LICENSE) © [MuXiaCol & dsh-tool-antigravity contributors](LICENSE)
