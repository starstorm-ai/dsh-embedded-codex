---
description: "在不修改 DeepSeek Harness 源码的前提下，让 embedded-codex 对齐 Codex 权限模式的实现计划。"
kind: "architecture"
---

# Embedded Codex 权限管理实现计划

## 1. 结论

本方案把“完全照抄 Codex”定义为：`embedded-codex` 会话使用与 Codex 相同的权限模式、沙盒边界、审批路由和网络行为；DSH 继续提供现有选择器与人工审批界面，不复制 Codex 桌面端的像素级 UI。

实现全部位于 `dsh-embedded-codex` Bundle：

1. 增加一个版本锁定的 Permission Presets 兼容 provider，只在 `embedded-codex` Agent 预设下投影 Codex 权限模式。
2. 保留 DSH 原有 `/permission` 命令、`permission/preset`、`sandbox/mode`、`approval/policy` 事件和 `permissions` projection，因此不增加 DSH API 或持久化格式。
3. 每次 `turn/start` 都从当前 Session 重新解析权限，并显式传给 Codex App Server。
4. 标准、PTC 等非 Codex Agent 预设继续看到并执行 DSH 原来的权限模式。
5. 不修改 `upstream/deepseek-harness`，不向 DSH 安装目录写源码，不做运行时 monkey patch。

Bundle 会通过 `cordis.patch.yml` 禁用 DSH 原 `permission` provider 行并插入本包的兼容 provider。这与仓库已经替换 `agent`、`agent-presets` 和 `session-controller` 的方式一致，属于外部插件组合，不是修改 DSH 本体。

## 2. 权限基线

OpenAI 官方权限模式由沙盒、审批策略和审批者三个维度共同决定。官方说明见 [Permissions](https://developers.openai.com/docs/permission-modes)、[Sandbox](https://developers.openai.com/docs/sandboxing)、[Auto-review](https://developers.openai.com/docs/sandboxing/auto-review) 和 [Codex App Server](https://developers.openai.com/docs/app-server)。

| 稳定 ID | UI 名称 | `approvalPolicy` | `approvalsReviewer` | `sandboxPolicy` | 网络行为 |
|---|---|---|---|---|---|
| `ask-for-approval` | 请批准 / Ask for approval | `on-request` | `user` | `workspaceWrite` | 默认禁止；越界时向用户申请 |
| `approve-for-me` | 帮我批准 / Approve for me | `on-request` | `auto_review` | `workspaceWrite` | 默认禁止；符合条件的越界请求交给自动审核 |
| `danger-full-access` | 完全权限 / Full access | `never` | `user`，此时无实际作用 | `dangerFullAccess` | 不受 Codex 文件和网络沙盒限制 |

两个工作区模式必须传完整策略：

```ts
{
  type: 'workspaceWrite',
  writableRoots: [cwd],
  networkAccess: false,
  excludeTmpdirEnvVar: false,
  excludeSlashTmp: false,
}
```

`networkAccess: false` 不是“永远禁网”。在 `on-request` 下，它表示网络位于沙盒边界之外：请批准模式把请求交给用户，帮我批准模式把符合条件的请求交给 Auto-review。Auto-review 只改变审批者，不扩大文件、网络或 writable roots。

DSH 的底层权限元组保持如下，以便继续使用现有投影和人工审批服务：

| Codex 模式 | DSH sandbox | DSH approval | 区分相同元组的事实 |
|---|---|---|---|
| `ask-for-approval` | `workspace-write` | `ask` | `permission/preset = ask-for-approval` |
| `approve-for-me` | `workspace-write` | `ask` | `permission/preset = approve-for-me` |
| `danger-full-access` | `danger-full-access` | `never` | `permission/preset = danger-full-access` |

`ask-for-approval` 和 `approve-for-me` 共用同一 DSH 元组是有意设计。现有 Permission Presets 服务会用最近的 `permission/preset` 保留同元组下的用户选择，Codex adapter 再把该选择翻译成不同的 `approvalsReviewer`。

## 3. 实施前缺口

本计划实施前的基线存在四个直接缺口：

- [`src/index.ts`](../src/index.ts) 把 `approvalPolicy` 和 `sandbox` 定义成整个部署共享的静态配置，没有读取 Session 权限。
- [`src/app-server.ts`](../src/app-server.ts) 只在 `thread/start`、`thread/resume` 和 `thread/fork` 发送静态值，并把 `approvalsReviewer` 固定为 `user`。
- `CodexRemoteThread.startTurn()` 没有在 `turn/start` 发送 `approvalPolicy`、`approvalsReviewer` 或 `sandboxPolicy`，因此 UI 切换不能影响下一轮。
- 工作区沙盒没有显式 `networkAccess`，实际联网行为依赖 Codex 配置默认值，无法由当前 Session 权限确定。

仓库固定的 App Server 协议已经具备所需字段：[`TurnStartParams`](../protocol/v2/TurnStartParams.ts) 支持逐轮覆盖三项设置，[`SandboxPolicy`](../protocol/v2/SandboxPolicy.ts) 支持工作区 writable roots 和网络开关，[`ApprovalsReviewer`](../protocol/v2/ApprovalsReviewer.ts) 支持 `user` 与 `auto_review`。

## 4. 目标与边界

### 4.1 必须达到

- 新建 `embedded-codex` Session 时默认选择“请批准”。
- 切换权限后，从下一个新 Codex turn 起立即生效；无需重建 Session 或 App Server。
- resume 和 fork 保留来源 Session 的精确模式，包括“帮我批准”。
- 标准 DSH Agent 预设的权限选项、默认值和执行行为保持不变。
- Ask 模式的命令、文件和 `request_permissions` 请求仍进入 DSH 审批 UI。
- Auto-review 模式仍处于相同沙盒内，不把 `auto_review` 错误映射为 `never`。
- Full access 同时取消 Codex 文件和网络沙盒，并且保留现有二次风险确认。
- 不存在静态配置与 Session 权限同时控制 App Server 的双真源。
- 未知、损坏或不受支持的权限状态必须拒绝启动 turn，不能静默降级为更宽权限。

### 4.2 本阶段不做

- 不复制 Codex 桌面端的 React 组件、图标和布局；兼容 UI 继续使用固定 DSH 版本的 PermissionSelect、Menu、风险确认和盾牌图标，只扩展 preset ID 与 locale 映射。
- 不修改 DSH 的 ApprovalService 返回类型，因此人工批准仍是单次批准，不擅自升级为 `acceptForSession`。
- 不在第一阶段接入 Beta 的 Codex 命名权限 profiles。官方将该能力标为 Beta；当前固定的 `@openai/codex@0.149.1` 虽可列出 profile，但生成的 thread/turn 参数尚无稳定的 profile 选择字段。该能力见第 12 节。

## 5. 总体数据流

```text
DSH PermissionSelect
  -> /permission <preset>
  -> embedded-codex Permission Presets provider
  -> permission/preset + sandbox/mode + approval/policy
  -> permissions Session projection
  -> EmbeddedCodexAgent 在新 turn 开始前读取
  -> resolveCodexPermission(mode, cwd)
  -> turn/start { approvalPolicy, approvalsReviewer, sandboxPolicy }

Codex 越界请求
  -> Ask: App Server request -> ctx.approval -> DSH 用户审批
  -> Auto-review: Codex reviewer agent 决策；仍需用户处理的请求继续走 DSH
  -> Full access: 无沙盒越界请求
```

Session projection 是权限真源；App Server thread 中保存的设置只是最近一次同步结果。即使 App Server 会让逐轮覆盖成为后续 turn 的默认值，adapter 仍在每个 `turn/start` 重发完整策略，以消除恢复、切换和外部配置变化造成的漂移。

## 6. 插件组合设计

### 6.1 新增兼容 provider

新增导出 `dsh-embedded-codex/compat/permission-presets`。构建时从固定 DSH submodule 复制 `packages/interaction/permission-presets/src`，只对复制品应用可审计的单文件 patch；不编辑 `compat/generated`，也不编辑 upstream。

`cordis.patch.yml` 增加以下组合操作：

1. 以 `id: permission` 和原 package 名为 guard，禁用 `@deepseek-ai/dsh-permission-presets`。
2. 插入唯一的 `embedded-codex-permission-presets`，指向本包兼容 provider。
3. 以原 package 名为 guard 禁用 `ui-conversation` 和 `ui-permission`，插入本包的同职责 Host half。
4. 本包的 immediate Web bundle 预注册从同一固定 DSH 版本取得的两个 UI factory，再由本包 client root 将它们挂载到 Cordis；不会同时运行原 UI owner。
5. 将六项替换加入 Runtime 的 Profile composition 断言和打包验证。

UI bundle overlay 只增加两个 Codex preset 的 locale、说明和图标别名，其他代码仍是固定版本 DSH 的实现。它不会让两个服务同时注册 `ctx.permissionPresets`、`permissions` projection、Conversation slots 或 `/permission`。

### 6.2 provider-aware 权限表

兼容 provider 保留标准表，并增加只对 `agentPreset === 'embedded-codex'` 生效的 Codex 表：

```yaml
standard:
  read-only:             { sandbox: read-only,          approval: ask }
  workspace-write:       { sandbox: workspace-write,    approval: ask }
  danger-full-access:    { sandbox: danger-full-access, approval: never }

embedded-codex:
  ask-for-approval:      { sandbox: workspace-write,    approval: ask }
  approve-for-me:        { sandbox: workspace-write,    approval: ask }
  danger-full-access:    { sandbox: danger-full-access, approval: never }
```

Permission projection 的内部状态版本从 2 升到 3，增加 `agentPreset: string | null`：

- 初始化时读取 Session header 的 `agentPreset`。
- 折叠 `agent-preset/selected` 事件，以便空 Session 切换 Runtime 后立刻重算选项。
- wire 输出仍是现有 `PermissionSelect`，不改变客户端协议。
- `current()`、`resolve()`、`names`、`selectFor()` 和 `/permission` handler 都按当前 Agent preset 选择表。

### 6.3 模式迁移规则

| 原状态 | 切到 `embedded-codex` 后 | 原因 |
|---|---|---|
| `workspace-write + ask` | `ask-for-approval` | 两者边界相同，选择 Codex 表中的第一安全模式 |
| `danger-full-access + never` | `danger-full-access` | 用户已经明确选择完全访问，不扩大现有权限 |
| `read-only + ask` | `custom`，提交 turn 前要求用户选择 | 不把只读会话静默扩大为可写 |
| `approve-for-me` | `approve-for-me` | 同元组时最近的 `permission/preset` 保留精确意图 |

切回标准 Agent 预设时，Ask 和 Auto-review 都自然投影为标准 `workspace-write`，Full access 投影为标准 `danger-full-access`。不需要写额外回滚事件，也不会把 Codex 专属选项暴露给标准 Runtime。

`/permission` 在 Codex turn 正在运行时拒绝切换，并提示等待当前 turn 结束。原因是 `turn/steer` 不支持权限覆盖，而 DSH approval policy 若在活动 turn 中先改变，会与该 turn 已锁定的 App Server 策略短暂不一致。空闲时切换，下一次 `turn/start` 生效。

### 6.4 UI locale 与图标

| Preset ID | 中文 | English | DSH 图标来源 |
|---|---|---|---|
| `ask-for-approval` | 请批准 | Ask for approval | `workspace-write` 盾牌 |
| `approve-for-me` | 帮我批准 | Approve for me | `read-only` 勾选盾牌 |
| `danger-full-access` | 完全权限 | Full access | 原 Full access 警示盾牌 |

Conversation 选择器和 `/permission` popup 使用同一组中英文名称；前两项的 tooltip/detail 也随 locale 切换。构建脚本对固定 DSH client bundle 使用唯一锚点替换，锚点缺失或重复都会失败，并移除构建机路径与失效 source map。此过程只读 upstream，不修改 submodule 或安装目录。

## 7. Runtime 权限解析

新增 `src/permissions.ts`，集中定义：

```ts
type CodexPermissionMode =
  | 'ask-for-approval'
  | 'approve-for-me'
  | 'danger-full-access'

interface ResolvedCodexPermission {
  mode: CodexPermissionMode
  approvalPolicy: 'on-request' | 'never'
  approvalsReviewer: 'user' | 'auto_review'
  threadSandbox: 'workspace-write' | 'danger-full-access'
  sandboxPolicy: SandboxPolicy
}
```

`resolveCodexPermission(mode, cwd)` 是唯一映射函数，并承担以下校验：

- `cwd` 必须是绝对路径。
- `ask-for-approval` 和 `approve-for-me` 的 writable root 只能是当前 Session cwd。
- 两个工作区模式固定 `networkAccess: false`。
- Full access 只能产生 `dangerFullAccess + never`。
- `custom`、标准 DSH preset 名或未知值直接报错，错误文本要求用户从权限菜单选择 Codex 模式。

`EmbeddedCodexRuntime` 增加对 `permissionPresets` 的严格依赖。正常 Web Profile 不再从插件静态配置取得沙盒或审批策略；它在创建 Agent、恢复、fork 和每次新 turn 前从 Session projection 取得模式。

## 8. App Server 改造

### 8.1 thread 创建、恢复和 fork

`CodexAppServerHost.startThread()`、`resumeThread()`、`forkThread()` 接收一次解析后的 `ResolvedCodexPermission`，发送：

```ts
{
  approvalPolicy,
  approvalsReviewer,
  sandbox: threadSandbox,
}
```

thread 级字段用于建立正确初始值；精确 writable roots 和网络开关由首个 `turn/start.sandboxPolicy` 设置。App Server 返回的 `approvalPolicy`、`approvalsReviewer` 和 sandbox 类型需要校验；若服务端拒绝或重写为更宽策略，attach 失败。

### 8.2 每轮同步

`CodexRemoteThread.startTurn()` 新增 permission 参数，并在 `turn/start` 发送完整三元组：

```ts
{
  threadId,
  input,
  approvalPolicy,
  approvalsReviewer,
  sandboxPolicy,
  // model、effort 等现有字段
}
```

解析和发送发生在输入已通过 `agent/pre-step`、但原生 turn 尚未创建的阶段。一次 turn 只读取一次权限快照；同一活动 turn 的 steering 沿用该快照。下一次普通 turn 再读取最新 Session 状态。

### 8.3 审批请求

现有 [`src/agent.ts`](../src/agent.ts) 路由继续保留：

- `item/commandExecution/requestApproval` 和 `item/fileChange/requestApproval` 映射到 `ctx.approval.request()`。
- `item/permissions/requestApproval` 只回传 App Server 本次请求中出现的 network/fileSystem 子集，scope 保持 `turn`。
- 缺少 DSH approval provider 时安全拒绝。
- Auto-review 决定的请求不应再次由 adapter 人工批准；仍由 App Server 发给 client 的请求按用户审批处理。

## 9. 配置迁移

当前 `embedded-codex` 配置中的 `approvalPolicy` 和 `sandbox` 会形成第二真源，应分两步移除：

1. 首个兼容版本保留字段解析，但仅作为没有 Permission Presets provider 时的显式 fallback，并输出弃用警告；官方 Bundle 组合不走该路径。
2. 下一个破坏性版本删除两个字段，保留 Session 权限为唯一来源。

不增加独立 `networkAccess` 开关。网络是 Codex 模式语义的一部分：Ask/Auto-review 在边界处请求，Full access 直接允许。否则 UI 会出现 Codex 没有的第四个正交开关，并重新产生不可解释的组合。

Auto-review 和 Full access 是否显示可以作为 embedded-codex provider 配置，但 Ask 必须始终存在。默认发布配置启用三项；组织限制仍由 App Server 最终执行，插件不得绕过 `requirements.toml`。

## 10. 文件级实施清单

| 文件 | 计划修改 |
|---|---|
| `cordis.patch.yml` | 安全禁用原 permission provider 与两个权限 UI owner，插入兼容实现 |
| `scripts/build.mts` | 复制 permission-presets 源码、装配兼容 UI bundle，并校验产物与 Profile 替换关系 |
| `scripts/lib/permission-ui-overrides.mts` | 唯一锚点添加中英文文案、说明、DSH 图标别名和三 factory 装配 |
| `compat/patches/packages+interaction+permission-presets+src+index.ts.patch` | 增加按 Agent preset 选择权限表、projection state v3 和活动 turn guard |
| `src/compat/providers/permission-presets.ts` | 版本检查后的 provider 发布入口 |
| `src/compat/providers/ui-conversation.ts`、`ui-permission-presets.ts` | 两个被替换 UI owner 的 Host half |
| `src/client/index.ts` | 先安装兼容 Session Controller，再挂载两个兼容 DSH UI factory |
| `tsconfig.compat-permissions.json` | 兼容 provider 类型构建入口和路径映射 |
| `tsdown.config.ts` | 生成 `lib/compat/permission-presets.js` |
| `package.json` | 增加 export、发布文件和所需 DSH peer dependencies |
| `src/permissions.ts` | Codex 三模式的纯映射和校验 |
| `src/index.ts` | 注入 permissionPresets，移除静态权限正常路径，扩展 Profile 组合断言 |
| `src/app-server.ts` | thread 与 turn 接收并发送动态权限，验证 thread 返回值 |
| `src/agent.ts` | 每个新 turn 读取一次权限；steering 保持当前 turn 快照 |
| `tests/runtime.spec.ts` | 断言每种模式的 JSON-RPC、运行中切换、审批路由、resume 与 fork |
| `tests/profile-composition.spec.ts` | 断言原 permission 被安全禁用且替换唯一存在 |
| `tests/permission-ui-overrides.spec.ts` | 断言中英文 locale、说明、图标别名和 factory 顺序 |
| `tests/compatibility.spec.ts` | 将 permission provider 纳入版本锁和产物检查 |
| `README.md`、`docs/architecture.md`、`docs/testing.md` | 更新用户配置、数据流、限制和真实账号验收步骤 |

`compat/generated`、`lib` 和 `upstream/deepseek-harness` 都是生成物或只读输入，不直接编辑。

## 11. 测试与验收

### 11.1 自动测试

1. 纯映射测试覆盖三种模式的全部字段，特别固定 `networkAccess: false` 与 writable roots。
2. Permission projection 测试覆盖标准表、Codex 表、相同元组保留 preset、Agent preset 切换和 `custom` 状态。
3. Profile 组合测试确认原 `permission`、`ui-conversation` 与 `ui-permission` 被 name guard 禁用，每个替代项只有一个。
4. Fake App Server 记录并断言 `thread/start`、`thread/resume`、`thread/fork` 和每次 `turn/start` 的权限字段。
5. 同一 Session 依次运行 Ask、Auto-review、Full 三轮，证明无需重建 thread 且每轮读取最新 projection。
6. 活动 turn 中 `/permission` 被拒绝，turn 完成后同一切换成功。
7. Ask 模式的 command、file change、permission request 到达 DSH approval mock；拒绝、取消和缺少 provider 都 fail closed。
8. Auto-review 模式断言 reviewer 字段为 `auto_review`，绝不把 DSH `ask` 翻译成 `never`。
9. resume 和 fork 继承精确 `permission/preset`，包括与 Ask 共用底层元组的 Auto-review。
10. UI overlay 测试覆盖中文/英文名称与说明、三个 DSH 盾牌图标映射、构建路径清理和 factory 预注册顺序。
11. `pnpm test` 完成 build、Vitest、lint、文档检查和真实 tarball 组合安装。

### 11.2 真实账号验收

在支持 Auto-review 的 ChatGPT Codex 账号上执行：

1. 新建 Session，选择 `Codex 模式`；中文确认“请批准 / 帮我批准 / 完全权限”，英文确认 “Ask for approval / Approve for me / Full access”，并确认三项均有 DSH 盾牌图标。
2. Ask 下访问 workspace 外文件和网络，确认出现 DSH 人工审批；拒绝后操作不执行。
3. 切换 Auto-review，重复相同边界操作，确认出现 Codex 自动审核事件，普通安全操作不额外询问。
4. 切换 Full access，完成风险确认，确认无沙盒审批且网络可用。
5. 切回 Ask，确认下一轮重新处于 workspace 与网络边界内。
6. 重启 DSH 后恢复 Session，再 fork，确认两者保留精确模式。
7. 新建标准模式 Session，确认仍显示 DSH 原来的 Read only、Workspace write、Full access，执行行为未变化。

### 11.3 完成标准

以下条件全部满足才视为交付完成：

- 三个模式的 App Server 请求字段与第 2 节矩阵完全一致。
- 权限切换最迟在下一新 turn 生效，且不会污染活动 turn。
- 标准 Agent 预设行为零变化。
- Full access 仍有风险确认，所有未知状态 fail closed。
- 发布包不包含 upstream、generated source、本机绝对路径或认证数据。
- `pnpm test` 通过，真实账号矩阵有记录。

## 12. Beta 权限 profiles 的后续阶段

Codex 当前还支持 `:read-only`、`:workspace`、`:danger-full-access` 和 `[permissions.<name>]` 命名 profiles，详见 [Codex permission profiles](https://developers.openai.com/docs/permissions)。这些 profiles 可以同时描述精细文件规则和域名网络规则，但官方明确标记为 Beta，并且不能与旧 `sandbox_mode` 配置混用。

仓库固定的 `@openai/codex@0.149.1` 协议包含 `permissionProfile/list`，但生成的 `ThreadStartParams` 和 `TurnStartParams` 尚未提供稳定的 profile 选择字段。因此本阶段不能只靠 profile 名安全完成端到端选择，也不能假装支持 `Custom (config.toml)`。

后续接入条件是：

1. 固定的新 App Server 版本在生成协议中正式提供 thread/turn profile 选择字段。
2. `permissionProfile/list` 能返回 allowed 状态和描述，managed requirements 的拒绝可在 UI 前置呈现。
3. adapter 能读取 `thread/settings/updated.activePermissionProfile` 并验证服务端实际采用的 profile。
4. profile 模式与本计划的 legacy sandbox 模式互斥，不能同时发送。
5. 增加独立兼容与迁移测试后，才把 named profiles 和 `Custom (config.toml)` 纳入菜单。

在这些条件满足前，三种稳定 Codex 模式是唯一受支持的权限接口。

## 13. 风险与回滚

| 风险 | 控制措施 |
|---|---|
| Auto-review 不受账号或组织策略支持 | App Server 保持最终权威；拒绝时给出明确错误，不自动升级到 Full access |
| DSH 上游 permission provider 变化 | 固定 submodule、单文件 patch、Host 版本检查和 Profile name guard 共同 fail fast |
| DSH 上游权限 UI bundle 变化 | 固定版本、UI package 版本检查、唯一锚点替换和 overlay 单测共同 fail fast |
| 活动 turn 中切换导致策略分裂 | Codex Runtime 运行时拒绝切换，下一新 turn 再同步 |
| writable root 或网络值遗漏 | 使用一个纯映射函数和完整对象断言，不依赖 App Server 默认值 |
| 标准 Runtime 被 Codex 选项污染 | provider 按 `agentPreset` 输出不同表，标准表保持原样 |
| 卸载插件后残留 `approve-for-me` 事件 | 原 DSH provider 会忽略未知 preset 意图，并根据同一 `workspace-write + ask` 元组恢复为标准 Workspace write |

回滚只需从 Web Profile 移除 `dsh-embedded-codex` 并重启 DSH。Bundle overlay 随插件卸载，四个原 provider 与两个原 UI owner 自动恢复；没有 DSH 源文件需要还原。
