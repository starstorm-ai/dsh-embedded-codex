import type {
  Agent,
  AgentFactory,
  AgentOptions,
} from '@deepseek-ai/dsh-agent'

declare module '@deepseek-ai/dsh-agent' {
  interface ResumeAgentOptions {
    /** Preset id used to select a named Agent Runtime factory. */
    readonly agentPreset?: string
  }

  interface AgentRegistry {
    /** Register one preset-selected Agent Runtime. */
    setPresetFactory(
      agentPreset: string,
      factory: AgentFactory,
      defaultAgentOptions?: AgentOptions,
    ): () => void
    /** Read the model defaults declared by a preset-selected Runtime. */
    presetFactoryOptions(agentPreset: string | undefined): AgentOptions | undefined
    /** Read the model defaults declared by the Runtime that owns a live Agent. */
    agentFactoryOptions(agent: Agent): AgentOptions | undefined
    /** Test whether a live Agent Runtime accepts a model provider route. */
    acceptsModelProvider(agent: Agent, provider: string): boolean
    /** Test whether selecting a preset requires replacement of the live Agent. */
    requiresFactorySwitch(agent: Agent, agentPreset: string): boolean
  }
}

