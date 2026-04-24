import KEYWORD_DATA from '../embedding_keywords.json'
import { looksLikeCsvTable } from './csvTable.js'

export function categorizeByPatterns(content) {
  const matched = []
  if (looksLikeCsvTable(content)) matched.push('CSV / Tables')
  for (const cat of KEYWORD_DATA.categories) {
    if (matched.includes(cat.name)) continue
    if (!cat.patterns?.length) continue
    for (const pattern of cat.patterns) {
      if (new RegExp(pattern).test(content)) {
        matched.push(cat.name)
        break
      }
    }
  }
  return matched
}
