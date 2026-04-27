import { useEffect, useMemo } from 'react'
import { escapeHtml, parseCsvRows, renderPublicMarkdown } from '../../utils/publicContent'

function PublicTable({ content }) {
  const rows = useMemo(() => parseCsvRows(content), [content])
  if (rows.length < 2) {
    return <pre><code>{content}</code></pre>
  }

  const width = Math.max(...rows.map(row => row.length))
  const headers = rows[0].map((header, index) => header.trim() || `Column ${index + 1}`)
  while (headers.length < width) headers.push(`Column ${headers.length + 1}`)

  return (
    <table>
      <thead>
        <tr>{headers.map((header, index) => <th key={`${header}:${index}`}>{header}</th>)}</tr>
      </thead>
      <tbody>
        {rows.slice(1).map((row, rowIndex) => {
          const normalized = [...row]
          while (normalized.length < width) normalized.push('')
          return (
            <tr key={rowIndex}>
              {normalized.slice(0, width).map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default function PublicMarkdown({ content, viewMode = null, onHeadings }) {
  const rendered = useMemo(() => {
    if (viewMode === 'code') {
      return { headings: [], html: `<pre><code>${escapeHtml(content)}</code></pre>` }
    }
    if (viewMode === 'table') {
      return null
    }
    return renderPublicMarkdown(content)
  }, [content, viewMode])

  useEffect(() => {
    if (rendered && onHeadings) onHeadings(rendered.headings)
  }, [onHeadings, rendered])

  if (viewMode === 'table') {
    return (
      <article className="md-prose public-prose">
        <PublicTable content={content} />
      </article>
    )
  }

  return (
    <article
      className="md-prose public-prose"
      dangerouslySetInnerHTML={{ __html: rendered?.html ?? '' }}
    />
  )
}
