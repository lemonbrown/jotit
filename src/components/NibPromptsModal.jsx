import { useState } from 'react'
import NibTemplatesSection from './settings/NibTemplatesSection'

export default function NibPromptsModal({ settings, onSave, onClose }) {
  const [nibPrompts, setNibPrompts] = useState({
    ...(settings.nibTemplates?.codeReview ? { 'template.codeReview': settings.nibTemplates.codeReview } : {}),
    ...(settings.nibPrompts ?? {}),
  })

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[640px] max-h-[88vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-zinc-100">Nib prompts</h2>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <NibTemplatesSection prompts={nibPrompts} onChange={setNibPrompts} />

        <div className="flex items-center justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(nibPrompts)}
            className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors font-medium"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
