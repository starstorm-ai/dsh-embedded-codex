---
description: "在 DeepSeek Harness 中使用官方 Codex App Server 的 Agent Runtime。"
kind: "package-bundle"
---

# dsh-embedded-codex

`dsh-embedded-codex` 是 DeepSeek Harness 的外部 Bundle。它增加 `Codex 模式` Agent 预设，让 DSH Web Session 使用官方 Codex App Server 和当前机器上的 ChatGPT Codex 登录。

Codex 负责模型循环、原生工具、sandbox、审批、隐藏历史和 compaction；DSH 继续负责 Session、Web/API、对话轨迹、持久化和 token 展示。其他 DSH Agent 预设不会受到影响。

## 环境要求

- Node.js `^22.19.0` 或 `>=24.0.0`
- pnpm `11.7.0`
- Git，且克隆时初始化 submodule
- 拥有 Codex 权限并已登录的 ChatGPT 账户

本项目固定使用 `@openai/codex@0.149.1`，不会调用 `PATH` 中其他版本的 Codex CLI。

## 从克隆到启动 Web

```powershell
git clone --recurse-submodules <repository-url> D:\dsh-embedded-codex
Set-Location D:\dsh-embedded-codex
pnpm install --frozen-lockfile
pnpm exec codex login
pnpm dev
```

`pnpm dev` 会完成以下工作：

1. 在需要时安装并构建 `upstream/deepseek-harness`。
2. 生成兼容源码并构建本插件。
3. 首次运行时把当前仓库稳定链接到隔离的 `.tmp/dsh-home`；后续构建复用该链接。
4. 启动 DSH Web。

打开一个新 Session，选择 `Codex 模式` 即可。Codex 模式不需要 `DEEPSEEK_API_KEY`；其他标准预设仍使用各自配置的模型凭据。

如果克隆时没有携带 submodule，先执行：

```powershell
git submodule update --init --recursive
```

## 常用命令

| 命令 | 用途 |
|---|---|
| `pnpm dev` | 构建、确保本地开发链接并启动隔离的 DSH Web；不会重复安装 Codex |
| `pnpm dev:install` | 构建、打包并执行一次真实 tarball 安装，但不启动 Web |
| `pnpm dev:web` | 启动已经安装好的隔离 Web，不重新构建 |
| `pnpm dev:remove` | 从隔离 Web Profile 移除开发插件 |
| `pnpm build` | 先准备 DeepSeek Harness，再生成并构建本插件 |
| `pnpm test` | 执行 build、Vitest、lint、文档检查和 tarball 隔离安装测试 |
| `pnpm pack` | 生成可安装的 `.tgz`；pnpm 会通过 `prepack` 自动先执行 build |

调试单个测试不需要额外的 package script，例如：

```powershell
pnpm exec vitest run tests/runtime.spec.ts
```

### 开发链接与真实安装

日常开发使用 `pnpm dev`。首次运行会通过稳定的 `link:` 依赖把本仓库注册进 DSH Web Profile；以后修改插件代码只会重新构建 `lib`，不会再次执行 `pnpm add`，也不会重新解析或下载 `@openai/codex`。插件运行时直接使用仓库根目录中由首次 `pnpm install --frozen-lockfile` 安装的固定 Codex 版本。

需要验证发布包时使用：

```powershell
pnpm dev:install
pnpm dev:web
```

`pnpm dev:install` 会生成真实 `.tgz`，只删除并重建 `.tmp/dsh-home/profiles/web/node_modules`，然后通过 DSH CLI 安装 tarball。Profile 配置、lockfile、用户 patch 和 Session 数据不会被删除。这样既验证真实发布边界，也规避 pnpm 在已有 hoisted `node_modules` 上重新安装时抓取其他平台 optionalDependencies 的问题。再次执行 `pnpm dev` 会把 Profile 切回本地链接模式。

切换模式或重新安装前必须先停止正在运行的 DSH Web。Windows 会阻止删除正在使用的 `node_modules`；脚本会重试短暂的文件占用，仍无法处理时会提示停止 Web，不会扩大删除范围。

## 安装到现有 DSH

先生成本地 tarball：

```powershell
pnpm pack
```

然后通过 DSH Web Profile 安装并启动：

```powershell
dsh plugin --profile web add .\dsh-embedded-codex-0.1.0.tgz
dsh web
```

移除插件：

```powershell
dsh plugin --profile web remove dsh-embedded-codex
```

包发布到 npm 后，也可以直接按包名安装：

```powershell
dsh plugin --profile web add dsh-embedded-codex
dsh web
```

## 构建说明

父仓库的 Git submodule gitlink 是唯一的 DSH commit 来源，不再额外维护 commit 或源码摘要文件。`pnpm build` 会检查本地 submodule 是否与 gitlink 一致，并使用 `.tmp/upstream-build.json` 缓存已经完成的 DSH 构建；首次构建、gitlink 变化、产物缺失或 submodule 有源码修改时会重新构建 DSH。

本插件包含三个 DSH provider 的兼容替代实现，因此运行时仍会检查 Host package 版本。这个检查用于防止发布后的插件被加载进不兼容的 DSH，不是重复的 submodule 版本锁。

完整构建顺序：

```text
DeepSeek Harness dependencies and build
  -> materialize compatibility sources and apply patches
  -> TypeScript declarations
  -> runtime and Web client bundles
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
| `packages/core/agent/src/index.ts` | `compat/patches/packages+core+agent+src+index.ts.patch` |
| `packages/api/session-controller/src/client/transport.ts` | `compat/patches/packages+api+session-controller+src+client+transport.ts.patch` |

`pnpm build` 会在应用前强制检查以下规则：

- `compat/patches` 中不能有子目录或其他类型的文件。
- 每个 patch 必须只有一个 `diff --git` 文件段。
- patch 的 `diff --git`、`---` 和 `+++` 路径必须完全等于文件名解码出的 DSH 路径。
- 目标必须位于构建脚本复制的 DSH provider 源码目录内。

普通插件开发只修改 `src`、`presets` 和 `tests`。需要改变 DSH 兼容 provider 时，应基于当前固定的 DSH commit 生成单文件 diff；一个改动涉及多个 DSH 文件时，必须拆成多个按上述规则命名的 patch。不要直接修改 `compat/generated` 或 `lib`：它们会在下一次构建时被删除并重新生成。修改完成后运行 `pnpm test`，确认所有 patch 仍能干净应用并通过完整打包安装测试。

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
| `providerName` | `codex` | DSH 模型选择器中的 provider id |
| `providerDisplayName` | `Codex` | Provider 显示名称 |
| `defaultModelAlias` | `default` | 使用 Codex 原生默认模型选择 |
| `requireChatgptLogin` | `true` | 拒绝未登录或 API Key 登录 |
| `env` | `{}` | 显式传给 App Server 的环境变量 |
| `processCwd` | 当前进程目录 | App Server 工作目录 |
| `approvalPolicy` | `on-request` | Codex 原生审批策略 |
| `sandbox` | `workspace-write` | `read-only`、`workspace-write` 或 `danger-full-access` |
| `disposeGraceMs` | `3000` | 子进程关闭宽限时间 |
| `stderrMaxBytes` | `65536` | 保留的 stderr 诊断上限 |

## 常见问题

### Web 仍显示旧的预设名称

执行 `pnpm dev:install` 后必须重启正在运行的 Web 进程：先按 `Ctrl+C`，再执行 `pnpm dev:web`。必要时在浏览器中按 `Ctrl+F5`。

真实安装使用内容哈希 tarball 文件名，避免 pnpm 因版本号没有变化而复用旧插件内容。日常 `pnpm dev` 使用稳定链接，不经过 tarball 缓存。

### 开发时开始下载所有平台的 Codex

先按 `Ctrl+C` 停止当前 DSH Web，再执行 `pnpm dev`。当前开发流程会把 Profile 切换为本地链接，后续插件修改不再执行 `pnpm add`。只有显式运行 `pnpm dev:install` 才会重建真实安装；重建前会移除可恢复的 Profile `node_modules`，因此 pnpm 只需安装当前平台的 Codex 包。

### 提示 submodule 未初始化或 commit 不一致

```powershell
git submodule update --init --recursive
```

构建不会自动切换或更新 submodule commit。

### 找不到 Codex 登录

```powershell
pnpm exec codex login
```

完成登录后重新创建一个 DSH Session。

## 维护文档

- [架构](docs/architecture.md)
- [兼容策略](docs/compatibility.md)
- [测试策略](docs/testing.md)
- [升级 DSH 或 Codex](docs/upgrading.md)

许可证见 [LICENSE](LICENSE)，第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
