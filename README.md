---
description: "在 DeepSeek Harness 中使用官方 Codex App Server 的 Agent Runtime。"
kind: "package-bundle"
---

# dsh-embedded-codex

`dsh-embedded-codex` 是 DeepSeek Harness 的外部 Bundle。它增加 `Embedded Codex` Agent 预设，让 DSH Desktop（以及显式 Web 回归）使用官方 Codex App Server 和当前 OS 用户的 ChatGPT Codex 登录。

Codex 负责模型循环、原生工具、sandbox、审批、隐藏历史和 compaction；DSH 继续负责 Session、Web/API、对话轨迹、持久化和 token 展示。其他 DSH Agent 预设不会受到影响。

## 环境要求

- Node.js `^22.19.0` 或 `>=24.0.0`
- pnpm `11.7.0`
- Git，且克隆时初始化 submodule
- 拥有 Codex 权限并已登录的 ChatGPT 账户

本项目精确支持 DSH `dsh-v0.2.0-rc.2`，并固定使用 `@openai/codex@0.159.2`；运行时不会调用 `PATH` 中其他版本的 Codex CLI。

## 从克隆到启动 Desktop

```powershell
git clone --recurse-submodules <repository-url> D:\dsh-embedded-codex
Set-Location D:\dsh-embedded-codex
$env:CI = 'true'
pnpm install --frozen-lockfile
Remove-Item Env:CI
codex login
pnpm dev
```

安装命令把 `CI=true` 只用于这一次 pnpm 进程，使作为 submodule 引入的 DSH 跳过其仓库 Lefthook 安装器，不会覆盖用户已有的全局 `core.hooksPath`。`pnpm-workspace.yaml` 同时固定 pnpm virtual-store 布局，因此恢复普通本地环境后运行 `pnpm dev` 不会把 CI/本地模式切换误判成依赖变化。

`pnpm dev` 会完成以下工作：

1. 构建并测试固定版本的 DSH 和插件，再生成真实插件 tgz。
2. 初始化隔离的 `.tmp/desktop/dsh-home/profiles/desktop` 并安装 tgz。
3. 同时隔离 `DSH_HOME` 与 Electron `DSH_DESKTOP_USER_DATA_DIR`。
4. 启动 DSH Electron Desktop 开发客户端。

打开一个新 Session，选择 `Embedded Codex` 即可。Embedded Codex 不需要 `DEEPSEEK_API_KEY`；其他标准预设仍使用各自配置的模型凭据。`dev:web` 仅用于 Web 回归，不是默认客户端入口。

如果克隆时没有携带 submodule，先执行：

```powershell
git submodule update --init --recursive
```

## 常用命令

| 命令 | 用途 |
|---|---|
| `pnpm dev` / `pnpm dev:desktop` | 测试、打包、安装到隔离 Desktop Profile 并启动 Electron |
| `pnpm start:desktop` | 复用已有构建，重建隔离 Desktop disposable project 并启动 Electron |
| `pnpm build:desktop` | 构建插件和目标 DSH Desktop |
| `pnpm prepare:desktop` | 准备 Desktop package set，并输出插件 tgz 与 preparation manifest |
| `pnpm package:desktop:*` | 生成目标 Electron 制品和精确配对的插件 tgz/manifest |
| `pnpm pack:plugin` | 只生成独立、内容寻址的插件 tgz |
| `pnpm desktop:install-plugin` | 通过 Desktop 注册的 `dsh` 安装 tgz 到真实 `desktop` Profile |
| `pnpm desktop:remove-plugin` | 从真实 `desktop` Profile 移除插件 |
| `pnpm dev:web` | 显式启动隔离 Web 回归环境 |
| `pnpm build` | 先准备 DeepSeek Harness，再生成并构建本插件 |
| `pnpm test` | 执行 build、Vitest、lint、文档检查和 tarball 隔离安装测试 |
| `pnpm pack` | 生成可安装的 `.tgz`；pnpm 会通过 `prepack` 自动先执行 build |

调试单个测试不需要额外的 package script，例如：

```powershell
pnpm exec vitest run tests/runtime.spec.ts
```

### Desktop 外置插件与真实安装

日常开发使用 `pnpm dev`。脚本每次用真实 tgz 更新仓库专属的隔离 Desktop Profile，并启动 Electron；不会读写用户真实 Desktop Session 或 userData。插件运行时使用 tgz 内依赖解析出的 package-local Codex 0.159.2，`PATH` 里的全局 CLI 只负责登录和诊断。

安装到真实 Desktop 前，先启动 Desktop 一次完成 Profile 初始化，然后完全退出应用（Windows 还需退出托盘）：

```powershell
pnpm pack:plugin
pnpm desktop:install-plugin
```

`desktop:install-plugin` 使用 Desktop 注册到 `PATH` 的 `dsh --profile desktop` 管理插件；应用仍在运行或命令并非 Desktop carrier 时会安全失败。开发脚本内部的管理 carrier 只允许操作 `.tmp/desktop` 下的隔离 Profile。

每个正式 `package:desktop*` 结果位于 `dist/desktop/<target>/`，其中包含 Electron installer/archive/unpacked app、`plugins/dsh-embedded-codex-<version>.tgz` 和 `integration-manifest.json`。Manifest 固定 DSH tag/commit、Desktop build version、插件与 Codex 版本、target/arch、签名状态、tgz SHA-256，以及 packaged Desktop carrier 的安装、Host、frontend、remove 冒烟结果；缺少任一侧时命令失败。Windows `--unsigned` 测试产物单独写入 `dist/desktop/unsigned/win-x64/`，不会进入正式发布目录。

## 安装到现有 Desktop

先生成本地 tarball：

```powershell
pnpm pack:plugin
```

完全退出 Desktop 后，通过它注册的命令安装：

```powershell
dsh --version
dsh plugin --profile desktop add .\.tmp\packs\dsh-embedded-codex-0.2.0-rc.1-<hash>.tgz
dsh plugin --profile desktop list
```

移除插件：

```powershell
dsh plugin --profile desktop remove dsh-embedded-codex
```

包发布到 npm 后，也可以直接按包名安装：

```powershell
dsh plugin --profile desktop add dsh-embedded-codex@0.2.0-rc.1
```

## 构建说明

父仓库的 Git submodule gitlink 是唯一的 DSH commit 来源，不再额外维护 commit 或源码摘要文件。`pnpm build` 会检查本地 submodule 是否与 gitlink 一致，并使用 `.tmp/upstream-build.json` 缓存已经完成的 DSH 构建；首次构建、gitlink 变化、产物缺失或 submodule 有源码修改时会重新构建 DSH。

本插件包含 Agent、Agent Preset Registry、Config Editor、Permission、Session Controller 五个 Host replacement，以及一个最小 Permission UI replacement。Conversation UI 使用 DSH 原实现。运行时会对这六个 replacement 的 DSH package 做精确版本检查。Config Editor replacement 只把重复 entry id 的读取改为与 Loader 一致的后写覆盖，从而让 Agent Preset 默认值仍可写入 profile。

完整构建顺序：

```text
DeepSeek Harness dependencies and build
  -> materialize compatibility sources and apply patches
  -> TypeScript declarations
  -> runtime bundle and provider-aware Permission UI client
  -> package structure verification
```

### 兼容 patch 规则

`compat/patches` 只存放扁平的 `*.patch` 文件。每个 patch 只能修改一个 DSH 文件，文件名必须把该文件相对于 `upstream/deepseek-harness` 根目录的路径中的 `/` 替换为 `+`：

```text
<DSH 根目录相对路径，将 / 替换为 +>.patch
```

例如：

| DSH 文件 | patch 文件 |
|---|---|
| `packages/boot/config-editor/src/index.ts` | `compat/patches/packages+boot+config-editor+src+index.ts.patch` |
| `packages/core/agent/src/index.ts` | `compat/patches/packages+core+agent+src+index.ts.patch` |
| `packages/api/session-controller/src/client/transport.ts` | `compat/patches/packages+api+session-controller+src+client+transport.ts.patch` |
| `packages/interaction/permission-presets/src/index.ts` | `compat/patches/packages+interaction+permission-presets+src+index.ts.patch` |

`pnpm build` 会在应用前强制检查以下规则：

- `compat/patches` 中不能有子目录或其他类型的文件。
- 每个 patch 必须只有一个 `diff --git` 文件段。
- patch 的 `diff --git`、`---` 和 `+++` 路径必须完全等于文件名解码出的 DSH 路径。
- 目标必须位于构建脚本复制的 DSH provider 源码目录内。

普通插件开发只修改 `src`、`scripts` 和 `tests`。需要改变 DSH 兼容 provider 时，可在一次迁移中编辑 `compat/generated`，再运行 `node --import tsx/esm scripts/maintenance/update-compat-patches.mts` 生成逐文件 patch；生成后不要把 `compat/generated` 当作发布输入。修改完成后运行 `pnpm test`。

Permission UI 也使用可审查的 TypeScript/TSX 单文件 patch：当前 Session 有 provider-aware `options` 时优先使用它，否则回退到 DSH process catalog。General Settings 始终使用标准 `defaultOptions`。构建不再改写 minified bundle，也不再复制 Conversation UI。

## 权限模式

选择 `Codex 模式` 后，DSH 权限选择器会切换为 Codex 的三种稳定模式；切回其他 Agent 预设后恢复 DSH 原表。两个新增模式接入 DSH locale，中文显示“请批准 / 帮我批准”，英文显示“Ask for approval / Approve for me”；图标直接复用 DSH 原有的工作区修改盾牌和只读勾选盾牌。

| UI 模式 | App Server 设置 | 行为 |
|---|---|---|
| 请批准 / Ask for approval | `workspaceWrite + on-request + user` | 工作区内直接执行；联网或越界时请求用户批准 |
| 帮我批准 / Approve for me | `workspaceWrite + on-request + auto_review` | 沙盒边界不变，符合条件的越界请求交给自动审核 |
| 完全权限 / Full access | `dangerFullAccess + never` | 不使用 Codex 文件和网络沙盒，不弹出审批 |

权限选择记录在 Session 中。Runtime 会在每个新 `turn/start` 重发完整的审批策略、审批者和沙盒策略，因此切换最迟在下一轮生效，不需要重建 Session。活动 turn 中不能切换权限；`read-only` 等无法无损映射的旧状态显示为 `Custom`，在用户明确选择 Codex 模式前拒绝启动 turn。

## 配置

可以在更晚的 Profile patch 中覆盖 `embedded-codex` 条目：

```yaml
- id: embedded-codex
  config:
    requireChatgptLogin: true
```

| 字段 | 默认值 | 用途 |
|---|---|---|
| `providerName` | `codex` | DSH 模型选择器中的 provider id |
| `providerDisplayName` | `Codex` | Provider 显示名称 |
| `defaultModelAlias` | `default` | 使用 Codex 原生默认模型选择 |
| `requireChatgptLogin` | `true` | 拒绝未登录或 API Key 登录 |
| `env` | `{}` | 显式传给 App Server 的环境变量 |
| `processCwd` | 当前进程目录 | App Server 工作目录 |
| `approvalPolicy` | `on-request` | 已弃用；仅在没有 Permission Presets provider 的非标准组合中作为兼容 fallback |
| `sandbox` | `workspace-write` | 已弃用；仅在没有 Permission Presets provider 的非标准组合中作为兼容 fallback |
| `disposeGraceMs` | `3000` | 子进程关闭宽限时间 |
| `stderrMaxBytes` | `65536` | 保留的 stderr 诊断上限 |

## 常见问题

### Desktop 仍显示旧的预设或插件版本

完全退出 Desktop（包括 Windows 托盘）后重新执行 `pnpm desktop:install-plugin`，再启动应用。开发环境直接重新执行 `pnpm dev`。

真实安装使用内容哈希 tarball 文件名，避免 pnpm 因版本号没有变化而复用旧插件内容。日常 `pnpm dev` 使用稳定链接，不经过 tarball 缓存。

### 提示 submodule 未初始化或 commit 不一致

```powershell
git submodule update --init --recursive
```

构建不会自动切换或更新 submodule commit。

### 找不到 Codex 登录

```powershell
codex login
```

完成登录后重新创建一个 DSH Session。

## 维护文档

- [架构](docs/architecture.md)
- [兼容策略](docs/compatibility.md)
- [测试策略](docs/testing.md)
- [权限管理实现计划](docs/permission-management-plan.md)
- [升级 DSH 或 Codex](docs/upgrading.md)

许可证见 [LICENSE](LICENSE)，第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
