import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CODEX_PERMISSION_MODES,
  resolveCodexPermission,
  resolveLegacyCodexPermission,
} from '../src/permissions.ts'

const cwd = resolve('permission-fixture')

describe('Codex permission resolution', () => {
  it('maps every stable Codex mode to a complete native policy', () => {
    expect(CODEX_PERMISSION_MODES).toEqual([
      'ask-for-approval',
      'approve-for-me',
      'danger-full-access',
    ])
    expect(resolveCodexPermission('ask-for-approval', cwd)).toEqual({
      mode: 'ask-for-approval',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      threadSandbox: 'workspace-write',
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: [cwd],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
    })
    expect(resolveCodexPermission('approve-for-me', cwd)).toEqual({
      mode: 'approve-for-me',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
      threadSandbox: 'workspace-write',
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: [cwd],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
    })
    expect(resolveCodexPermission('danger-full-access', cwd)).toEqual({
      mode: 'danger-full-access',
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      threadSandbox: 'danger-full-access',
      sandboxPolicy: { type: 'dangerFullAccess' },
    })
  })

  it('fails closed for custom, standard, unknown, and relative selections', () => {
    for (const mode of ['custom', 'workspace-write', 'read-only', 'unknown']) {
      expect(() => resolveCodexPermission(mode, cwd)).toThrow(/cannot start a Codex turn/)
    }
    expect(() => resolveCodexPermission('ask-for-approval', 'relative'))
      .toThrow(/absolute session cwd/)
  })

  it('keeps deprecated static settings as an explicit provider-less fallback', () => {
    expect(resolveLegacyCodexPermission({
      approvalPolicy: 'on-request',
      sandbox: 'read-only',
    }, cwd)).toEqual({
      mode: 'legacy-fallback',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      threadSandbox: 'read-only',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
    })
  })
})
