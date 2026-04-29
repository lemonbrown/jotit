import { useState, useCallback, useEffect, useMemo } from 'react'
import { getAllTemplates, upsertTemplateSync, deleteTemplateSync, schedulePersist } from '../utils/db'
import { BUILTIN_TEMPLATES, createTemplateDraft } from '../utils/noteTemplates'

export function useTemplates({ dbReady }) {
  const [userTemplates, setUserTemplates] = useState([])

  useEffect(() => {
    if (!dbReady) return
    setUserTemplates(getAllTemplates())
  }, [dbReady])

  // User templates shadow built-ins that share the same command
  const templates = useMemo(() => {
    const userCmds = new Set(userTemplates.map(t => t.command))
    const builtins = BUILTIN_TEMPLATES.filter(t => !userCmds.has(t.command))
    return [...builtins, ...userTemplates]
  }, [userTemplates])

  const saveTemplate = useCallback(({ id, command, name, body }) => {
    const draft = id
      ? { id, command: String(command).trim().replace(/^!+/, ''), name: String(name).trim(), body: String(body), updatedAt: Date.now(), createdAt: Date.now() }
      : createTemplateDraft({ command, name, body })
    upsertTemplateSync(draft)
    schedulePersist()
    setUserTemplates(getAllTemplates())
    return draft
  }, [])

  const deleteTemplate = useCallback((id) => {
    deleteTemplateSync(id)
    schedulePersist()
    setUserTemplates(getAllTemplates())
  }, [])

  return { templates, userTemplates, saveTemplate, deleteTemplate }
}
