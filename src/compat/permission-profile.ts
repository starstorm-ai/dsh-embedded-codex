import type { PermissionChoice, RuntimePermissionProfile } from './contracts.ts'

export interface PermissionFacts {
  readonly preset: string | null
  readonly sandbox: PermissionChoice['sandbox']
  readonly approval: PermissionChoice['approval']
}

/** Preserve named modes even when their underlying sandbox/approval tuples match. */
export function deriveRuntimePermission(profile: RuntimePermissionProfile, facts: PermissionFacts): string {
  const matches = (spec: PermissionChoice): boolean =>
    spec.sandbox === facts.sandbox && spec.approval === facts.approval
  if (facts.preset !== null) {
    const name = Object.hasOwn(profile.presets, facts.preset)
      ? facts.preset : profile.legacyAliases?.[facts.preset]
    const spec = name === undefined ? undefined : profile.presets[name]
    return name !== undefined && spec !== undefined && matches(spec) ? name : 'custom'
  }
  return Object.entries(profile.presets).find(([, spec]) => matches(spec))?.[0] ?? 'custom'
}

export function permissionOption(value: string, spec: PermissionChoice): {
  value: string; name: string; description?: string
} {
  return { value, name: spec.name ?? value, ...(spec.description === undefined ? {} : { description: spec.description }) }
}
