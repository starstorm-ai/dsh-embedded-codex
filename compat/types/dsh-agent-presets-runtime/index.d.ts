import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  AgentPreset,
  AgentPresets,
  PresetRoot,
} from '@deepseek-ai/dsh-agent-presets'

/** Host callback that replaces a blank Agent when a preset selects another Runtime. */
interface AgentPresetRuntimeSwitcher {
  /** Replace the Agent and publish the resolved preset selection. */
  switchRuntime(agent: Agent, preset: AgentPreset): Promise<void>
}

declare module '@deepseek-ai/dsh-agent-presets' {
  interface AgentPresets {
    /** Register a package-owned, read-only preset root. */
    registerRoot(root: PresetRoot): () => void
    /** Register the Host owner of blank-session Runtime replacement. */
    setRuntimeSwitcher(switcher: AgentPresetRuntimeSwitcher): () => void
  }
}

export type { AgentPresetRuntimeSwitcher, AgentPresets }

