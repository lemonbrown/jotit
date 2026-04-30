export const DEFAULT_NIB_TEMPLATES = {
  codeReview: 'Review this {{label}}. Focus on correctness bugs, regressions, edge cases, and missing tests.',
}

export const NIB_TEMPLATE_DEFINITIONS = [
  {
    id: 'codeReview',
    label: 'Code review',
    description: 'Used when sending a selected PR or git diff to Nib.',
    variables: ['label', 'path', 'repoName', 'prNumber', 'base', 'viewType'],
  },
]

export function getNibTemplates(settings = {}) {
  return {
    ...DEFAULT_NIB_TEMPLATES,
    ...(settings.nibTemplates ?? {}),
  }
}

export function getNibTemplate(settings = {}, templateId) {
  return getNibTemplates(settings)[templateId] ?? ''
}

export function renderNibTemplate(template, variables = {}) {
  return String(template ?? '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = variables[key]
    return value == null ? '' : String(value)
  })
}

export function buildNibMessage(settings = {}, templateId, variables = {}) {
  return renderNibTemplate(getNibTemplate(settings, templateId), variables).trim()
}
