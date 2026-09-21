/**
 * Codex permission-mode resolution shared by thread and turn operations.
 * @module dsh-embedded-codex/permissions
 */

import { isAbsolute } from 'node:path'
import type { ApprovalsReviewer } from '../protocol/v2/ApprovalsReviewer.ts'
import type { AskForApproval } from '../protocol/v2/AskForApproval.ts'
import type { SandboxMode } from '../protocol/v2/SandboxMode.ts'
import type { SandboxPolicy } from '../protocol/v2/SandboxPolicy.ts'

/** Stable permission modes exposed while the embedded Codex preset is active. */
export const CODEX_PERMISSION_MODES = [
  'ask-for-approval',
  'approve-for-me',
  'danger-full-access',
] as const

/** One stable Codex permission-mode identifier. */
export type CodexPermissionMode = typeof CODEX_PERMISSION_MODES[number]

/** Complete App Server settings derived from one Session permission selection. */
export interface ResolvedCodexPermission {
  /** Durable permission preset selected by the Session. */
  readonly mode: CodexPermissionMode | 'legacy-fallback'
  /** Native approval policy sent at thread and turn boundaries. */
  readonly approvalPolicy: Extract<AskForApproval, 'on-request' | 'never'>
  /** Native approval reviewer sent at thread and turn boundaries. */
  readonly approvalsReviewer: Extract<ApprovalsReviewer, 'user' | 'auto_review'>
  /** Legacy thread-level sandbox selector. */
  readonly threadSandbox: SandboxMode
  /** Explicit turn-level sandbox policy, including network access. */
  readonly sandboxPolicy: SandboxPolicy
}

/** Legacy static settings accepted only when no permission-presets provider is composed. */
export interface LegacyCodexPermission {
  readonly approvalPolicy: 'on-request' | 'never'
  readonly sandbox: SandboxMode
}

function assertAbsoluteCwd(cwd: string): void {
  if (!isAbsolute(cwd)) {
    throw new Error(`embedded-codex: permission resolution requires an absolute session cwd; received ${JSON.stringify(cwd)}`)
  }
}

function workspaceWrite(cwd: string): SandboxPolicy {
  return {
    type: 'workspaceWrite',
    writableRoots: [cwd],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  }
}

/**
 * Resolve one Session-selected Codex mode into all native permission fields.
 * @param mode - Current provider-aware permission preset.
 * @param cwd - Absolute Session workspace used as the only explicit writable root.
 * @returns Complete thread and turn permission settings.
 * @throws when the mode is not one of the three stable Codex modes.
 */
export function resolveCodexPermission(mode: string, cwd: string): ResolvedCodexPermission {
  assertAbsoluteCwd(cwd)
  switch (mode) {
    case 'ask-for-approval':
      return {
        mode,
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        threadSandbox: 'workspace-write',
        sandboxPolicy: workspaceWrite(cwd),
      }
    case 'approve-for-me':
      return {
        mode,
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
        threadSandbox: 'workspace-write',
        sandboxPolicy: workspaceWrite(cwd),
      }
    case 'danger-full-access':
      return {
        mode,
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        threadSandbox: 'danger-full-access',
        sandboxPolicy: { type: 'dangerFullAccess' },
      }
    default:
      throw new Error(
        `embedded-codex: permission preset ${JSON.stringify(mode)} cannot start a Codex turn; select Ask for approval, Approve for me, or Full access`,
      )
  }
}

/**
 * Translate deprecated deployment-wide settings when the permission service is absent.
 * @param legacy - Static settings from the embedded-codex plugin config.
 * @param cwd - Absolute Session workspace.
 * @returns Complete native permission settings marked as a legacy fallback.
 */
export function resolveLegacyCodexPermission(
  legacy: LegacyCodexPermission,
  cwd: string,
): ResolvedCodexPermission {
  assertAbsoluteCwd(cwd)
  const sandboxPolicy: SandboxPolicy = legacy.sandbox === 'danger-full-access'
    ? { type: 'dangerFullAccess' }
    : legacy.sandbox === 'read-only'
      ? { type: 'readOnly', networkAccess: false }
      : workspaceWrite(cwd)
  return {
    mode: 'legacy-fallback',
    approvalPolicy: legacy.approvalPolicy,
    approvalsReviewer: 'user',
    threadSandbox: legacy.sandbox,
    sandboxPolicy,
  }
}
