---
description: "dsh-embedded-codex 的 Bundle 组合、Runtime 路由、App Server 生命周期与 DSH 事件映射。"
kind: "architecture"
---

# 架构

## 目标

本仓库通过一个外部 DSH Bundle 提供 Codex Agent Runtime，不修改 DeepSeek Harness 源码或安装目录。`embedded-codex` Agent 预设选择 Codex App Server；其他预设继续选择 DSH `agent-loop`。

## Profile 组合

Cordis 的 patch 不允许通过目标行的 `name` 字段替换插件名；`name` 只用于校验目标身份。因此 [`cordis.patch.yml`](../cordis.patch.yml) 先以 `id + name` 禁用三个原 provider，再插入三个新 id 的兼容 provider和主 Runtime：

| 原条目 | 操作 | 替代条目 |
|---|---|---|
| `agent` | 校验 `@deepseek-ai/dsh-agent` 后禁用 | `embedded-codex-agent-registry` |
| `agent-presets` | 校验 `@deepseek-ai/dsh-agent-presets` 后禁用 | `embedded-codex-agent-presets` |
| `session-controller` | 校验 `@deepseek-ai/dsh-api-session-controller` 后禁用 | `embedded-codex-session-controller` |

`agent-loop`、`llm-deepseek`、工具、持久化和 UI 条目不会被禁用。主 Runtime 启动时读取 Loader 条目并再次验证上述七个条目的 provider 名称与启用状态；缺失、重复或被其他 Bundle 改写时立即失败。

## 兼容 provider

兼容 provider 不是运行时 monkey patch。构建脚本从固定 DSH submodule 复制三个 provider 的完整 TypeScript 输入，在仓库自己的 `compat/generated` 中应用可审查 patch，再生成独立发布 bundle。安装阶段不包含也不执行源码 patch。

Agent Registry 保留默认 `AgentFactory`，并增加按 Agent Preset id 注册的具名 factory。创建读取 `CreateAgentOptions.meta.agentPreset`，恢复读取 `ResumeAgentOptions.agentPreset`。Registry 记录每个 live Agent 的实际 factory，从而阻止标准 Runtime 选择 `codex` provider，也阻止 Codex Runtime 选择普通 LLM provider。

Agent Presets 保留 DSH 随附、部署和用户 root，并在随附 root 之后加入 effect-scoped 系统 root。最终优先级是 DSH 随附 root、外部 Runtime root、部署 root、用户 root。只有 idle、无排队输入且从未开始 turn 的 Session 可以跨 Runtime 切换。

Session Controller 在创建、恢复与 fork 前解析 Agent Preset，并将具名 factory 的模型默认值传给 Agent Registry。跨 Runtime 切换会先释放空白 Session 的旧 Agent，再恢复目标 Agent；目标恢复失败时尝试恢复旧 Runtime。Host 只在新 Agent 已发布后完成选择请求。

Web 客户端保留同一 Session id 的 resident 对象。`api-session/removed` 暂时将它标记为 removed；紧随其后的 `api-session/added` 清除此状态并继续使用已有 event window 与 projection store，因此模型选择器和聊天输入不会永久禁用。

## Runtime 路由

```text
Session create/resume/fork
  -> resolve Agent Preset
  -> ctx.agents
     -> no named factory: agent-loop
     -> embedded-codex: EmbeddedCodexRuntime
        -> CodexAppServerHost
        -> CodexRemoteThread
        -> EmbeddedCodexAgent
```

`ctx.embeddedCodex` 是 App Server、模型目录与 Codex Agent factory 的生命周期所有者。它向 `ctx.llm` 注册一个仅供模型目录使用的 adapter，并向 `ctx.agentPresets` 注册包内只读预设 root。

`codex/default` 表示不在 `turn/start` 指定原生模型，让 Codex 使用账户和 Runtime 默认值。其他模型 id 原样传给 App Server。Reasoning effort 来自 `model/list`。`ctx.llm.stream()` 不执行 Codex 对话，并返回 `CODEX_RUNTIME_ONLY`。

## App Server 生命周期

Runtime 通过 `@openai/codex` package manifest 解析准确的包内 wrapper，以 Node 启动 `app-server --stdio`。`ctx.subprocess` 拥有进程树、stdin/stdout、stderr 上限和终止宽限。

Host 延迟创建一个共享 App Server 进程，完成 `initialize`、`initialized`、`account/read` 与分页 `model/list`。默认配置只接受 ChatGPT 登录。一个连接内，原生 thread id 最多绑定一个 live DSH Agent；通知和请求按 thread id 路由。

每个 DSH Session 对应一个持久 Codex thread。新 Session 调用 `thread/start`，恢复调用 `thread/resume`，DSH fork 使用继承边界中保存的原生 turn id 调用 `thread/fork`。成功或中断的 Assistant message 在 `source.replayState.embeddedCodex` 保存 binding version、thread id 与 turn id。

可见 DSH transcript 不包含 Codex 隐藏历史，因此含模型对话但没有有效绑定的 seeded Session 会失败，不会降级为有损回放。

## 事件映射与顺序

Runtime 只写固定 DSH 版本已经定义的 Session 事件，不增加持久格式。一个 Codex turn 对应一个 DSH turn，并在工具阶段与最终答案阶段之间加入兼容 step：

```text
turn/start
step/start (1)
user/message
request/header
assistant/chunk(reasoning/tool-call)
tool/call + tool/result
assistant/message(process)
step/end (1)
step/start (2)
assistant/chunk(final text/usage)
assistant/message(final)
step/end (2)
turn/end
```

工具的 `tool-call` block、`tool/call` 与 `tool/result` 共享 `codex:<native-item-id>`。过程 Assistant 包含 reasoning 与 tool-call block；最终 Assistant 只包含答案。DSH Chat 因而依次投影系统提示、用户、过程、工具与最终答案，Trajectory 也按相同 turn/step 关联工具。原生工具事件是观测，不会调用 `ctx.tools.execute()`。

命令和文件审批映射到 `ctx.approval`，权限审批只返回 App Server 请求的 network/fileSystem 字段，request-user-input 映射到 `ctx.userQuestions`。缺少交互 provider 时安全拒绝。当前 DSH 没有结构化 MCP elicitation 回答服务，因此该请求返回 decline。未知 App Server 请求会失败当前 turn。

## Token 映射

App Server 的 `inputTokens` 同时包含 cache read 与 cache write。DSH `inputTokens` 记录 `input - cacheRead - cacheWrite`，并分别保存 `cacheReadTokens`、`cacheWriteTokens`、`outputTokens`、`reasoningTokens` 与原生 `totalTokens`。ChatGPT 配额、重置时间和费用不属于 turn token usage，不进入该映射。

## 发布边界

发布包只包含编译入口、类型、标准预设资产、Embedded Codex 预设、Bundle patch 与许可证说明。`upstream/`、`compat/generated/`、测试、缓存、Session、日志与认证文件均不在 npm `files` 清单中。运行时代码没有 submodule 路径依赖。

日常 `pnpm dev` 把仓库根目录作为稳定 `link:` 依赖注册到隔离 Web Profile，插件代码重建后无需重新运行 Profile 的包管理器。`pnpm dev:install` 和 `pnpm test` 仍使用真实 tarball：前者验证开发 Profile 中的发布安装，后者在全新的临时 Profile 中验证安装、组合和卸载。开发链接不改变发布包边界。
