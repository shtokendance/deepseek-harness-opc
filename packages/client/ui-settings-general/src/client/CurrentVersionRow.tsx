/** Installed release version in General Settings for Web and Desktop. */
import { useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './CurrentVersionRow.module.css'

const RELEASE_NOTES_URL = 'https://aiwork.benlai.com/workopc/download/latest.json'

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
    void fetch(RELEASE_NOTES_URL, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error('fetch failed')
        return await res.json() as { version?: string; release_notes?: string }
      })
      .then((data) => {
        if (!active) return
        setLatestVersion(typeof data.version === 'string' ? data.version : '')
        setNotes(typeof data.release_notes === 'string' ? data.release_notes.trim() : '')
      })
      .catch(() => {
        if (!active) return
        setNotes('')
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
