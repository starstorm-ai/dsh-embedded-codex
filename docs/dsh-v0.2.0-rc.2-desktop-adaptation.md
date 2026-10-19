# dsh-embedded-codex 适配 DSH dsh-v0.2.0-rc.2 与最新 Codex CLI

状态：实施前技术梳理

基线日期：2026-09-30

目标 DSH：dsh-v0.2.0-rc.2，commit 639ed015397290b3745d163aafe02ffee4aa3f84

当前 embedded-codex 基线：DSH dsh-v0.1.2-rc.1，commit a66e4702047846cdaa10c66c9d3df3951f5ea70d；@openai/codex 0.149.1

## 1. 结论

这次升级不是版本号替换，而是一次兼容层重做。建议目标为：

- 精确支持 DSH dsh-v0.2.0-rc.2，不声明宽泛 semver 兼容。
- 将嵌入式 Codex CLI 固定升级到 npm stable latest：@openai/codex 0.159.2。0.161.0-alpha.3 是 alpha，不作为本次交付基线。
- 第一阶段以 Desktop 外置插件方式安装到 desktop profile；不修改 Desktop 的签名应用运行时。
- 开发、验收和客户端交付以 Electron Desktop 为主入口：补齐 build:desktop、dev:desktop、start:desktop、prepare:desktop 和完整 package:desktop:* 脚本矩阵；dev:web 仅保留为 Web 回归入口。
- package:desktop* 必须产出可运行的 Desktop 客户端候选制品及其精确匹配的 embedded-codex 插件制品，不能只是 pnpm pack 的别名，也不能在内部启动 dsh web。
- Desktop 仍使用 dsh.client.platform: web。Desktop 是 Electron 壳中的完整 DSH Web 应用，并不存在需要本插件切换到的 desktop client platform。
- 将原来的 agent-presets 兼容层迁移到 agent-preset-registry + agent-preset 声明模型。
- 重新 rebase Agent、Preset Registry、Permission、Session Controller 四个业务 Host replacement，并增加一个窄化的 Config Editor replacement，使同 id Registry 的设置写回语义与 Loader 一致。
- Conversation UI 回归 DSH 原实现；Permission UI 保留一个缩小后的 replacement，以维持 embedded-codex 与标准 Agent 各自不同的权限选项。
- 保留 package-local Codex 二进制解析，不依赖 PATH 中的全局 codex。全局 CLI 只用于登录和诊断。

不能直接复用现有补丁：8 个补丁中只有 2 个可在目标 tag 上干净应用，5 个发生冲突，另 1 个的目标文件已经被删除。

## 2. 基线对比

| 项目 | 当前 | 目标 | 影响 |
|---|---|---|---|
| DSH | dsh-v0.1.2-rc.1 | dsh-v0.2.0-rc.2 | 必须重新锁版本并 rebase compatibility sources |
| DSH commit | a66e4702… | 639ed015… | submodule、构建戳和第三方声明同步更新 |
| Codex CLI | 0.149.1 | 0.159.2 stable | 更新依赖、lockfile、生成协议和真实 App Server smoke |
| Preset 包 | @deepseek-ai/dsh-agent-presets | @deepseek-ai/dsh-agent-preset-registry + @deepseek-ai/dsh-agent-preset | 旧 preset root、preset.yml、registerRoot 全部失效 |
| Desktop | 不存在 | Electron Desktop | 增加 desktop profile、Electron Node、安装/签名/升级场景 |
| Native workspace | native/landlock-run | native/system | 外层 pnpm workspace 路径必须更新 |
| pi-ai | 外层强制 0.84.2 | DSH 使用并 patch 0.87.1 | 旧 override 会把目标 DSH 拉回不兼容版本 |
| Permission UI 数据 | Session projection 带选项 | process catalog + Session 只带 currentValue | provider-aware 权限不能原样搬运 |

目标源码以 [DSH dsh-v0.2.0-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.0-rc.2) 为准。

## 3. 推荐交付形态

### 3.1 第一阶段：Desktop 外置插件

推荐将 dsh-embedded-codex 发布为普通 npm 包或 tgz，通过 Desktop 自带的 dsh 命令安装到 desktop profile。

流程是：

1. 启动 Desktop 一次，让它初始化 desktop profile。
2. 完全退出应用；仅关闭窗口不够，Windows 会驻留托盘，macOS 也可能继续运行。
3. 使用 Desktop 注册的 dsh 命令执行：

~~~text
dsh --version
dsh plugin --profile desktop add dsh-embedded-codex@<candidate-version>
dsh plugin --profile desktop list
~~~

4. 重新打开 Desktop。

这个模式符合 DSH Desktop 的所有权边界：

- $DSH_HOME/profiles/desktop 由 Desktop 独占。
- npm 安装的另一份 dsh 不能修改保留的 desktop profile。
- CLI 只能在 Desktop 完全退出时管理插件，不能启动 desktop profile。
- 外置插件和它的 @openai/codex 平台包保存在 profile 中，可独立于 Desktop 应用更新。

详见目标 tag 的 [Desktop README](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/apps/desktop/README.md)。

### 3.2 Desktop client 是默认开发和打包入口

“插件仍按外置方式发布”和“本仓库提供 Desktop 打包脚本”并不冲突。前者定义插件如何进入用户 profile，后者定义开发团队交付、安装和验收的是 Electron 客户端，而不是单独启动的 Web 页面。

这里的“用于客户端，而不是 Web”指命令入口、profile 和最终制品必须走 Desktop；不代表把 dsh.client.platform 从 web 改成 desktop。Desktop renderer 仍加载 DSH Web client bundle，所以插件元数据继续声明 platform: web。

当前 scripts/dev.mts 固定执行 dsh web，开发 profile 路径也固定为 profiles/web；现有 dev、dev:install、dev:web、dev:remove 因此都不能作为 Desktop 支持的验收证据。适配后建议在根 package.json 增加并对齐目标 DSH 的脚本面：

~~~json
{
  "scripts": {
    "dev": "pnpm run dev:desktop",
    "build:desktop": "tsx scripts/desktop.mts build",
    "dev:desktop": "tsx scripts/desktop.mts dev",
    "start:desktop": "tsx scripts/desktop.mts start",
    "prepare:desktop": "tsx scripts/desktop.mts prepare",
    "package:desktop": "tsx scripts/desktop.mts package",
    "package:desktop:dir": "tsx scripts/desktop.mts package --dir",
    "package:desktop:mac:arm64": "tsx scripts/desktop.mts package mac-arm64",
    "package:desktop:mac:arm64:dir": "tsx scripts/desktop.mts package mac-arm64 --dir",
    "package:desktop:mac:x64": "tsx scripts/desktop.mts package mac-x64",
    "package:desktop:mac:x64:dir": "tsx scripts/desktop.mts package mac-x64 --dir",
    "package:desktop:win:x64": "tsx scripts/desktop.mts package win-x64",
    "package:desktop:win:x64:unsigned": "tsx scripts/desktop.mts package win-x64 --unsigned",
    "package:desktop:win:x64:dir": "tsx scripts/desktop.mts package win-x64 --dir",
    "pack:plugin": "tsx scripts/desktop.mts pack-plugin",
    "desktop:install-plugin": "tsx scripts/desktop.mts install-plugin",
    "desktop:remove-plugin": "tsx scripts/desktop.mts remove-plugin",
    "dev:web": "tsx scripts/dev.mts web"
  }
}
~~~

脚本名与目标 DSH dsh-v0.2.0-rc.2 的正式 Desktop 命令矩阵保持一致。scripts/desktop.mts 负责本仓库的编排，再转发到 upstream/deepseek-harness 的对应命令；不能把上游命令字符串复制成多个各自漂移的实现。

各入口的完成定义如下：

- dev:desktop：构建插件，把 link 或 tgz 安装到隔离的 profiles/desktop，然后启动 Electron 开发客户端。默认 dev 指向它。
- start:desktop：复用已有构建结果，重建隔离的 Desktop disposable project 并启动 Electron；不得隐式回退到 Web。
- prepare:desktop：准备 DSH Desktop package set，同时生成 embedded-codex tgz、版本清单和平台原生依赖清单。
- package:desktop：按当前宿主的默认 target 产出 Electron 客户端候选包；不是插件 npm/tgz 的打包命令。
- package:desktop:*：显式覆盖 Windows x64、macOS x64、macOS arm64，以及 dir、signed/unsigned 变体；参数和退出码原样传给上游打包器。
- pack:plugin：只生成独立插件 tgz。该命令故意不叫 package:desktop，避免把两种制品混为一谈。
- desktop:install-plugin / desktop:remove-plugin：仅在 Desktop 完全退出时管理 --profile desktop，不得访问 profiles/web。
- dev:web：保留为参考回归，不再是默认开发路径，也不计入 Desktop 验收。

第一阶段采用外置插件时，每次 package:desktop* 运行至少应输出一个可追踪的 Desktop 交付目录：

~~~text
dist/desktop/<target>/
  <Desktop installer、archive 或 unpacked app>
  plugins/dsh-embedded-codex-<version>.tgz
  integration-manifest.json
~~~

integration-manifest.json 至少记录 DSH tag/commit、Desktop build version、embedded-codex version、@openai/codex version、target、arch、插件 tgz 的 SHA-256，以及签名状态。客户端候选包首次启动完成 profile 初始化后，安装或 smoke 步骤必须通过 Desktop 注册的 dsh 命令把同目录 tgz 加入 --profile desktop，再启动客户端验证；不能拿 Web profile 的成功代替。

这里有一个必须显式处理的上游边界：目标 DSH 的 prepare-package-set.ts 只以 @deepseek-ai/dsh 和 Desktop Host 为 package-set roots，直接转发 pnpm run package:desktop 不会自动把 dsh-embedded-codex 装进应用。因此 scripts/desktop.mts 必须在以下两种模式中明确选择，且制品清单要能辨认：

1. external（第一阶段默认）：Electron 制品与插件 tgz 成对交付，安装测试落到 desktop profile。
2. builtin：把 embedded-codex 加入 Desktop package graph 和初始 bundle 声明；此时还要完成 3.3 的原生二进制、签名和不可变 runtime 审计。

禁止出现第三种“package:desktop 返回成功，但制品既不包含插件，也没有配套 tgz/manifest”的状态。

### 3.3 暂不推荐：内置到 Desktop 安装包

若要做到开箱即用或完全离线，可把 embedded-codex 加入 Desktop 内置 bundle/package graph，但这会扩大范围：

- @openai/codex 的平台原生二进制必须进入 Desktop package inventory。
- Windows 需要 PE 扫描、签名和最终签名审计。
- macOS 需要验证打包位置、可执行权限、签名、notarization 和 Gatekeeper。
- 原生可执行文件不能被简单放进不可执行的 ASAR 路径。
- 每个 Desktop 更新都要联合验证 shell、DSH、插件与 Codex CLI。

除非产品要求“安装 Desktop 后无需再装插件”，否则先不走此路径。

## 4. DSH breaking changes 与适配项

### 4.1 Agent Preset 模型完全更换

旧包 @deepseek-ai/dsh-agent-presets 和 packages/preset/agent-presets 已不存在。目标版本改成：

- @deepseek-ai/dsh-agent-preset-registry：声明注册、组合、选择和持久化。
- @deepseek-ai/dsh-agent-preset：一条普通 Cordis preset 声明。

旧实现依赖的 preset.yml、registerRoot() 和复制 shipped preset root 的逻辑不能保留。应在 cordis.patch.yml 中声明：

~~~yaml
- insert:
    - id: preset-embedded-codex
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: embedded-codex
        name: Embedded Codex
        description: Codex App Server runtime
        order: <chosen-order>
        plugins: []
~~~

embedded-codex Runtime 仍作为 profile 级插件存在；空 plugins 只表示该 preset 没有额外的上下文插件，不表示没有 Agent Runtime。

需要执行：

- 删除 presets/embedded-codex/preset.yml 和 lib/presets 发布逻辑。
- 将 compat/generated/packages/preset/agent-presets 改为 agent-preset-registry。
- 将 compat/agent-presets export/provider/type shim 重命名为 compat/agent-preset-registry。
- peerDependencies/devDependencies 用新 registry 和 declaration 包替换旧包。
- 更新所有 tsconfig project references、测试 fixture、README 和 compatibility 文档。

### 4.2 Agent Registry：仍需支持按 preset 选择工厂

目标 DSH 的 AgentRegistry 仍只有一个全局 setFactory()。embedded-codex 需要保留当前扩展的核心语义：

- setPresetFactory(agentPreset, factory, defaultAgentOptions)
- ResumeAgentOptions.agentPreset
- create/resume 时按 preset 选择默认 Agent Loop 或 Codex factory
- 记录 live Agent 到 factory 的关联
- 判断 model provider 是否属于当前 Agent Runtime
- 判断 blank session 切换 preset 时是否需要替换 Agent Runtime

目标 core/agent 已演进，旧补丁不能直接应用。必须以目标 index.ts 为底重新实现，不能把旧文件覆盖过去。

关键不变量：

- 没有命名工厂的 preset 继续使用 DSH 默认 Agent Loop。
- embedded-codex provider 不得被标准 Agent 选择；标准 provider 也不得被 Codex Agent 选择。
- create、resume、fork 和 runtime switch 使用同一套 factory 选择规则。
- factory disposer 后不得留下可被新 Agent 选中的陈旧注册。

### 4.3 Preset Registry：重做 blank-session runtime switch

目标 registry 的 select() 只会 recompose 当前 Agent 的 plugin scope，不会替换 Agent factory。因此需要在新的 agent-preset-registry 上移植较小的扩展：

- 增加 effect-scoped runtime switcher 注册。
- select() 先验证 Session 真正为空：Agent idle、无 queued/steering 输入、没有已开始 turn。
- 解析并验证目标 preset 后，检查是否跨 factory。
- 同一 factory：走目标 DSH 原生 recompose，再提交 agent-preset/selected。
- 跨 factory：交给 Session Controller 事务性替换，成功后才提交选择。

不要迁移旧的 registerRoot() 和 contributedRoots；声明式 preset 已经取代它们。

### 4.4 Session Controller：手工 rebase，而非覆盖目标源码

目标 Session Controller 新增或强化了以下能力：

- SessionObservation 驱动的冷读取与 resume。
- archived-session gate。
- assistant stream 与 media references。
- 更完整的 session list、projection store、subagent lineage 和 reconnect 逻辑。

当前 agent.ts、commands.ts 和 client manager.ts 补丁都发生冲突。重做时必须保留目标版本全部新逻辑，只叠加：

- composeAgent() 同时返回 preset id、factory-owned AgentOptions 和 setup。
- create/resume/fork 把 agentPreset 传给 AgentRegistry。
- 保存 AgentHandle，供 runtime switch 正确 dispose。
- model select、prompt admission 和 fork 都检查 provider/factory 一致性。
- Codex model 选择不写入标准 DSH 的默认模型设置。
- runtime switch 与 prompt/model 操作共用串行链，避免同时替换和发起 turn。
- 旧 Agent dispose 后，以同一 Session id 和目标 factory resume。
- 目标 resume 失败时尝试恢复原 factory；双重失败应返回 AggregateError，而不是留下半发布状态。

tsconfig.compat-session-host.json 目前是显式 files 清单。目标版本至少新增：

- archived-session-gate.ts
- assistant-stream.ts
- media-references.ts

建议改为受控 include/exclude，或同步完整 Host 文件列表，避免以后静默漏编译。

### 4.5 Client Session 身份必须跨 runtime switch 存活

runtime switch 会在同一 Session id 上产生 api-session/removed → api-session/added。目标 client 仍会在 removed 时标记 resident Session，并可能删除 projection store。

需要：

- 在 Session 上保留 handleAdded()，重新清除 removed 状态。
- handleSessionAdded() 对已有 resident instance 调用 handleAdded()。
- transient removal 时，只要 resident Session 仍存在，就保留它已暴露的 projection store。
- 保留目标版本新的 subagent catalog、projection hints、inflight load 和 reconnect 行为。

旧 session.ts 补丁可干净应用；manager.ts 必须按目标结构手工 rebase。

### 4.6 Permission：保留 DSH 新能力，同时维持 Codex 三种语义

目标 DSH Permission Service 新增：

- 动态 process catalog()。
- registerAuto() 与 catalog-changed。
- Session projection 只发送 currentValue。
- settings 默认项与当前 Session 可选项分开。

重做 replacement 时必须完整保留这些能力。Codex 权限映射保持：

| embedded-codex 模式 | Codex approvalPolicy | approvalsReviewer | sandbox |
|---|---|---|---|
| ask-for-approval | on-request | user | workspace-write，networkAccess=false |
| approve-for-me | on-request | auto_review | workspace-write，networkAccess=false |
| danger-full-access | never | user | dangerFullAccess |

DSH 的 auto 不能替代 Codex 的 approve-for-me：目标 DSH auto 使用 danger-full-access + ask，并由 DSH 自己的 reviewer 集成管理；Codex approve-for-me 保持 workspace-write，且由 Codex App Server 的 auto_review 执行。

还需要：

- permission projection 折叠 agent-preset/selected 或从 header 初始化 preset。
- fresh embedded-codex Session 默认 ask-for-approval。
- 保留既有 durable key，避免旧 Session 迁移。
- turn 运行中拒绝权限切换。
- DSH 标准 Agent 仍看到标准权限表，embedded-codex 只看到三种 Codex 模式。

### 4.7 Permission UI：缩小 replacement，而不是全部删除

目标 UI 已能动态读取 catalog，并能用 Host 提供的 name/description 渲染未知 preset，因此旧的中英文字符串替换和 Conversation UI fork 可以删除。

但 catalog 是 process 级的，而当前 Session projection 只含 currentValue。若把标准与 Codex 选项全部放进全局 catalog：

- 标准 Agent 会看到没有真实 auto_review 语义的 approve-for-me。
- embedded-codex 会看到不属于它的标准选项。
- Host 虽可在提交时拒绝，但 UI 会展示无效选项。

推荐保留一个更小的 ui-permission-presets replacement：

- Permission projection 为当前 Session 提供 provider-aware options；或为 catalog API 增加 session-aware 查询。
- 当前 Session picker 使用 session-aware 选项。
- General Settings 仍只使用标准 defaultOptions，不能把 Codex 专用模式设为所有新 Session 的全局默认。
- ui-conversation 保持目标 DSH 原版，它只负责渲染 permission slot。
- Host 返回展示名与描述，UI 不再硬编码 Codex 文案。

如果产品愿意暂时移除 approve-for-me，并把 Codex 映射到 DSH 标准 workspace-write / danger-full-access，才可以完全删除 Permission UI replacement；这会造成功能回退，不作为推荐方案。

## 5. Cordis composition 的目标形态

最终采用 6 个 replacement：在原计划的 5 个业务/UI replacement 上补充 Config Editor compatibility shim。原因是 Registry 必须沿用官方 id，而目标 Config Editor 读取重复 id 时使用 first-write-wins，与 Loader 的 last-write-wins 不一致，会把合法的 profile 写回误报为高层 overlay。

| 目标原 row | 动作 | replacement |
|---|---|---|
| agent | 禁用，保留 package-name guard | embedded-codex-agent-registry |
| agent-preset-registry | 禁用，保留 package-name guard | agent-preset-registry（同 id 后写覆盖，匹配设置 UI 命名空间） |
| config-editor | 禁用，保留 package-name guard | embedded-codex-config-editor |
| permission | 禁用，保留 package-name guard | embedded-codex-permission-presets |
| session-controller | 禁用，保留 package-name guard | embedded-codex-session-controller |
| ui-permission | 禁用，保留 package-name guard | embedded-codex-ui-permission-presets |
| ui-conversation | 不再禁用 | 使用 DSH 原实现 |

另外插入：

- preset-embedded-codex：@deepseek-ai/dsh-agent-preset 声明。
- embedded-codex：本包 Runtime。

build-time 和 runtime 的 profile composition assertion 都应核对：

- 6 个原 provider 确实被正确 package name guard 禁用。
- 6 个 replacement 均存在且最终各只有一个生效条目；registry 的 guard 行与 replacement 行共用 id，Loader 以后者为准。
- Config Editor 可以把 `selectedDefault` 写入 profile，且不会把同 id Registry 误判为 home/命令行覆盖。
- ui-conversation 未被本包替换。
- preset-embedded-codex 和 Runtime 均存在。
- 默认 Agent Loop 保持启用。

## 6. Codex CLI 0.159.2 集成

### 6.1 版本策略

2026-09-30 查询 npm registry：

- latest：0.159.2
- alpha：0.161.0-alpha.3

本次在 package.json 中写精确版本：

~~~json
"@openai/codex": "0.159.2"
~~~

不要把 @latest 写入可发布包，也不要使用 PATH 中的 codex 作为嵌入运行时。OpenAI 官方给终端用户的更新命令是 npm install -g @openai/codex@latest，随后运行 codex --version；本项目的可复现构建仍应固定精确版本。参见 [OpenAI Codex 更新说明](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex)。

DSH dsh-v0.2.0-rc.2 自身在 subagent-codex 中固定了 @openai/codex 0.153.4。它和本插件是两个独立 consumer：

- 不要在 workspace overrides 中强制所有 consumer 使用 0.159.2。
- 允许 lockfile 同时存在 0.153.4 和 0.159.2。
- minimumReleaseAgeExclude 若启用，应在同一 @openai/codex version-union 条目中列出两组精确版本及平台 alias。
- 删除已不存在的 win32-ia32 alias。

### 6.2 协议再生成与审阅

执行顺序：

1. 更新 package.json 和 pnpm-lock.yaml。
2. 使用 package-local wrapper 运行 scripts/maintenance/update-protocol.mts。
3. 更新 protocol/UPSTREAM.json 到 0.159.2。
4. 审阅生成 diff，再做 TypeScript 与真实 App Server smoke。

本次预生成比较发现：

- 生成类型净增加 71 个文件。
- thread/rollback 参数/响应被移除，新的 client surface 使用 thread/revert；本插件未调用它们。
- 当前用到的 thread/start、thread/resume、thread/fork 响应新增字段，但既有字段仍在。
- UserInput.image 新增 fileId 分支；现有 url 输入仍合法。
- TurnStartParams 有新增可选能力字段；现有调用字段仍保留。
- 当前使用的 AskForApproval、ApprovalsReviewer、SandboxMode、SandboxPolicy 与 model/list 核心形状未出现语义破坏。
- App Server 发给客户端的 request 方法集合未增加，因此现有审批、tool request handler 不因新必答方法而缺口。
- 新增了一批 notification，例如 gateway OAuth、thread attachment、realtime item；当前路由会忽略未消费 notification，但应加入“未知通知不崩溃”测试。

因此 0.149.1 → 0.159.2 的代码风险低于 DSH rebase，但不能只凭类型判断通过。

### 6.3 App Server 启动与 Desktop

继续解析 @openai/codex/package.json 中的 bin，并以固定包内 wrapper 启动 app-server。Desktop 下重点验证：

- process.execPath 是 Electron 可执行文件时，子进程显式或可靠继承 ELECTRON_RUN_AS_NODE=1。
- profile 中安装了与平台/架构匹配的 Codex optional native package。
- Windows/macOS 上 package-local wrapper 能定位并执行原生 Codex binary。
- 路径包含空格、中文和长路径时仍可启动。
- App quit/update 时完整终止 App Server 进程树。
- App Server 异常退出后下一次操作能启动新 generation，并 resume 原 thread。

initialize.clientInfo.version 当前硬编码为 0.1.2，应改成 embedded-codex 自身的真实 package version，而不是 DSH 版本。OpenAI 的 App Server 文档要求 name 稳定，并用 title/version 标识调用应用；参见 [Codex app-server 文档](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)。

### 6.4 登录方案要明确分层

开发/MVP 方案：

- 用户在同一 OS 账户下用全局 Codex CLI 执行 codex login。
- embedded runtime 仍启动 package-local 0.159.2，并读取同一 Codex 凭据目录。
- 全局 CLI 只负责登录/诊断，不能成为运行依赖。

产品化 Desktop 方案：

- 使用应用自己的 Sign in with ChatGPT OAuth token。
- 按 OpenAI 官方 app-server 方式把短期 access token 传给子进程，并配置 Responses provider。
- token 刷新后重启 App Server，再用持久化 thread id 执行 thread/resume。
- token 不能写进 profile patch、日志或崩溃报告。

本次可以先交付 MVP，但在正式面向终端用户前应选择并实现产品化认证，否则“请先在终端 codex login”会成为明显的 Desktop UX 缺口。

## 7. Workspace、构建与发布清单

### 7.1 Workspace

- 更新 upstream/deepseek-harness submodule 到目标 commit。
- pnpm-workspace.yaml：
  - native/landlock-run → native/system。
  - packages 路径同步目标 workspace。
  - 去掉或更新把 pi-ai 强制到 0.84.2 的 override；目标为 0.87.1 且带 DSH patch。
  - 合并目标 DSH 必需的 patchedDependencies 与 allowBuilds。
  - 合并 Codex 0.153.4 + 0.159.2 的 minimumReleaseAgeExclude。
- 重新生成外层 pnpm-lock.yaml。
- 保留外层 workspace 为开发期链接 DSH package 所需的 link 策略，但要通过 frozen install 验证，不能机械照抄或机械删除。

### 7.2 package.json 与发布面

- @openai/codex 固定为 0.159.2。
- peer/dev dependency 替换为 agent-preset-registry 和 agent-preset。
- 删除旧 agent-presets export。
- 删除 ui-conversation replacement export。
- 保留 client export：patched Session Controller client 仍需要浏览器 bundle；Desktop 同样加载它。
- 若采用推荐权限方案，保留缩小后的 ui-permission replacement 和 client factory。
- dsh.client.platform 继续为 web。
- 清理 lib/presets、presets 和旧 UI bundle 产物；按新方案更新 files。
- 为新 DSH 基线发布新的 embedded-codex pre-release，不复用 0.1.0 制品。
- 增加 3.2 所列 Desktop script matrix；默认 dev 改为 dev:desktop，dev:web 仅承担回归。
- 插件 tgz 使用 pack:plugin，Desktop 客户端使用 package:desktop*，两者不得复用同一个模糊的输出路径或成功标记。

### 7.3 build.mts / tsdown / tsconfig

- COMPAT_SOURCE_ROOTS 指向 agent-preset-registry，并纳入 config-editor 的窄化兼容源。
- 删除 COMPAT_ASSET_ROOT 与 preset asset copy。
- 重新列出目标 DSH 构建前置产物。
- Session Host 编译纳入新增源码。
- Client bundle 由 patched Session Controller client + 必要的 Permission UI factory 组成，不再 prepend Conversation UI。
- 重写或删除 scripts/lib/permission-ui-overrides.mts；不要继续对 minified bundle 做旧字符串 anchor 替换。
- REQUIRED_PACKAGE_ARTIFACTS、verifyPackage()、expectedDisabled/expectedInserted 全部同步 6-provider 方案。
- 更新 compat type shims、typeRoots、project references 和 tsdown externals。

### 7.4 精确版本保护

src/compat/host-version.ts 应：

- EXPECTED_DSH_VERSION = 0.2.0-rc.2。
- 校验 agent、agent-preset-registry、config-editor、permission、session-controller，以及采用 replacement 时的 ui-permission。
- 不再校验被删除的 agent-presets。
- 不再校验未替换的 ui-conversation。

保持 fail-fast：安装到其他 DSH 版本时给出清晰错误，不以“可能兼容”为由继续启动。

### 7.5 scripts/desktop.mts 与制品编排

新增脚本应复用现有 scripts/lib/package.mts 的 content-addressed tgz 生成能力，但 profile 和进程编排需要单独做 Desktop 抽象：

- 将 scripts/lib/dev-profile.mts 中硬编码的 profiles/web 和 --profile web 参数化；Desktop 路径只允许 profiles/desktop。
- 为开发运行同时隔离 DSH_HOME 和 DSH_DESKTOP_USER_DATA_DIR，不能污染用户真实 Desktop profile、Session 或 Electron userData。
- 先 build/test/pack 插件，再调用目标 DSH 的 build:desktop、dev:desktop、start:desktop、prepare:desktop 或 package:desktop:*。
- package:desktop* 透传 --build-version 等上游参数；签名配置、unsigned 语义和目标平台限制由上游校验，外层脚本不能吞掉错误。
- dir 变体用于快速 runtime/插件 smoke；signed installer/archive 用于发布验收。unsigned Windows 制品只能用于测试，不能进入正式发布目录。
- 打包后检查 Desktop 制品、插件 tgz、integration-manifest.json 三者的版本和 hash 一致；builtin 模式还要检查应用 package inventory 中确实存在插件与当前平台的 Codex 可执行文件。
- 若插件安装、Electron 启动或 smoke 失败，整个 package:desktop 流程失败；不能只因 electron-builder 产出了文件就返回成功。
- PowerShell、macOS shell 和 CI 调用保持同一套 TypeScript 编排逻辑，不维护平台专属的重复业务流程。

## 8. 现有补丁 dry-run 结果

在目标 tag 的独立 worktree 上执行 git apply --check：

| 补丁 | 结果 | 处理 |
|---|---|---|
| api/session-controller/src/agent.ts | 冲突 | 按目标 SessionObservation/新 lifecycle 手工 rebase |
| api/session-controller/src/client/sessions/manager.ts | 冲突 | 保留目标 catalog/projection/reconnect 后重写 |
| api/session-controller/src/client/sessions/session.ts | 可应用 | 复核 handleAdded 语义后保留 |
| api/session-controller/src/client/transport.ts | 可应用 | 重新判断 copied client 是否仍需去掉 self-import |
| api/session-controller/src/commands.ts | 冲突 | 按目标 commands 重写 provider/factory 串行逻辑 |
| core/agent/src/index.ts | 冲突 | 手工移植 preset factory registry |
| boot/config-editor/src/index.ts | 新增 | 将重复 id 的读取改为与 Loader 一致的后写覆盖 |
| interaction/permission-presets/src/index.ts | 冲突 | 以目标 catalog/registerAuto 为底重写 |
| preset/agent-presets/src/index.ts | 目标已删除 | 改为 agent-preset-registry 新补丁 |

任何“让旧 patch 勉强 apply”的做法都不足以验收；目标 DSH 新增行为必须保留。

## 9. 兼容性与迁移测试

### 9.1 自动化门禁

- pnpm install --frozen-lockfile。
- 目标 DSH 自身 build。
- embedded-codex TypeScript build。
- unit/integration test。
- package verification 与 pack 后内容检查。
- Desktop script contract 测试：dev 默认指向 Electron；package:desktop* 不调用 dsh web、不读写 profiles/web，并完整透传 target、--dir、--unsigned 和 --build-version。
- Desktop delivery audit：客户端制品、插件 tgz、integration-manifest.json 的版本、target、hash 与签名状态一致。
- bundle loader smoke，PATH 置空，证明使用 package-local Codex。
- protocol 生成结果与 package version 一致。
- 所有 compatibility source 不含本机绝对路径。

现有测试需要同步：

- profile-composition.spec.ts：新 row id/package 和 6-provider 集合。
- config-editor-replacement.spec.ts：同 id Registry 的 `selectedDefault` 可写入并即时生效。
- compatibility.spec.ts：0.2.0-rc.2 及新 package 集合。
- runtime.spec.ts：声明式 preset registry mock，不再 mock registerRoot。
- permission tests：标准/Codex/DSH auto 三套语义与隔离。
- client projection tests：remove → add、projection store 保留、reconnect。
- permission-ui tests：每个 Agent preset 只显示有效选项。
- scripts/test.mts：移除 preset.yml 安装断言与旧 UI factory 断言。

### 9.2 历史数据

至少准备由当前 0.1.2-rc.1 + Codex 0.149.1 真实产生的 fixture，验证升级后：

- session list 可见。
- embedded-codex preset id 保持不变。
- 三个 permission durable key 保持可读。
- persisted native thread id 能 resume。
- fork 在正确 native turn boundary 截断。
- native replayState 不丢失。
- 旧 Session resume 后能继续一轮并再次重启恢复。

### 9.3 Desktop 平台矩阵

目标 tag 的正式 package scripts 覆盖：

- Windows x64
- macOS x64
- macOS arm64

Linux Desktop 不在该 tag 的正式打包矩阵中；Linux 继续做 Web/Host 回归即可。

本仓库应至少在 CI 或发布机执行对应的 package:desktop:win:x64、package:desktop:mac:x64 和 package:desktop:mac:arm64；日常快速验证先跑各平台 :dir 变体，候选发布再跑签名 installer/archive。package:desktop 的默认 target 只用于本机开发便利，发布流水线必须使用显式平台脚本。

每个平台至少验证：

1. 首次启动并初始化 desktop profile。
2. app 完全退出时 add/list/remove 插件。
3. 再启动后 preset 可见。
4. 新建、resume、fork embedded-codex Session。
5. model catalog 与模型切换。
6. 文本、图片、steer、interrupt。
7. ask-for-approval 的 user 审批。
8. approve-for-me 的 auto_review，且不能扩大 workspace/network 边界。
9. danger-full-access 的明确风险确认和 never policy。
10. 正在运行时隐藏窗口，任务继续。
11. quit/update 时任务提示与 App Server 清理。
12. Desktop 更新后外置插件仍存在。
13. Codex binary 被杀后自动重建连接并 resume。
14. 登录过期、未登录、API-key-only 等拒绝路径。

## 10. 建议实施顺序

### Phase A：冻结基线

- 提交历史 Session fixtures。
- 记录当前 Web 行为和权限矩阵。
- 新建迁移分支并更新 submodule。

### Phase B：让工程在新 DSH 上可安装和编译

- workspace、lockfile、package references、native/system。
- preset declaration 模型。
- build/tsconfig/generated source 管线。

### Phase C：恢复 Runtime 正确性

- AgentRegistry。
- AgentPresetRegistry。
- Session Controller Host/client。
- Permission Host/client。
- create/resume/fork/switch 事务测试。

### Phase D：升级 Codex CLI

- 固定 0.159.2。
- 再生成 protocol。
- 处理 clientInfo version、Electron Node 环境和新增通知。
- 对真实 App Server 做 start/resume/fork/approval smoke。

### Phase E：Desktop 资格验证

- 实现 scripts/desktop.mts 和完整 package:desktop:* 矩阵，把默认 dev 切到 dev:desktop。
- 先用 pack:plugin + desktop profile 安装验证外置插件，再跑 package:desktop:*:dir 验证真实 Electron runtime。
- 生成客户端制品、配套 tgz 和 integration-manifest.json；若选择 builtin，再验证插件已进入 package inventory。
- Windows x64、macOS x64/arm64。
- auth、签名/执行、升级、退出与崩溃恢复。

### Phase F：发布

- 文档和 THIRD_PARTY_NOTICES。
- compatibility matrix。
- pack 内容审计。
- 发布 embedded-codex pre-release。
- 归档并交付 package:desktop:win:x64、package:desktop:mac:x64、package:desktop:mac:arm64 产物及其配套插件/manifest。
- 只在 Desktop 三平台全部通过后宣称 Desktop 支持。

## 11. 必须满足的验收条件

以下条件全部满足才算完成适配：

- 只支持并明确校验 DSH 0.2.0-rc.2。
- build/test/pack 在 clean checkout + frozen lock 下通过。
- Web 原有能力不回退。
- dev 默认启动 Electron Desktop；dev:web 仅在显式调用时启动 Web。
- package:desktop* 产出真实客户端制品，且不调用 dsh web、不操作 profiles/web。
- 每个 Desktop 制品都带有版本/hash 完全匹配的 embedded-codex tgz + integration-manifest.json，或在 builtin 模式下经 inventory 证明插件和 Codex 平台二进制已进入应用。
- Desktop 三个平台从外置插件安装到完成一轮 Codex 任务均通过。
- 标准 Agent 与 Codex Agent 的 model provider、permission options 不串台。
- blank session 可在标准/Codex runtime 间切换；开始 turn 后拒绝切换。
- runtime switch 失败不会丢 Session、projection 或原 Agent。
- 旧 Session 能 resume/fork。
- workspace-write 的网络和目录边界由 App Server 返回值及实际行为共同验证。
- 运行时使用 package-local @openai/codex 0.159.2，PATH 中其他版本不影响结果。
- Desktop quit/update 后没有遗留 Codex 进程。

## 12. 需要在实施前确认的产品决策

推荐默认值已经给出，但以下两点会改变实现范围：

1. 认证：第一版是否接受“用户先执行 codex login”，还是必须内置 Sign in with ChatGPT OAuth。
2. 分发：package:desktop 交付“客户端 + 配套外置插件”，还是必须把插件随 Desktop 安装包内置。

若没有额外要求，建议选择：

- 第一版：共享 OS 用户的 Codex 登录 + package-local runtime。
- 分发：Desktop 外置插件；但必须提供 package:desktop* 客户端制品矩阵，并把精确匹配的插件 tgz/manifest 一起交付。
- Codex：stable 0.159.2，不上 alpha。
- Permission：保留 ask-for-approval、approve-for-me、danger-full-access 三种模式和一个最小 Permission UI replacement。
