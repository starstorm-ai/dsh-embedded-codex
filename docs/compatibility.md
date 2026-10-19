---
description: "说明 dsh-embedded-codex 支持的 DSH/Codex 版本与失败策略。"
kind: "reference"
---

# 兼容性

## 支持矩阵

| 组件 | 支持值 |
|---|---|
| DeepSeek Harness tag/commit | `dsh-v0.2.0-rc.2` / `639ed015397290b3745d163aafe02ffee4aa3f84` |
| DSH package version | `0.2.0-rc.2` |
| `@openai/codex` | `0.159.2` |
| Node.js | `^22.19.0` 或 `>=24.0.0` |
| 默认客户端/Profile | Electron Desktop / `desktop`（`web` 仅回归） |

本版本是精确兼容，不声明 semver 范围。Host replacement 校验 `@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-agent-preset-registry`、`@deepseek-ai/dsh-config-editor`、`@deepseek-ai/dsh-permission-presets` 与 `@deepseek-ai/dsh-api-session-controller`；UI replacement 只校验 `@deepseek-ai/dsh-client-ui-permission-presets`。Conversation UI 保持目标 DSH 原版。任一受管 package 版本不同都会明确失败。

父仓库的 Git submodule gitlink 是开发基线的唯一 commit 来源。构建只确认 checkout 与 gitlink 一致，不再维护第二份 commit、源码摘要或资产摘要。兼容 patch 的单文件约束、文件名编码路径校验、Profile provider 名称 guard、组合测试和运行时 package 版本检查共同负责发现不兼容变化。

## Profile 冲突

Bundle 以原 package 名称作为 Cordis patch guard。若另一个更早的 Bundle 改写或移除了 `agent`、`agent-preset-registry`、`config-editor`、`permission`、`session-controller` 或 `ui-permission`，DSH 会输出 patch warning。构建校验会同时确认原 registry 已由 package-name guard 禁用，并且兼容 registry 以相同 id 后写覆盖；主 Runtime 的 Loader 检查随后验证最终生效的 provider 组合。兼容 Config Editor 让该同 id replacement 的 profile 设置保持可写。检查也会确认原版 `ui-conversation` 和默认 `agent-loop` 仍启用。

## Session 兼容性

标准 DSH Session 保持标准 Runtime 和原有恢复行为。由本插件创建的 Codex Session 使用普通 DSH 事件，但恢复还需要 Assistant source 中的原生 thread binding。

`permission/preset`、`sandbox/mode` 和 `approval/policy` 仍使用 DSH 原有事件。新 projection state 会从 Session header 与 `agent-preset/selected` 事件恢复 provider-aware 选项；旧 Workspace write 状态安全映射到 Ask，旧 Full access 保留 Full access，旧 Read only 显示为 `custom` 并要求用户选择。

旧实验性实现、其他 Codex adapter 或其他 Agent Runtime 产生的可见 transcript 不会自动转换。若 Session 已有模型 turn，DSH 会锁定 Agent Preset；创建新 Session 才能选择另一个 Runtime。

## 不支持的降级

- Host 版本不同不会尝试 duck typing。
- Codex 未登录不会回退到 DeepSeek。
- API-key Codex 登录在默认配置下不会回退为 ChatGPT 登录。
- `ctx.llm.stream()` 不会接管 Codex 对话。
- 缺少原生 thread binding 不会用可见消息重建隐藏历史。
- 未知 App Server request 不会被忽略。
- 未知或无法无损映射的权限状态不会回退到更宽模式。
- App Server 不接受或重写所选 reviewer、approval policy、网络边界时不会继续执行 turn。
