import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  AgentPreset,
  AgentPresetRegistry,
} from '@deepseek-ai/dsh-agent-preset-registry'

/** Host callback that replaces a blank Agent when a preset selects another Runtime. */
interface AgentPresetRuntimeSwitcher {
  /** Replace the Agent and publish the resolved preset selection. */
  switchRuntime(agent: Agent, preset: AgentPreset): Promise<void>
}

declare module '@deepseek-ai/dsh-agent-preset-registry' {
  interface AgentPresetRegistry {
    /** Register the Host owner of blank-session Runtime replacement. */
    setRuntimeSwitcher(switcher: AgentPresetRuntimeSwitcher): () => void
  }
}

export type { AgentPresetRegistry, AgentPresetRuntimeSwitcher }
