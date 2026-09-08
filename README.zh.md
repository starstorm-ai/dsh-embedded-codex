---
description: "为 DeepSeek Harness 安装和开发由 Agent 预设选择的 Codex App Server runtime。"
kind: "package-bundle"
---

# dsh-embedded-codex

[English](README.md) | 中文

`dsh-embedded-codex` 是 DeepSeek Harness 的外部 Bundle，让一个 Agent 预设使用官方 Codex App Server 和 ChatGPT Codex 订阅。它不会把 Codex 伪装成 LLM adapter：Codex 拥有原生 thread、模型循环、工具、sandbox、审批、隐藏历史与 compaction；DSH 继续拥有 Session、Web/API、对话、轨迹、持久化和 token 视图。

Bundle 与 DSH 源码完全隔离。它禁用三个已锁定版本的 provider 条目，并插入 `ctx.agents`、`ctx.agentPresets` 与 Web Session Controller 的兼容替代 provider。普通 `agent-loop`、DeepSeek adapter、工具和标准预设仍保持启用。只有 `embedded-codex` 预设会选择 Codex runtime。

## 环境要求

- Node.js `^22.19.0` 或 `>=24.0.0`。
- 仓库开发使用 pnpm `11.7.0`。
- DeepSeek Harness `0.1.2-rc.1`；其他 Host 版本会在 provider 启动时失败。
- 已通过官方 Codex CLI 登录、且拥有 Codex 权限的 ChatGPT 账户。

Runtime 将 `@openai/codex` 精确锁定为 `0.149.1`，并且始终启动该依赖包内的可执行文件，不使用 `PATH` 上无关的 `codex`。

## 本地开发

```powershell
git clone --recurse-submodules <repository-url> D:\dsh-embedded-codex
Set-Location D:\dsh-embedded-codex
pnpm install --frozen-lockfile
pnpm run bootstrap
pnpm exec codex login
pnpm run check
```

`bootstrap` 会验证固定的 submodule、构建缺失的 DSH 开发产物，并在 submodule 外物化兼容源码。普通命令不会更新 submodule commit。

把构建出的 tarball 安装到仓库专用 DSH home，然后启动 Web：

```powershell
pnpm run dev:install
pnpm run dev:web
```

打开空白 Session 并选择 `Codex 模式`。选择 `标准模式`、`PTC 模式` 或其他标准预设时，将继续使用正常 DSH runtime。使用 `pnpm run dev:remove` 可移除开发 Bundle。

## 发布后安装

包发布后，通过 DSH 支持的 Profile 入口安装：

```powershell
pnpm run build
pnpm pack

dsh plugin --profile web add dsh-embedded-codex
dsh web
```

Codex 预设不需要 `DEEPSEEK_API_KEY`。标准 DSH 预设仍使用各自配置的 LLM provider 与凭据。

## Runtime 路径

```text
standard preset
  -> ctx.agents default factory
  -> agent-loop
  -> ctx.llm

embedded-codex preset
  -> ctx.agents named factory
  -> ctx.embeddedCodex
  -> official Codex App Server
  -> native Codex thread and tools
  -> standard DSH Session events
```

`ctx.llm` 会暴露 `codex/default` 和 App Server 对当前账户可见的模型目录，因此现有模型选择器可以正常工作。为 `codex` 调用 `ctx.llm.stream()` 会返回 `CODEX_RUNTIME_ONLY`；主对话只能通过当前选择的 Agent runtime 到达 Codex。

App Server 活动映射为现有 DSH 事件：

| Codex 活动 | DSH 表示 |
|---|---|
| 输入 | `user/message` |
| reasoning 或 plan 文本 | `assistant/chunk` 与 `assistant/message` 中的 reasoning block |
| 原生工具 | `codex.*` tool-call block，加 `tool/call` 与 `tool/result` 观测事件 |
| 最终答案 | 最终 `assistant/message` step 中的 text block |
| Token 更新 | usage chunk 与最终 `assistant/message.usage` |
| 完成 | `step/end` 与 `turn/end` |

原生工具绝不会通过 `ctx.tools` 分发，因此 DSH 不会重复执行。命令和文件审批使用 `ctx.approval`；Codex request-user-input 使用 `ctx.userQuestions`；由于当前 DSH 版本没有等价的结构化响应服务，MCP elicitation 会被拒绝。

## 配置

可以在更晚的 Profile patch 中覆盖 `embedded-codex` 条目：

```yaml
- id: embedded-codex
  config:
    requireChatgptLogin: true
    approvalPolicy: on-request
    sandbox: workspace-write
```

| 字段 | 默认值 | 用途 |
|---|---|---|
| `providerName` | `codex` | 暴露给 DSH 模型选择的 provider id |
| `providerDisplayName` | `Codex` | Provider 显示名 |
| `defaultModelAlias` | `default` | 保留 Codex 原生默认模型选择 |
| `requireChatgptLogin` | `true` | 拒绝缺失登录或 API-key 登录 |
| `env` | `{}` | 显式传给 App Server 的环境 |
| `processCwd` | process cwd | 共享 App Server 工作目录 |
| `approvalPolicy` | `on-request` | 原生审批策略 |
| `sandbox` | `workspace-write` | `read-only`、`workspace-write` 或 `danger-full-access` |
| `disposeGraceMs` | `3000` | 子进程树关闭宽限 |
| `stderrMaxBytes` | `65536` | 保留的 stderr 诊断上限 |

## 验证

```powershell
pnpm run check
```

检查会验证 submodule commit 与摘要，构建所有发布入口，运行 fake App Server 与 DSH 投影测试，执行 lint 和文档检查，检查发布包，然后在隔离 Web Profile 中安装并移除真实 tarball。`pnpm run test:real` 必须显式设置 `DSH_EMBEDDED_CODEX_REAL=1`，因为它会使用开发者现有 Codex 登录启动 Web，所以不会进入默认 CI。

## 兼容性与升级

本包包含三个 DSH provider 的编译适配。准确源码与预设资产摘要记录在 [`compat/upstream-lock.json`](compat/upstream-lock.json)，启动时会拒绝其他 DSH package 版本。详细设计见 [`docs/architecture.md`](docs/architecture.md)、[`docs/compatibility.md`](docs/compatibility.md)、[`docs/testing.md`](docs/testing.md) 与 [`docs/upgrading.md`](docs/upgrading.md)。

旧的实验性 Embedded Codex Session 不会迁移。安装独立 Bundle 后请创建新 Session；可见 DSH transcript 无法无损重建 Codex 的隐藏状态。
