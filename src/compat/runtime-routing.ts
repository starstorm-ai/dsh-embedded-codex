import { symbols } from '@deepseek-ai/cordis'
import type { Agent, AgentFactory, AgentOptions } from '@deepseek-ai/dsh-agent'
import type { RuntimeDescriptor } from './contracts.ts'
import { compatibilityManifest } from './generated-manifest.ts'

/** The plain slot preserves Cordis's caller tracing at the original registry boundary. */
export interface RuntimeFactorySlot {
  readonly target: AgentFactory
  readonly descriptor?: RuntimeDescriptor
}

/** Owned by one Agent Registry, never shared through module-global mutable state. */
export class RuntimeRouting {
  private readonly runtimes = new Map<string, RuntimeFactorySlot>()
  private readonly presets = new Map<string, RuntimeFactorySlot>()
  private readonly live = new WeakMap<Agent, RuntimeFactorySlot>()
  private readonly declaredPresets = new Set<string>(compatibilityManifest.runtimePresets)
  private readonly declaredProviders = new Set<string>(compatibilityManifest.runtimeProviders)

  register(descriptor: RuntimeDescriptor): () => void {
    if (!descriptor.id || descriptor.presetIds.length === 0 || descriptor.modelProviders.length === 0) {
      throw new Error('runtime registration requires an id, presets and model providers')
    }
    if (this.runtimes.has(descriptor.id)) throw new Error(`runtime ${descriptor.id} is already registered`)
    if (new Set(descriptor.presetIds).size !== descriptor.presetIds.length
      || descriptor.presetIds.some(id => !id || this.presets.has(id))) {
      throw new Error('runtime registration contains duplicate or empty preset ids')
    }
    if (descriptor.defaultAgentOptions.provider === undefined
      || !descriptor.modelProviders.includes(descriptor.defaultAgentOptions.provider)) {
      throw new Error('runtime default model must belong to one of its providers')
    }
    for (const other of this.runtimes.values()) {
      if (other.descriptor?.modelProviders.some(provider => descriptor.modelProviders.includes(provider))) {
        throw new Error('model provider is already owned by another runtime')
      }
    }
    if (descriptor.permissions !== undefined
      && descriptor.permissions.presets[descriptor.permissions.defaultPreset] === undefined) {
      throw new Error('runtime permission default must name a declared choice')
    }
    const target = (descriptor.factory as AgentFactory & { [symbols.original]?: AgentFactory })[symbols.original]
      ?? descriptor.factory
    const copy: RuntimeDescriptor = Object.freeze({
      ...descriptor,
      factory: target,
      presetIds: Object.freeze([...descriptor.presetIds]),
      modelProviders: Object.freeze([...descriptor.modelProviders]),
      defaultAgentOptions: Object.freeze({ ...descriptor.defaultAgentOptions }),
      ...(descriptor.permissions === undefined ? {} : {
        permissions: Object.freeze(structuredClone(descriptor.permissions)),
      }),
    })
    const slot = { target, descriptor: copy }
    this.runtimes.set(copy.id, slot)
    for (const provider of copy.modelProviders) this.declaredProviders.add(provider)
    for (const id of copy.presetIds) {
      this.declaredPresets.add(id)
      this.presets.set(id, slot)
    }
    return () => {
      if (this.runtimes.get(copy.id) !== slot) return
      this.runtimes.delete(copy.id)
      for (const id of copy.presetIds) this.presets.delete(id)
      // Retain the declarations so an unloaded runtime never silently becomes the default loop.
    }
  }

  forPreset(preset: string | undefined): RuntimeFactorySlot | undefined {
    if (preset === undefined) return undefined
    const slot = this.presets.get(preset)
    if (slot === undefined && this.declaredPresets.has(preset)) {
      throw new Error(`runtime for Agent preset ${JSON.stringify(preset)} is unavailable`)
    }
    return slot
  }

  remember(agent: Agent, slot: RuntimeFactorySlot): void {
    this.live.set(agent, slot)
  }

  forAgent(agent: Agent): RuntimeFactorySlot | undefined {
    return this.live.get(agent)
  }

  options(preset: string | undefined): AgentOptions | undefined {
    const descriptor = this.forPreset(preset)?.descriptor
    return descriptor === undefined ? undefined : { ...descriptor.defaultAgentOptions }
  }

  accepts(agent: Agent, provider: string): boolean {
    const descriptor = this.live.get(agent)?.descriptor
    if (descriptor !== undefined) {
      return this.runtimes.get(descriptor.id)?.descriptor === descriptor && descriptor.modelProviders.includes(provider)
    }
    return !this.declaredProviders.has(provider)
  }

  permissionChoice(name: string) {
    return [...this.runtimes.values()].map(slot => slot.descriptor?.permissions?.presets[name]).find(Boolean)
  }

  permissionNames(): string[] {
    return [...new Set([...this.runtimes.values()].flatMap(slot => Object.keys(slot.descriptor?.permissions?.presets ?? {})))]
  }
}
