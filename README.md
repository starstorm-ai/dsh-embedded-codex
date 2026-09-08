---
description: "Install and develop the preset-selected Codex App Server runtime for DeepSeek Harness."
kind: "package-bundle"
---

# dsh-embedded-codex

English | [中文](README.zh.md)

`dsh-embedded-codex` is an external DeepSeek Harness Bundle that lets one Agent preset use the official Codex App Server and a ChatGPT Codex subscription. It does not turn Codex into a fake LLM adapter: Codex owns its native thread, model loop, tools, sandbox, approvals, hidden history, and compaction, while DSH continues to own the Session, Web/API surface, Chat, Trajectory, persistence, and token views.

The Bundle is isolated from DSH source. It disables three version-locked provider rows and inserts compatible replacements for `ctx.agents`, `ctx.agentPresets`, and the Web Session Controller. The ordinary `agent-loop`, DeepSeek adapters, tools, and standard presets remain enabled. Only the `embedded-codex` preset selects the Codex runtime.

## Requirements

- Node.js `^22.19.0` or `>=24.0.0`.
- pnpm `11.7.0` for repository development.
- DeepSeek Harness `0.1.2-rc.1`; other Host versions fail during provider startup.
- A ChatGPT account with Codex access, authenticated through the official Codex CLI.

The runtime pins `@openai/codex` to `0.149.1` and always starts that package's local executable. It does not use an unrelated `codex` binary from `PATH`.

## Local development

```powershell
git clone --recurse-submodules <repository-url> D:\dsh-embedded-codex
Set-Location D:\dsh-embedded-codex
pnpm install --frozen-lockfile
pnpm run bootstrap
pnpm exec codex login
pnpm run check
```

`bootstrap` verifies the pinned submodule, builds missing DSH development artifacts, and materializes compatibility sources outside the submodule. Normal commands never update the submodule commit.

Install the built tarball into the repository-owned DSH home and start Web:

```powershell
pnpm run dev:install
pnpm run dev:web
```

Open a blank Session and select `Codex 模式`. Selecting `标准模式`, `PTC 模式`, or another standard preset keeps the normal DSH runtime. Remove the development Bundle with `pnpm run dev:remove`.

## Published installation

After the package is published, install it through the supported DSH Profile entrypoint:

```powershell
pnpm run build
pnpm pack

dsh plugin --profile web add dsh-embedded-codex
dsh web
```

The Codex preset does not require `DEEPSEEK_API_KEY`. Standard DSH presets still use their configured LLM providers and credentials.

## Runtime paths

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

`ctx.llm` exposes `codex/default` and the account-visible App Server model catalog so existing model pickers work. Calling `ctx.llm.stream()` for `codex` returns `CODEX_RUNTIME_ONLY`; main conversation work reaches Codex only through the selected Agent runtime.

App Server activity maps to existing DSH events:

| Codex activity | DSH representation |
|---|---|
| Input | `user/message` |
| Reasoning or plan text | reasoning blocks in `assistant/chunk` and `assistant/message` |
| Native tool | `codex.*` tool-call block plus `tool/call` and `tool/result` observations |
| Final answer | text block in the final `assistant/message` step |
| Token update | usage chunk and final `assistant/message.usage` |
| Completion | `step/end` and `turn/end` |

Native tools are never dispatched through `ctx.tools`, so DSH does not execute them twice. Command and file approvals use `ctx.approval`; Codex request-user-input uses `ctx.userQuestions`; MCP elicitation is declined because this DSH release has no equivalent structured response service.

## Configuration

Override the `embedded-codex` row in a later Profile patch:

```yaml
- id: embedded-codex
  config:
    requireChatgptLogin: true
    approvalPolicy: on-request
    sandbox: workspace-write
```

| Field | Default | Purpose |
|---|---|---|
| `providerName` | `codex` | Provider id exposed to DSH model selection |
| `providerDisplayName` | `Codex` | Provider label |
| `defaultModelAlias` | `default` | Keep native Codex default model selection |
| `requireChatgptLogin` | `true` | Reject missing or API-key-backed login |
| `env` | `{}` | Explicit environment passed to App Server |
| `processCwd` | process cwd | Shared App Server working directory |
| `approvalPolicy` | `on-request` | Native approval policy |
| `sandbox` | `workspace-write` | `read-only`, `workspace-write`, or `danger-full-access` |
| `disposeGraceMs` | `3000` | Child process-tree shutdown grace |
| `stderrMaxBytes` | `65536` | Retained diagnostic stderr limit |

## Verification

```powershell
pnpm run check
```

The check verifies the submodule commit and hashes, builds all published entries, runs fake App Server and DSH projection tests, lints source, checks documentation, inspects the package, then installs and removes the real tarball from an isolated Web Profile. `pnpm run test:real` is intentionally opt-in and requires `DSH_EMBEDDED_CODEX_REAL=1` because it opens Web against the developer's existing Codex login.

## Compatibility and upgrades

The package contains compiled adaptations of three DSH providers. Exact source and preset-asset hashes live in [`compat/upstream-lock.json`](compat/upstream-lock.json), and startup rejects another DSH package version. See [`docs/architecture.md`](docs/architecture.md), [`docs/compatibility.md`](docs/compatibility.md), [`docs/testing.md`](docs/testing.md), and [`docs/upgrading.md`](docs/upgrading.md).

Existing experimental Embedded Codex Sessions are not migrated. Start a new Session after installing this standalone Bundle; a visible DSH transcript cannot reconstruct Codex hidden state losslessly.
