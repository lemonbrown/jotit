import { getCategoryColor } from '../utils/helpers'

export default function CategoryBadge({ category, size = 'sm' }) {
  const colors = getCategoryColor(category)
  const base = size === 'xs'
    ? 'text-[10px] px-1 py-0.5'
    : 'text-xs px-1.5 py-0.5'
  return (
    <span className={`inline-flex items-center rounded border font-mono ${base} ${colors} whitespace-nowrap`}>
      #{category}
    </span>
  )
}
