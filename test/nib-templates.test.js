import assert from 'node:assert/strict'
import { buildNibMessage, getNibTemplate, renderNibTemplate } from '../src/utils/nibTemplates.js'

export default [
  ['Nib templates render default code review prompt', () => {
    const message = buildNibMessage({}, 'codeReview', { label: 'PR #42 diff for src/App.jsx' })

    assert.equal(
      message,
      'Review this PR #42 diff for src/App.jsx. Focus on correctness bugs, regressions, edge cases, and missing tests.',
    )
  }],
  ['Nib templates allow global overrides', () => {
    const settings = {
      nibTemplates: {
        codeReview: 'Review {{path}} in {{repoName}} for {{viewType}} issues.',
      },
    }

    assert.equal(
      buildNibMessage(settings, 'codeReview', {
        path: 'src/App.jsx',
        repoName: 'jotit',
        viewType: 'pr',
      }),
      'Review src/App.jsx in jotit for pr issues.',
    )
  }],
  ['Nib templates replace missing variables with blanks', () => {
    assert.equal(renderNibTemplate('{{known}} {{missing}}', { known: 'value' }), 'value ')
    assert.equal(getNibTemplate({ nibTemplates: { custom: 'Hello {{name}}' } }, 'custom'), 'Hello {{name}}')
  }],
]
