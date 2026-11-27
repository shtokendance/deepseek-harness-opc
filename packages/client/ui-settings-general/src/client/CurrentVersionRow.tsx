/** Installed release version in General Settings for Web and Desktop. */
import { useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './CurrentVersionRow.module.css'

const CHANGELOG_URL = 'https://aiwork.benlai.com/workopc/update/changelog'
const LATEST_JSON_URL = 'https://aiwork.benlai.com/workopc/download/latest.json'

interface ChangelogEntry {
  version: string
  channel?: string
  release_notes?: string
  published_at?: string
}

function formatChangelog(entries: ChangelogEntry[]): string {
  const valid = entries.filter(e => typeof e.version === 'string' && typeof e.release_notes === 'string' && e.release_notes.trim() !== '')
  if (valid.length === 0) return ''
  return valid.map(e => `v${e.version}${e.channel === 'nightly' ? ' (nightly)' : ''}\n${(e.release_notes ?? '').trim()}`).join('\n\n')
}

export function CurrentVersionRow({ t }: PropsRuntime<'settings.general.item'> & PropsLocale<'settings'>) {
  const version = process.env.DSH_CLIENT_VERSION
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notes, setNotes] = useState<string>('')
  const [latestVersion, setLatestVersion] = useState<string>('')

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    void fetch(CHANGELOG_URL, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error('changelog failed')
        const json = await res.json() as { code?: number; data?: ChangelogEntry[] }
        const list = Array.isArray(json.data) ? json.data : []
        const formatted = formatChangelog(list)
        if (list[0]?.version && active) setLatestVersion(list[0].version)
        if (formatted) return formatted
        throw new Error('empty changelog')
      })
      .catch(async () => {
        const res = await fetch(LATEST_JSON_URL, { cache: 'no-store' })
        if (!res.ok) throw new Error('latest failed')
        const data = await res.json() as { version?: string; release_notes?: string }
        if (typeof data.version === 'string' && active) setLatestVersion(data.version)
        return typeof data.release_notes === 'string' ? data.release_notes.trim() : ''
      })
      .then((text) => {
        if (active) setNotes(text)
      })
      .catch(() => {
        if (active) setNotes('')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [open])

  if (version === undefined) return null
  const displayVersion = latestVersion || version
  return (
    <>
      <div className={css.row}>
        <span>{t('general.currentVersion', { version })}</span>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          {t('general.changelog')}
        </Button>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('general.changelog.title', { version: displayVersion })}
        closeLabel={t('general.changelog.close')}
        footer={<Button variant="primary" data-modal-autofocus onClick={() => setOpen(false)}>{t('general.changelog.close')}</Button>}
      >
        <p className={css.changelogBody}>
          {loading ? t('general.changelog.loading') : (notes || t('general.changelog.empty'))}
        </p>
      </Modal>
    </>
  )
}
