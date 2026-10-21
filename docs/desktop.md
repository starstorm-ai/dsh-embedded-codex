---
description: "Desktop 的开发与成品数据目录、缓存、外置插件安装、打包和排障。"
kind: "guide"
---

# Desktop 开发与交付

默认入口是 `pnpm dev`。插件作为外部 Bundle 安装到 Desktop Profile，DSH App 与插件分别构建、配对交付。环境安装与首次登录见 [README](../README.md)；兼容基线和维护规则见[兼容性](compatibility.md)。

## 开发启动

```powershell
pnpm dev
```

启动顺序为插件依赖准备、插件构建与 pack、隔离 Desktop 构建、tgz 安装、Electron 启动。已有产物按输入和完整性复用，各阶段输出耗时及 `reused`。`pnpm dev:verify` 先运行完整自动检查；`pnpm start:desktop` 使用已有构建，打包并检查隔离插件安装后启动，不自动编译修改后的源码。

上游启动器仍会准备 Node/Python 运行环境、执行 Office 检查并准备 disposable project。即使 Desktop build 已复用，这些启动步骤仍有耗时。运行中的 Host 不会因仓库 tgz 更新自动加载新插件；更新后完全退出 Desktop，包括 Windows 托盘，再执行 `pnpm dev`。

## 数据路径与环境变量

下表的 `<repo>` 是仓库根目录，由脚本位置推导，与调用命令时的工作目录无关；`~` 是当前 OS 用户主目录。

| 运行方式 | DSH home | Electron userData |
|---|---|---|
| `pnpm dev`、`dev:verify`、`start:desktop` | `<repo>/.tmp/desktop/dsh-home` | `<repo>/.tmp/desktop/electron-user-data` |
| `pnpm dev:web` | `<repo>/.tmp/dsh-home` | 无独立 Electron 目录，使用访问页面的浏览器数据 |
| Windows 成品 App | 默认 `%USERPROFILE%\.dsh` | 默认 `%APPDATA%\@deepseek-ai\dsh-desktop` |
| macOS 成品 App | 默认 `~/.dsh` | 默认 `~/Library/Application Support/@deepseek-ai/dsh-desktop` |
| 成品自动冒烟 | `<repo>/.tmp/desktop/delivery-smoke/<target>/dsh-home` | 同级 `electron-user-data`，供隔离验证使用 |

DSH home 保存 Session、设置、凭据、工作区及存储。Desktop 的插件、锁文件和依赖位于 `$DSH_HOME/profiles/desktop`；CLI 与 Desktop 可共享 DSH 产品数据，但各自拥有不同的可执行 Profile。Electron userData 保存浏览器存储、Cookie、缓存、快捷键和桌面偏好。

开发路径在 [`scripts/desktop.mts`](../scripts/desktop.mts) 中固定为相对仓库的常量：

| 变量 | 本仓库开发入口 | 成品 App |
|---|---|---|
| `DSH_HOME` | 启动器在继承环境之后强制覆盖为开发目录 | 启动时读取；未设置或为空白时使用 `~/.dsh` |
| `DSH_DESKTOP_USER_DATA_DIR` | 强制覆盖为开发目录，上游开发启动器将其转换为 `--user-data-dir` | 主进程不读取这个开发专用变量，使用 Electron 的路径规则 |
| `DSH_DESKTOP_COMMAND` | 用于 `desktop:install-plugin` / `desktop:remove-plugin`，默认命令为 `dsh` | 用来选择管理目标 Desktop 的已注册命令，不定义数据根目录 |

因此，在运行 `pnpm dev` 前设置上述两个数据目录变量，不能覆盖本仓库的隔离目录。开发 Profile 初始化还会检查目录必须位于 `.tmp/desktop` 内。成品使用上游 [`resolveDshHome()`](../upstream/deepseek-harness/packages/util/home-paths/src/index.ts)；Electron 的应用名来自包内 manifest，当前为 `@deepseek-ai/dsh-desktop`。

当前成品沿用 DSH 的应用身份和默认数据目录，与正常安装的 DSH 共用这些路径。开发目录不会被写进 App 的默认配置，开发会话、插件安装状态和 userData 也不会自动迁移到成品。

DSH 数据隔离不等于 Codex 登录隔离。默认使用当前 OS 用户已有的 ChatGPT Codex 登录；全局 `codex login` 负责认证，实际 App Server 从插件依赖的固定 `@openai/codex` 包启动。

## 构建目录与缓存

| 路径 | 内容与归属 |
|---|---|
| `upstream/deepseek-harness` | 固定 DSH 参考源码；受版本控制的文件保持干净，可生成忽略的类型和包产物 |
| `compat/generated`、`src/compat/generated-manifest.ts` | 本仓库生成的兼容输入，不提交 |
| `lib` | 插件 JS、类型和客户端构建输出 |
| `.tmp/desktop-source` | 可重建的 Desktop 私有 checkout、固定锁文件依赖和上游构建输出 |
| `.tmp/desktop-settings` | 本地 `.env.windows` / `.env.macos` 打包配置；不属于可随意清空的缓存 |
| `.tmp/packs` | 按内容哈希命名的插件 tgz |
| `.tmp/desktop/dsh-home`、`.tmp/desktop/electron-user-data` | 持续使用的开发数据，不是构建缓存 |
| `.tmp/dsh-home` | Web 回归数据，不是 Desktop 数据 |
| `dist/desktop` | 配对后的客户端制品、插件 tgz 与交付 manifest |

三种构建职责各自有缓存：

| 范围 | 入口与 stamp | 何时重建 |
|---|---|---|
| 插件 DSH 依赖闭包 | `pnpm build`；`.tmp/plugin-prerequisites.json` | 基线、相关依赖/构建输入变化或输出缺失 |
| CLI/Loader 集成依赖 | `pnpm test`；`.tmp/integration-prerequisites.json` | 集成输入变化或输出缺失 |
| Desktop 私有源码与依赖 | `.tmp/desktop-source.json` | DSH 基线或源码准备补丁变化 |
| Desktop build | `.tmp/desktop-build.json` | 基线、构建适配、Node/平台/架构、`DSH_CLIENT_*`、`DSH_BUILD_CLIENT_PROFILE`、`NODE_ENV` 变化或输出缺失 |

插件内容或 provider patch 变化会重建相应插件产物，不会使 Desktop 全量重建。普通源码修改保留 TypeScript 增量状态；文件增删、配置变化或输出缺失会清理插件输出，避免残留。`pnpm build --clean` 显式全量重建兼容源码和插件，仍复用有效的 DSH 前置构建。

成功 stamp 原子写入并验证输出；失败、中断和缺失产物不能命中缓存。构建、pack、安装各自持锁，等待者取得锁后重新检查。tgz 校验内容摘要；安装缓存检查 Profile 注册、锁文件和实际安装文件，版本号相同也能识别内容更新。

Desktop 私有依赖以 copy 方式安装，构建适配只修改私有副本。转换清单见 [`compat/desktop-build.json`](../compat/desktop-build.json)。`.tmp` 同时包含缓存、本地配置和开发会话，排障时应针对具体构建层处理，避免把整个目录当成可丢弃输出。

## 安装到真实 Desktop

先启动目标 Desktop 一次完成 Profile 初始化，在应用中注册它的 `dsh` 命令，再完全退出应用。确认 `dsh --version` 对应[支持的版本](compatibility.md)，然后从本仓库执行：

```powershell
pnpm desktop:install-plugin
```

脚本构建插件、生成 tgz，再通过 Desktop 注册的命令执行 `plugin --profile desktop add/list`。`DSH_DESKTOP_COMMAND` 可指定目标命令路径。npm 安装的普通 DSH CLI 无权管理 Desktop 的保留 Profile。

使用交付目录中的现成插件时，在仓库根目录执行以下示例，路径和插件版本替换为实际制品：

```powershell
dsh plugin --profile desktop add .\dist\desktop\win-x64\plugins\dsh-embedded-codex-0.2.0-rc.1.tgz
dsh plugin --profile desktop list --depth=0
```

重新启动 Desktop 后选择 `Embedded Codex`。移除使用 `pnpm desktop:remove-plugin`，或直接执行 `dsh plugin --profile desktop remove dsh-embedded-codex`。移除会恢复 stock provider 的组合；已有 Codex Session 仍需要插件和原生 thread 才能继续，不会转换成标准 DSH 对话。

## 打包与交付

当前分发模式是 `external`：每份交付包含 DSH 客户端制品、配套插件 tgz 和 `integration-manifest.json`。客户端安装器没有内置该插件；用户需按上一节安装配套 tgz。`prepare:desktop` 只准备构建输入和 preparation manifest，不能代替成品打包成功。

打包前执行 `pnpm build:desktop` 以准备私有源码副本，再从该副本的 `apps/desktop/.env.windows.example` 或 `.env.macos.example` 复制配置模板到：

- Windows：`.tmp/desktop-settings/.env.windows`
- macOS：`.tmp/desktop-settings/.env.macos`

填写目标环境的 policy、更新和签名配置，证书文件使用绝对路径。脚本持有 Desktop 锁时将配置复制到私有副本，副本重建不会丢失源配置。签名与配置校验沿用上游，`--unsigned` 仍需要 policy 配置。测试用 `.invalid` 更新地址和归档的 `verification.env.windows` 不应作为正式发布配置。

在对应平台运行命令，优先使用 `:dir` 检查未封装安装器的应用：

| 目标 | 目录制品 | 安装器/归档 |
|---|---|---|
| Windows x64 | `pnpm package:desktop:win:x64:dir` | `pnpm package:desktop:win:x64` |
| macOS x64 | `pnpm package:desktop:mac:x64:dir` | `pnpm package:desktop:mac:x64` |
| macOS arm64 | `pnpm package:desktop:mac:arm64:dir` | `pnpm package:desktop:mac:arm64` |

Windows 本地无签名目录验证：

```powershell
pnpm package:desktop:win:x64:dir -- --unsigned
```

每次 package 会先完成插件自动检查，执行上游打包，再用该成品自身的 Desktop command 安装插件、启动 Host、加载 frontend，并经 `session/create` / `agentPresets/select` 检查 Codex 与 standard/minimal 往返切换及 Session ID 保持，最后停止 Host、移除插件。冒烟使用隔离 Profile，不发送模型输入，失败则不交付。

输出位置：

- 正式目标：`dist/desktop/<target>/`
- Windows unsigned：`dist/desktop/unsigned/win-x64/`
- Windows 旧制品被占用时，脚本可能改用带 `-ready`、`-ready-2` 等后缀的交付目录；以最后输出路径为准。

`integration-manifest.json` 记录精确 DSH commit/version、Desktop build version、插件/Codex 版本、平台架构、签名状态、插件 SHA-256 和冒烟结果，包含 `presetSwitchingReady: true`。配对交付时保持 App、tgz 和 manifest 一致；当前平台验证范围见[兼容性](compatibility.md)，完整发布门禁见[测试](testing.md)。

## 排障

### 依赖安装拒绝替换 core.hooksPath

`refusing to replace user-owned core.hooksPath` 来自上游 DSH 的 Lefthook 安装器。DSH 的 `lefthook.yml` 服务于上游仓库提交检查，例如 staged lint、翻译配对和 pre-push typecheck；它不参与插件运行。本仓库使用 `pnpm test` 验证自身代码。

查询生效配置的来源：

```powershell
git config --show-origin --show-scope --get-all core.hooksPath
```

保留原 hooks 配置，按 [README](../README.md) 临时 `CI=true` 的方式执行 `pnpm install --frozen-lockfile --prefer-offline`，完成后恢复环境。Desktop 私有依赖安装已自动使用 `CI=true`。

### 启动很慢或修改没有生效

先看具体阶段耗时和 `reused`。首次私有 checkout、依赖安装及完整 Desktop build 较慢；只改插件时不应重复这些构建。即使命中 build 缓存，上游运行环境准备仍会执行。不要仅凭总时长判断缓存失效。

完全退出旧 Desktop 后重新运行 `pnpm dev`，确保 Host 加载本轮 tgz。真实安装则退出后重新执行 `desktop:install-plugin`。内容寻址 tgz 和安装完整性检查会处理同版本内容变化，通常不需要手工删除 Profile。

### 切回普通 preset 报 without inject

已修复的 `cannot get property "agentPresets" without inject` 源于从外层 Context 读取嵌套注入的服务。当前 patch 从正确作用域取得服务并传入切换方法，回归测试覆盖真实 Cordis 作用域和 packaged Host Remote 接口。出现旧错误时先确认旧进程已退出、插件重新构建安装；维护要求见[架构](architecture.md)。

### 端口被占用或出现空白控制台

检查旧开发终端和托盘中的 Desktop，正常退出占用该端口的实例，再启动。需要定位时按错误中的实际端口查询监听 PID，并核对进程及其命令行；不要按 `node.exe` 名称批量结束进程。

Windows App Server 已直接启动插件依赖内的原生 `codex.exe`，由 DSH managed subprocess 管理窗口及进程树，避免官方 JS wrapper 再次 spawn 时弹出空白控制台。重启后仍出现时应核对实际加载的插件和子进程路径。

### 如何判断启动与退出成功

验证 Host ready、外部插件加载、客户端加载页消失及正常 quit 后启动器退出。固定上游开发版曾出现 `mandatory-status` IPC 注册时序诊断，以及退出时未完成的页面请求失败；单独这些日志不能证明插件加载失败，也不能代替上述就绪检查。真实模型任务是否成功仍须单独验证。
