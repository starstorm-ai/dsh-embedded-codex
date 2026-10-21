import type { Agent, AgentFactory, AgentOptions } from '@deepseek-ai/dsh-agent'

export interface PermissionChoice {
  readonly sandbox: 'read-only' | 'workspace-write' | 'danger-full-access'
  readonly approval: 'ask' | 'never'
  readonly name?: string
  readonly description?: string
}

/** A runtime's vocabulary; DSH still owns the durable permission events and UI. */
export interface RuntimePermissionProfile {
  readonly defaultPreset: string
  readonly presets: Readonly<Record<string, PermissionChoice>>
  readonly legacyAliases?: Readonly<Record<string, string>>
  readonly allowChangesWhileRunning: boolean
}

/** Internal compatibility contract, intentionally separate from Agent Preset identity. */
export interface RuntimeDescriptor {
  readonly id: string
  readonly presetIds: readonly string[]
  readonly factory: AgentFactory
  readonly defaultAgentOptions: AgentOptions
  readonly modelProviders: readonly string[]
  readonly permissions?: RuntimePermissionProfile
}

/** Local compatibility contract, shipped with the replacement declarations. */
declare module '@deepseek-ai/dsh-agent' {
  interface ResumeAgentOptions { readonly agentPreset?: string }
  interface AgentRegistry {
    registerRuntime(descriptor: RuntimeDescriptor): () => void
    runtimeForPreset(preset: string | undefined): RuntimeDescriptor | undefined
    runtimePermissionNames(): string[]
    runtimePermissionChoice(name: string): PermissionChoice | undefined
    presetFactoryOptions(preset: string | undefined): AgentOptions | undefined
    agentFactoryOptions(agent: Agent): AgentOptions | undefined
    acceptsModelProvider(agent: Agent, provider: string): boolean
    requiresFactorySwitch(agent: Agent, preset: string): boolean
  }
}
