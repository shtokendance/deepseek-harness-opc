/**
 * Per-bundle configuration defaults the WorkOPC desktop application supplies
 * beneath every profile layer.
 *
 * @module @deepseek-ai/dsh-desktop-host
 */
import type { ProfileContext } from '@deepseek-ai/dsh-app-boot'

/** Model id the Benlai platform labels as its global recommendation. */
export const BENLAI_RECOMMENDED_MODEL_NAME = 'Benlai/DeepSeek-V4.1-Flash（全局推荐）'

/** Provider route carrying the Benlai platform catalog. */
export const BENLAI_PROVIDER_ID = 'opc-benlai-ai'

/** Agent preset that keeps Computer Use usable beside ordinary tools. */
export const WORKOPC_DEFAULT_PRESET = 'ptc'

/**
 * Bundle defaults keyed by the bundle package that declares the patched row.
 * Each list is appended after that bundle's own patches, so it wins over the
 * shipped value yet stays beneath the profile patch file, the home patch file,
 * and command-line overlays; a user's saved choice therefore still wins.
 */
export const workopcBundleDefaults: NonNullable<ProfileContext['bundleDefaults']> = {
  '@deepseek-ai/dsh-base': [{
    id: 'agent-default-model',
    config: {
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      // Resolved by display name because the platform assigns model ids at sign-in.
      preferred: { provider: BENLAI_PROVIDER_ID, name: BENLAI_RECOMMENDED_MODEL_NAME },
    },
  }],
  '@deepseek-ai/dsh-web-app': [{ id: 'agent-preset-registry', config: { default: WORKOPC_DEFAULT_PRESET } }],
  // The LOCAL row's activate action commits this value; it drives the managed local browser.
  'dsh-browser-cdp': [{ id: 'dsh-browser-cdp', config: { cdpMode: 'local' } }],
}
