/**
 * Default model selection for an Agent without a session-specific selection.
 *
 * @module @deepseek-ai/dsh-agent-default-model
 */
import type {} from '@deepseek-ai/dsh-settings'

import type { Volatile } from '@deepseek-ai/cordis'

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-config-editor'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Default model selection for Agents created without an explicit model. */
    agentDefaultModel: AgentDefaultModelConfig
  }
}

/** Deployment preference for one catalog entry, resolved by its display name. */
export interface PreferredModel {
  /** Registered provider route that must be available before the entry is used. */
  provider: string
  /** Catalog display name; leading, trailing, and repeated whitespace are ignored. */
  name: string
}

/** Default model selection supplied by plugin configuration. */
export interface Config {
  /** Registered provider route. */
  provider: Volatile<string>
  /** Provider-owned model id. */
  model: Volatile<string>
  /** Adapter-owned reasoning effort; omission follows the provider default. */
  reasoningEffort: Volatile<string | undefined>
  /** Catalog entry that outranks the configured selection while its provider advertises it. */
  preferred?: PreferredModel
}

/** Fold a catalog display name for comparison: compatibility-normalized with all whitespace removed. */
function normalizeName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/gu, '')
}

/** Project stored settings onto the Agent-facing selection type. */
function selection(settings: { provider: string; model: string; reasoningEffort?: string }): ModelSelection {
  return {
    provider: settings.provider,
    model: settings.model,
    ...settings.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: brandString<ReasoningEffortId>(settings.reasoningEffort) },
  }
}

/**
 * Owns the default model selection independently of any Host or transport.
 * Each operation reads the owning Config references.
 */
export class AgentDefaultModelConfig extends Service {
  private saves: Promise<void> = Promise.resolve()
  /** Model id the preferred catalog entry currently resolves to; undefined while its provider is unavailable. */
  private preferredModel: string | undefined

  static Config = z.object({
    provider: z.string().required().volatile(),
    model: z.string().required().volatile(),
    reasoningEffort: z.string().volatile(),
    // The `const(undefined)` arm keeps an absent entry absent instead of demanding
    // its members; a deployment-only preference stays out of the settings form.
    preferred: z.union([z.object({ provider: z.string(), name: z.string() }), z.const(undefined)]).hidden(),
  })

  constructor(private readonly ownerContext: Context, private config: Config) {
    super(ownerContext, 'agentDefaultModel')

    ownerContext.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ownerContext.fiber)) })
    const preferred = config.preferred
    if (preferred === undefined) return
    ownerContext.inject(['llm'], (ctx) => {
      const wanted = normalizeName(preferred.name)
      // A catalog read outliving a newer request must not publish; every request takes the next revision.
      let revision = 0
      const resolve = (): void => {
        if (!ctx.llm.listProviders().some(provider => provider.id === preferred.provider)) {
          revision++
          this.preferredModel = undefined
          return
        }
        const current = ++revision
        void ctx.llm.listModels(preferred.provider).then(
          models => models.find(model => normalizeName(model.name) === wanted)?.id,
          () => undefined,
        ).then((model) => {
          if (current !== revision || model === this.preferredModel) return
          this.preferredModel = model
          ctx.emit('llm/models-updated', preferred.provider)
        })
      }
      ctx.on('llm/adapters-updated', resolve)
      ctx.on('llm/models-updated', (provider) => { if (provider === preferred.provider) resolve() })
      ctx.effect(() => {
        resolve()
        return () => { revision++; this.preferredModel = undefined }
      })
    })
  }

  /**
   * Read the current default model selection.
   * @returns a detached provider, model, and optional reasoning selection.
   */
  currentSelection(): ModelSelection {
    if (this.config.preferred !== undefined && this.preferredModel !== undefined) {
      return { provider: this.config.preferred.provider, model: this.preferredModel }
    }
    const reasoningEffort = this.config.reasoningEffort.get()
    return selection({
      provider: this.config.provider.get(), model: this.config.model.get(),
      ...reasoningEffort === undefined ? {} : { reasoningEffort },
    })
  }

  /**
   * Save the complete default model selection. A deployment without a configuration
   * editor keeps its composition entry. Saves commit in submission order; a failed
   * save rejects its caller without blocking later saves.
   * @param next - resolved selection accepted by an entry point.
   * @returns fulfillment after the optional profile write settles.
   */
  async saveSelection(next: ModelSelection): Promise<void> {
    const entry = this.ownerContext.fiber.entry
    if (entry === undefined) return
    const editor = this.ctx.get('configEditor')
    if (editor === undefined) return
    const config = {
      provider: next.provider, model: next.model,
      ...next.reasoningEffort === undefined ? {} : { reasoningEffort: String(next.reasoningEffort) },
    }
    const saved = this.saves.then(() => editor.edit(entry, () => config))
    this.saves = saved.catch(() => {})
    await saved
  }
}

export default AgentDefaultModelConfig
