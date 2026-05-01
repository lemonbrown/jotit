import { DEFAULT_NIB_PROMPTS, NIB_PROMPT_DEFINITIONS, buildNibPrompt } from './nibPrompts.js'

export const DEFAULT_NIB_TEMPLATES = {
  codeReview: DEFAULT_NIB_PROMPTS['template.codeReview'],
}

export const NIB_TEMPLATE_DEFINITIONS = [
  ...NIB_PROMPT_DEFINITIONS
    .filter(item => item.id === 'template.codeReview')
    .map(item => ({ ...item, id: 'codeReview' })),
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
  if (templateId === 'codeReview') return buildNibPrompt(settings, 'template.codeReview', variables)
  return renderNibTemplate(getNibTemplate(settings, templateId), variables).trim()
}
