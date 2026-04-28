import { useMemo } from 'react'
import { scanForSecrets, contentHash } from '../utils/secretScanner'

export default function SecretAlert({ content, clearedHash, onMarkSafe }) {
  const matches = useMemo(() => scanForSecrets(content), [content])
  const isCleared = Boolean(clearedHash && clearedHash === contentHash(content))

  if (!matches.length || isCleared) return null

  return (
    <div className="flex items-start gap-3 px-3 py-2 bg-amber-950/40 border-b border-amber-800/40 shrink-0">
      <svg className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium text-amber-300 mb-0.5">Potential secrets detected</p>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {matches.map((m, i) => (
            <span key={i} className="text-[10px] text-amber-200/60 font-mono">
              {m.label}: <span className="text-amber-400">{m.redacted}</span>
            </span>
          ))}
        </div>
      </div>
      <button
        onMouseDown={e => e.preventDefault()}
        onClick={() => onMarkSafe(contentHash(content))}
        className="shrink-0 text-[10px] text-amber-700 hover:text-amber-400 transition-colors font-medium whitespace-nowrap mt-0.5"
      >
        Mark safe
      </button>
    </div>
  )
}
