/**
 * Catalog-only `ctx.llm` adapter for existing DSH model-selection surfaces.
 * @module dsh-embedded-codex/catalog
 */

import {
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { CodexAppServerHost, CodexModelCatalogEntry } from './app-server.ts'

function modelInfo(provider: string, model: CodexModelCatalogEntry): LlmModelInfo {
  return {
    provider,
    id: model.id,
    name: model.displayName,
    ...(model.description.length === 0 ? {} : { description: model.description }),
    inputModalities: model.inputModalities,
  }
}

/** Model directory adapter whose generation path is deliberately terminal. */
export class CodexCatalogAdapter extends LlmAdapter {
  constructor(
    private readonly appServer: CodexAppServerHost,
    private readonly provider: string,
    private readonly providerDisplayName: string,
    private readonly defaultModelAlias: string,
  ) {
    super()
  }

  override providerInfo(provider: string) {
    return { id: provider, name: this.providerDisplayName }
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const models = await this.appServer.listModels()
    return [
      {
        provider,
        id: this.defaultModelAlias,
        name: 'Codex default',
        description: 'Use the default model selected by the signed-in Codex runtime.',
        inputModalities: ['text', 'image'],
      },
      ...models.filter(model => model.id !== this.defaultModelAlias).map(model => modelInfo(provider, model)),
    ]
  }

  /**
   * Resolve a model id against the native account-scoped catalog.
   * @param modelId - Model id or configured default alias to resolve.
   */
  override async resolveModel(
    provider: string,
    modelId: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    const models = await this.appServer.listModels(signal)
    const selected = modelId === this.defaultModelAlias
      ? models.find(model => model.isDefault)
      : models.find(model => model.id === modelId)
    if (selected === undefined) {
      if (modelId === this.defaultModelAlias) {
        return { provider, id: modelId, name: 'Codex default', inputModalities: ['text', 'image'] }
      }
      return { provider, id: modelId, name: modelId }
    }
    return {
      ...modelInfo(provider, selected),
      id: modelId,
      reasoning: {
        efforts: selected.efforts.map(effort => ({
          id: ReasoningEffortId(effort.id),
          name: effort.id,
          ...(effort.description.length === 0 ? {} : { description: effort.description }),
        })),
        defaultEffort: ReasoningEffortId(selected.defaultEffort),
      },
    }
  }

  override stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new LlmError(
      `provider ${JSON.stringify(this.provider)} is an Agent Runtime catalog route; send work through ctx.agents`,
      'CODEX_RUNTIME_ONLY',
    )
  }
}
