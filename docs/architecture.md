---
description: "dsh-embedded-codex 的 Bundle 组合、Runtime 路由、App Server 生命周期与 DSH 事件映射。"
kind: "architecture"
---

# 架构

## 目标

本仓库通过一个外部 DSH Bundle 提供 Codex Agent Runtime。上游参考源码的受控文件保持只读；本仓库的 patch 在构建副本应用并发布为 replacement provider。声明式 `embedded-codex` Agent 预设选择 Codex App Server；其他预设继续选择 DSH `agent-loop`。默认开发、交付和验收入口是 Electron Desktop，renderer 仍使用 `dsh.client.platform: web`。

## 代码职责

| 位置 | 职责 |
|---|---|
| [`src/index.ts`](../src/index.ts) | Runtime 生命周期、模型目录、factory 和能力注册 |
| [`src/agent.ts`](../src/agent.ts) | Agent 调度、输入队列与状态迁移 |
| [`src/app-server.ts`](../src/app-server.ts) | 固定包内进程、连接代际、RPC 与原生 thread 路由 |
| [`src/compat/runtime-routing.ts`](../src/compat/runtime-routing.ts)、[`session-coordinator.ts`](../src/compat/session-coordinator.ts) | 通用 Runtime 路由和按 Session 串行化的切换事务 |
| [`src/permissions.ts`](../src/permissions.ts) | Codex 权限模式及原生映射；兼容 provider 只消费通用 profile |
| [`src/runtime/binding.ts`](../src/runtime/binding.ts)、[`cleanup.ts`](../src/runtime/cleanup.ts) | 可恢复绑定与全部尝试、幂等的资源释放 |
| [`src/runtime/input.ts`](../src/runtime/input.ts)、[`turn-projection.ts`](../src/runtime/turn-projection.ts)、[`interaction.ts`](../src/runtime/interaction.ts) | 输入准备、事件投影、审批与用户问题 |
| [`compat/manifest.json`](../compat/manifest.json) 与 [`compat/patches`](../compat/patches) | 固定 DSH 的有限接入点、用途和对应验证 |

Preset 描述配置组合，Runtime 描述执行能力。两者不是一一对应：一个 Runtime 可声明多个 Preset ID。Codex 业务语义归插件模块，patch 保留访问上游生命周期和服务所必需的接入。构建与 Desktop 私有源码适配归 `scripts/`，不进入 Runtime。

## Profile 组合

Cordis 的 patch 不允许通过目标行的 `name` 字段替换插件名；`name` 只用于校验目标身份。因此 [`cordis.patch.yml`](../cordis.patch.yml) 先以 `id + name` 禁用八个原 provider，再插入八个 replacement、一个声明式 preset 和主 Runtime。Agent Preset Registry replacement 特意沿用官方 `agent-preset-registry` id：Loader 对重复 id 采用后写覆盖，而原版 Agent Preset UI 固定通过该 id 写入默认 preset 设置。Chat 也沿用 `ui-chat` id，保留其设置命名空间。

| 原条目 | 操作 | 替代条目 |
|---|---|---|
| `agent` | 校验 `@deepseek-ai/dsh-agent` 后禁用 | `embedded-codex-agent-registry` |
| `agent-preset-registry` | 校验 `@deepseek-ai/dsh-agent-preset-registry` 后禁用 | `agent-preset-registry`（同 id，后写覆盖） |
| `config-editor` | 校验 `@deepseek-ai/dsh-config-editor` 后禁用 | `embedded-codex-config-editor` |
| `permission` | 校验 `@deepseek-ai/dsh-permission-presets` 后禁用 | `embedded-codex-permission-presets` |
| `session-controller` | 校验 `@deepseek-ai/dsh-api-session-controller` 后禁用 | `embedded-codex-session-controller` |
| `ui-permission` | 校验 `@deepseek-ai/dsh-client-ui-permission-presets` 后禁用 | `embedded-codex-ui-permission-presets` |
| `ui-chat` | 校验 `@deepseek-ai/dsh-client-ui-chat` 后禁用 | `ui-chat`（同 id） |
| `ui-trajectory` | 校验 `@deepseek-ai/dsh-client-ui-trajectory` 后禁用 | `ui-trajectory`（同 id） |

`preset-embedded-codex` 使用 `@deepseek-ai/dsh-agent-preset` 声明空插件组合；空数组表示没有额外上下文插件，不表示缺少 Agent Runtime。`agent-loop`、`ui-conversation`、`llm-deepseek`、工具和持久化不会被禁用。主 Runtime 启动时验证 replacement、preset、Runtime 及两个必须保留的 stock row；缺失、重复或被改写时立即失败。

## 兼容 provider

兼容 provider 不是运行时 monkey patch。构建脚本从固定 DSH submodule 复制五个 Host provider 和 Permission、Chat、Trajectory UI 的 TypeScript/TSX/CSS 及 PNG 资源，在仓库自己的 `compat/generated` 中应用逐文件可审查 patch，再生成独立发布 bundle。Client CSS 的本地图片以内嵌 data URL 发布，保留鲸鱼尾 APNG 的完整动画帧，不依赖页面路径；减少动态效果和强制颜色模式继续使用上游静态 SVG。安装阶段不包含也不执行源码 patch。

Agent Registry 保留默认 `AgentFactory`，通过 `registerRuntime()` 注册 Runtime 描述，独立声明 Runtime ID、多个 Preset ID、factory、默认模型、允许的 provider 和权限 profile。路由实现位于 `src/compat/runtime-routing.ts`，状态由每个 Registry 实例拥有。创建读取 `CreateAgentOptions.meta.agentPreset`，恢复读取 `ResumeAgentOptions.agentPreset`；live Agent 记录实际 Runtime。重复注册、缺失或已卸载 Runtime、模型 provider 不匹配均明确失败，不能回退到标准 loop。

Agent Preset Registry 保留目标 DSH 的声明注册、组合、选择、持久化和编辑能力，并增加 effect-scoped runtime switcher。只有 idle、无 queued/steering 输入且从未开始 turn 的 Session 可以跨 Runtime 切换；同 factory 使用原生 recompose，跨 factory 交给 Session Controller 事务性替换。

Config Editor 保留目标 DSH 的校验、原子写入、HMR 和 layer 优先级，只将同 id 行的配置读取从 first-write-wins 改为 Loader 使用的 last-write-wins。这样兼容 Registry 可以沿用官方设置命名空间，同时 profile 写回不会误判成 home/命令行覆盖。

Permission Presets 保留标准 DSH 的 Read only、Workspace write 和 Full access 表。兼容 provider 只根据 Session 所属 Runtime 读取通用权限 profile，Codex 模式、名称、说明和元组全部归 `src/permissions.ts`。Ask 与 Auto-review 共用 `workspace-write + ask` 底层元组，最近的 `permission/preset` 事件保存精确选择；切回标准 Runtime 时恢复标准表。标准只读状态切到 Codex 时投影为 `custom`，不会静默扩大为可写。活动 turn 禁止切换只适用于 Codex profile，标准 DSH 的原有修改规则保持不变。

Session Controller 在创建、恢复与 fork 前解析 Agent Preset，并将 Runtime 的模型默认值传给 Registry。其 `SessionOperationCoordinator` 以 Session ID 串行化 create/resume、Preset/模型选择及 prompt admission；入队后解析 live Agent 并重查请求去重。队列不覆盖完整模型 turn，也不阻塞取消，空闲条目自动释放。fork 只在子 Session 队列内创建，避免同时持有父子队列。

`agentPresets` 是 Session Controller 的嵌套可选依赖。Runtime switcher 在 `ctx.inject(['agentPresets'], presetCtx => ...)` 内注册，由该 scope 的 effect 释放；回调从 `presetCtx` 取得服务并显式传给切换方法。不能在外层 `this.ctx` 读取这个未声明依赖的服务，也不通过根 Context 绕过检查。Cordis 根 Context 不执行同样的注入约束，因此集成测试必须在真实插件作用域创建 Controller，并补充生产 Host Remote 调用。

跨 Runtime 切换先保存精确模型与权限选择，再释放空白 Session 的旧 Agent、恢复并发布目标 Agent。目标失败且清理成功时补偿恢复旧 Runtime；旧句柄清理失败、目标清理失败或补偿失败时，阻止该 Session 的后续 admission 并报告原因，避免另一个持久化写入者。所有资源均尝试清理后汇总错误，重复释放等待同一个 Promise。

Runtime 使用 DSH 的 `SessionPersistence.create/open` 获取会话写入句柄，恢复时通过 `read` 还原事件与 fork 边界，并补齐中断的 turn。发布前显式写入 seed 与 setup 事件，发布后的事件由持久化 provider 路由；退出时先停止 Agent，再关闭句柄并等待写入完成，最后释放注册表身份。创建、恢复或切换失败时关闭已取得的句柄，保证后续重试可以重新取得写入权。

Web 客户端保留同一 Session id 的 resident 对象。`api-session/removed` 暂时将它标记为 removed；紧随其后的 `api-session/added` 清除此状态并继续使用已有 event window 与 projection store，因此模型选择器和聊天输入不会永久禁用。

Conversation registry 和渲染组件使用目标 DSH 实现。Chat/Trajectory 兼容层通过 `src/transcript.ts` 识别原生绑定和 Codex attempt；过程消息按消息身份保存，最终答案继续提供标准 Step/Turn 的尾部动作。标准 Runtime 的消息和流收尾行为保持原样。Permission UI replacement 只改变选项来源：当前 Session projection 提供 `options` 时使用 provider-aware 表，否则使用 process catalog；General Settings 仍使用标准默认项。Host 提供名称与说明，UI 不硬编码 Codex 文案。兼容 Controller 和 UI 由本包的 immediate client bundle 注册，不改写 minified bundle。

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

`ctx.embeddedCodex` 是 App Server、模型目录与 Codex Agent factory 的生命周期所有者。它向 `ctx.llm` 注册一个仅供模型目录使用的 adapter，并用 `ctx.agents.registerRuntime()` 将 `embedded-codex` Preset 映射到 `codex` Runtime。注册由调用方 Cordis effect 持有，兼容 helper 不依赖模块全局单例。

`codex/default` 表示不在 `turn/start` 指定原生模型，让 Codex 使用账户和 Runtime 默认值。其他模型 id 原样传给 App Server。Reasoning effort 来自 `model/list`。`ctx.llm.stream()` 不执行 Codex 对话，并返回 `CODEX_RUNTIME_ONLY`。

## Step 输入生命周期

Runtime 在从 Inbox claim 输入后、写入 `user/message` 或调用 App Server 前，先组装一次 agent-scoped system prompt，并执行标准 `agent/pre-step` waterfall。组装结果不会覆盖 Codex App Server 自己管理的 system prompt；这一步保留 DSH 插件所依赖的 step 生命周期和作用域副作用。

只有 waterfall 返回的 `enter.messages` 会写入 Session 并转换为 App Server input。因此插件可以改写直接用户消息，也可以追加带独立 source 的文本或图片上下文，而原始引用不会泄漏到模型输入。首轮返回 `reject` 时，turn 以 `blocked` 结束且不打开 step；返回空消息时，turn 以 `completed` 结束，同样不启动原生 turn。

运行中 `agent.steer()` 也走相同准备函数。原生 `turn/steer` 是当前 Codex turn 的追加输入，不是新的 DSH model-call step，所以 hook 收到当前本地 turn/step，批准后的消息记录在当前开放 step 中。`reject` 或空消息只抑制这批 steering，不中断已经运行的 Codex turn；`startsRequestSeries` 会写入对应的 `request/header` series 边界。

Runtime 不识别 `dsh-context:` 或任何 Context Picker 私有格式。两类图片最终汇入同一个 `messageInputs()` 边界：

- 直接粘贴图片由 Session Controller 先保存为 attachment ref。
- Context Picker 先提交持久快照引用，再由它自己的 `agent/pre-step` 将引用改写为可读文本，并追加 metadata 与 image content block。
- Embedded Runtime 将 image attachment 转为 App Server `localImage`；没有 Host 路径时读取可信存储并转为 `image` data URL。Session 中仍保留 attachment ref 的 `mediaType`、bytes、宽高和 name，而不是依赖浏览器或模型可见的临时磁盘路径。

## App Server 生命周期

Runtime 从锁定的 `@openai/codex` 依赖解析包内运行时。Windows 下直接启动对应 x64/arm64 optional package 中的 `codex.exe app-server --stdio`，让 DSH 的 managed runner 隐藏其控制台，避免官方 JS wrapper 再次 spawn 时弹出空白终端。其他平台通过 package manifest 中的 Node wrapper 启动；Electron 宿主下显式设置 `ELECTRON_RUN_AS_NODE=1`。`ctx.subprocess` 拥有进程树、stdin/stdout、stderr 上限和终止宽限。`initialize.clientInfo.version` 来自本插件 package manifest。

Host 延迟创建一个共享 App Server 进程，完成 `initialize`、`initialized`、`account/read` 与分页 `model/list`。默认配置只接受 ChatGPT 登录。一个连接内，原生 thread id 最多绑定一个 live DSH Agent；通知和请求按 thread id 路由。

每个 DSH Session 对应一个持久 Codex thread。新 Session 调用 `thread/start`，恢复调用 `thread/resume`，DSH fork 只使用继承事件边界内已确认的原生 turn id 调用 `thread/fork`。

`src/runtime/binding.ts` 将带版本的绑定日志写入既有 `request/context.data.embeddedCodex`，Host-only projection 为 `embeddedCodexBinding`。DSH 当前持久化目录拒绝未知事件类型，故使用已有扩展字段，不增加 Session 核心 patch。记录包括 thread 绑定、输入准备提交、确认尚未发送及 turn 绑定；发送原生输入前必须等待写入完成。resume/fork 在开放 turn 之前取得的新绑定先暂存，第一条原生输入发送前写入当前 turn；此前崩溃可能留下无输入的原生 fork，但不会重复发送用户操作。

绑定不依赖 assistant 内容，首轮无输出就取消也可恢复。没有新日志时兼容读取旧 Assistant `source.replayState.embeddedCodex`；新日志损坏时拒绝恢复，不掩盖错误。Assistant 仍写兼容 replayState。输入提交结果未知时查询原生最新 turn 并明确拒绝自动重发，跨进程 RPC 与本地磁盘之间不声称存在原子提交。

Agent 负责调度和状态迁移，`runtime/input.ts`、`turn-projection.ts`、`interaction.ts` 分别处理输入、事件转换和交互。App Server 只接收 spawn/warn 小接口；已使用的 RPC 请求受生成协议类型约束，响应从 unknown 校验实际消费字段。

可见 DSH transcript 不包含 Codex 隐藏历史，因此含模型对话但没有有效绑定的 seeded Session 会失败，不会降级为有损回放。

## 权限同步

Session 的 `permissions` projection 是正常 Desktop/Web Bundle 中的唯一权限真源。Runtime 在恢复原生 thread 和开始每个新 turn 前读取一次当前 preset，并通过 `resolveCodexPermission()` 生成完整快照：

| 权限 ID | DSH sandbox / approval | App Server sandbox / approvalPolicy / reviewer |
|---|---|---|
| `ask-for-approval` | `workspace-write` / `ask` | `workspaceWrite` / `on-request` / `user` |
| `approve-for-me` | `workspace-write` / `ask` | `workspaceWrite` / `on-request` / `auto_review` |
| `danger-full-access` | `danger-full-access` / `never` | `dangerFullAccess` / `never` / `user` |

前两种模式共用 DSH 底层元组，最近的 `permission/preset` 事件区分精确意图。两个模式都发送 `writableRoots: [cwd]`、`networkAccess: false`、`excludeTmpdirEnvVar: false`、`excludeSlashTmp: false`；`cwd` 必须是绝对路径。显式 writable root 是 Session 工作区，同时保留 Codex 的临时目录规则，不能把它描述为“除 cwd 外所有目录都绝对不可写”。Auto-review 只改变审批者，不扩大这些边界；网络请求须通过相应审批。

旧 Workspace write 映射为 Ask，Full access 保持 Full access，只读和无法无损映射的状态显示 `custom` 并拒绝启动 turn。切回标准 Runtime 时，Ask/Auto-review 投影为标准 Workspace write；已有精确模式在 resume/fork 中保留。Agent Preset 的切换仍受空白 Session 限制，与逐轮权限选择是两个不同操作。

`thread/start`、`thread/resume` 和 `thread/fork` 使用快照中的 legacy sandbox mode、approval policy 与 reviewer 初始化原生 thread；返回值若改变 reviewer、approval policy，或扩大网络和 writable roots，attach 失败。`turn/start` 再发送完整 `sandboxPolicy`、`approvalPolicy` 与 `approvalsReviewer`，并在每个新 turn 重发，避免恢复或外部配置造成漂移。Steering 沿用活动 turn 的快照，`/permission` 在 Agent running 时拒绝切换。

旧 `approvalPolicy` 和 `sandbox` 插件配置只在没有 Permission Presets provider 的非标准组合中作为弃用 fallback；发布 Bundle 总会组合兼容 provider，因此不会使用该路径。未知、`custom` 或标准 preset 名无法启动 Codex turn，错误要求用户先明确选择 Codex 权限模式。

人工审批只批准当前请求，不扩展为 `acceptForSession`。`item/permissions/requestApproval` 的回复仅包含本次请求的 network/fileSystem 字段，scope 为 `turn`；缺少交互服务时拒绝。App Server 仍发给客户端的 Auto-review 请求继续进入 DSH 用户审批，adapter 不代替 reviewer 自动同意。当前菜单只支持上述三种模式，未接入命名权限 profiles 或 `Custom (config.toml)`。

## 事件映射与顺序

Runtime 使用固定 DSH 版本已经定义的 Session 事件；插件绑定日志放入 `request/context` 扩展字段。一个 Codex turn 对应一个 DSH turn，并在工具阶段与最终答案阶段之间加入兼容 step：

```text
turn/start
step/start (1)
user/message
request/header
assistant stream(reasoning/commentary/tool-call)
assistant/message(process)
tool/call + tool/result
step/end (1)
step/start (2)
assistant stream(final text/usage)
assistant/message(final)
step/end (2)
turn/end
```

工具的 `tool-call` block、`tool/call` 与 `tool/result` 共享 `codex:<native-item-id>`。每次工具开始时先提交包含该 tool-call block 的过程 Assistant，再写入调用与结果，满足 DSH V4 持久化要求的生命周期顺序；同一阶段可包含多个独立的过程 Assistant。Commentary 完成时即提交为文本，partial answer 在后续输出或 turn 结束时提交，均不映射为 reasoning。异步问题独立提交，不结算正在输出的答案。最终答案排除 commentary 和异步问题，结合 turn 的完成状态标记 terminal，也支持原生 turn 以稳定的 partial answer 结束。未返回结果的工具在 turn 结束前记录 outcome unknown，避免遗留未闭合调用。原生工具事件是观测，不会调用 `ctx.tools.execute()`。

Codex 每个 assistant attempt 独立结算，结束后立即用其持久化消息替换 transient，不等待整个兼容 step 结束。异步问题的消息身份与答案流不同，不能被当作答案流的结算事件。最终答案与过程消息均保留各自的 attempt 节点身份，只有最终答案发布标准 Step 的回答数据，供 token、footer 和 fork 消费。

命令和文件审批映射到 `ctx.approval`，权限审批只返回 App Server 请求的 network/fileSystem 字段，request-user-input 映射到 `ctx.userQuestions`。缺少交互 provider 时安全拒绝。当前 DSH 没有结构化 MCP elicitation 回答服务，因此该请求返回 decline。未知 App Server 请求会失败当前 turn。

## 原生历史展示

Session Controller 的既有 projections 读取在同一个已授权 Session observation 上取得原生历史。只读取该事件前缀中有明确绑定且完整结束的 turn，调用分页的 `thread/items/list`，不 resume、不发送模型输入；不完整的 fork turn 不读取原生后缀。App Server owner 缓存完成 turn 的原生 item，活动 turn 的问题扫描不使用这个缓存。调用方取消不会取消另一个调用方的读取；读取失败记录诊断并保留本地历史。

Client 将原生历史附着到当前窗口的 Turn 和事件身份上，Chat 和 Trajectory 按原生 item 顺序计算展示 anchor，节点的原始 Session seq 保留给分支和定位。Chat 只调整消息和工具节点的位置；整轮控制与 footer 保留生命周期位置，折叠范围使用与节点相同的展示坐标，同一步内的 commentary 也计入可折叠过程。已有过程消息从本地事件恢复，旧 commentary 的类型可由原生历史校正。缺失文本使用带稳定 native item 身份的只读 transient 节点补显，不写 Session 文件、不改变持久化游标，也不重新弹出历史问题。分页窗口缺少 Turn 开头时仍对齐已加载内容，只补显当前窗口所覆盖的原生范围。刷新、恢复和 turn 完成后的核对复用同一投影；历史不可用时继续展示本地内容。

异步问题除标准 item 通知外，还通过工具完成后的原生历史后缀读取补齐。扫描使用排他 item cursor，并合并并发触发。问题交给 DSH 提问服务，回答在同一活动 turn 中 steer，已结束时作为 followup；取消和释放撤销未回答的请求。问题正文独立落盘，不能混入正在输出的答案。

## Token 映射

App Server 的 `inputTokens` 同时包含 cache read 与 cache write。DSH `inputTokens` 记录 `input - cacheRead - cacheWrite`，并分别保存 `cacheReadTokens`、`cacheWriteTokens`、`outputTokens`、`reasoningTokens` 与原生 `totalTokens`。ChatGPT 配额、重置时间和费用不属于 turn token usage，不进入该映射。

## 发布边界

发布包只包含编译入口、类型、Bundle patch 与许可证说明。声明式 preset 位于 patch 中，不再发布 preset asset。`upstream/`、`compat/generated/`、测试、缓存、Session、日志与认证文件均不在 npm `files` 清单中。运行时代码没有 submodule 路径依赖。

[`compat/manifest.json`](../compat/manifest.json) 集中兼容版本、provider、patch 和产物；基线 commit 唯一取父仓库 index stage 0 gitlink。发布声明统一使用 `.js` 相对导入，并检查不得引用开发目录。transport 使用上游原实现，浏览器类型入口显式加载上游公开 `/remote` augmentation，不维护另一份 Remote 协议。空的 type-only import 会被编译擦除，不能依赖它让消费者自动获得扩展声明；Host 与 Client 分别在包外用 `skipLibCheck: false` 检查。

插件、集成验证和 Desktop 分开构建。插件只准备依赖闭包；Desktop 在 `.tmp/desktop-source` 使用固定上游锁文件与私有依赖。所有 Desktop workaround 只作用于该副本，`desktop-source.mts` 是加载其私有源码的唯一适配入口；参考 submodule 只允许生成忽略的编译产物。

日常开发以 tgz 安装到隔离 Profile；成品以 `external` 模式配对 App、插件 tgz 和 manifest，用户安装插件后组合生效。数据目录、环境变量、缓存边界和打包流程统一见 [Desktop 开发与交付](desktop.md)，验证分层见[测试](testing.md)。
