import { useEffect, useState } from 'react'
import { loadSessionProjections, openSyncDatabase } from '../../services/storage'
import type { SessionProjection } from '../../sync/projection'
import { groupSessionDirectory } from './directory-model'

export function useSessionDrawer(open: boolean): readonly SessionProjection[] {
  const [sessions, setSessions] = useState<readonly SessionProjection[]>([])
  useEffect(() => {
    if (!open) return
    const database = openSyncDatabase()
    const refresh = (): void => {
      const sections = groupSessionDirectory(loadSessionProjections(database))
      setSessions([...sections.attention, ...sections.recent])
    }
    refresh()
    const timer = setInterval(refresh, 1_000)
    return () => clearInterval(timer)
  }, [open])
  return sessions
}
