export type TextSearchOptions = {
  caseSensitive: boolean
  wholeWord: boolean
  useRegex: boolean
}

export type TextSearchMatch = {
  start: number
  end: number
  text: string
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function createSearchRegex(query: string, options: TextSearchOptions): RegExp {
  const pattern = options.useRegex ? query : escapeRegExp(query)
  const withWordBoundary = options.wholeWord
    ? `(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`
    : pattern
  return new RegExp(withWordBoundary, `gu${options.caseSensitive ? '' : 'i'}`)
}

export function getSearchPatternError(query: string, options: TextSearchOptions): string | null {
  if (!query) return null
  try {
    createSearchRegex(query, options)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : '正则表达式无效'
  }
}

export function findTextMatches(text: string, query: string, options: TextSearchOptions): TextSearchMatch[] {
  if (!query) return []
  let regex: RegExp
  try {
    regex = createSearchRegex(query, options)
  } catch {
    return []
  }

  const matches: TextSearchMatch[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex += 1
      continue
    }
    matches.push({ start: match.index, end: match.index + match[0].length, text: match[0] })
  }
  return matches
}

export function replaceTextMatch(match: TextSearchMatch, query: string, replacement: string, options: TextSearchOptions): string {
  try {
    return match.text.replace(createSearchRegex(query, options), replacement)
  } catch {
    return replacement
  }
}
