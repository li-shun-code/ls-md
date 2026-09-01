function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character)
}

function isSafeHref(href: string): boolean {
  return /^(?:https?:\/\/|mailto:|#|\.{0,2}\/|\/)[^\s]+$/i.test(href)
}

function inlineMarkdown(source: string): string {
  let html = escapeHtml(source)
  const protectedHtml: string[] = []
  const protect = (value: string) => {
    protectedHtml.push(value)
    return `@@AIMDSLOT${protectedHtml.length - 1}@@`
  }

  html = html.replace(/`([^`]+)`/g, (_match, code: string) => protect(`<code>${code}</code>`))
  html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_match, alt: string, href: string) => {
    if (!/^https?:\/\//i.test(href)) return `![${alt}](${href})`
    return protect(`<img src="${escapeHtml(href)}" alt="${alt}" />`)
  })
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_match, label: string, href: string, title?: string) => {
    if (!isSafeHref(href)) return `[${label}](${href})`
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : ''
    return protect(`<a href="${escapeHtml(href)}"${titleAttribute} target="_blank" rel="noreferrer">${label}</a>`)
  })
  html = html.replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_match, strongA?: string, strongB?: string) => protect(`<strong>${strongA ?? strongB ?? ''}</strong>`))
  html = html.replace(/~~(.+?)~~/g, (_match, text: string) => protect(`<del>${text}</del>`))
  html = html.replace(/\*([^*\n]+)\*|_([^_\n]+)_/g, (_match, italicA?: string, italicB?: string) => protect(`<em>${italicA ?? italicB ?? ''}</em>`))
  html = html.replace(/ {2,}\n/g, '<br />')

  return html.replace(/@@AIMDSLOT(\d+)@@/g, (_match, index: string) => protectedHtml[Number(index)] ?? '')
}

function splitTableRow(line: string): string[] {
  const value = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return value.split('|').map((cell) => cell.trim())
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function renderTable(lines: string[], start: number): { html: string; next: number } {
  const headers = splitTableRow(lines[start])
  const rows: string[][] = []
  let next = start + 2
  while (next < lines.length && lines[next].trim() && lines[next].includes('|')) {
    rows.push(splitTableRow(lines[next]))
    next += 1
  }

  const headerHtml = headers.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('')
  const bodyHtml = rows.map((row) => {
    const cells = headers.map((_header, index) => `<td>${inlineMarkdown(row[index] ?? '')}</td>`).join('')
    return `<tr>${cells}</tr>`
  }).join('')
  return { html: `<table><thead><tr>${headerHtml}</tr></thead>${bodyHtml ? `<tbody>${bodyHtml}</tbody>` : ''}</table>`, next }
}

function renderList(lines: string[], start: number, ordered: boolean): { html: string; next: number } {
  const itemPattern = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/
  const items: string[] = []
  let next = start
  while (next < lines.length) {
    const match = itemPattern.exec(lines[next])
    if (!match) break
    const task = !ordered && /^\[([ xX])\]\s+/.exec(match[1])
    const content = task ? match[1].replace(/^\[([ xX])\]\s+/, '') : match[1]
    const checkbox = task ? `<input type="checkbox" disabled${task[1].toLowerCase() === 'x' ? ' checked' : ''} /> ` : ''
    items.push(`<li>${checkbox}${inlineMarkdown(content)}</li>`)
    next += 1
  }
  const tag = ordered ? 'ol' : 'ul'
  return { html: `<${tag}>${items.join('')}</${tag}>`, next }
}

export function renderAiMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = /^\s*(`{3,}|~{3,})\s*([^\s]*)/.exec(line)
    if (fence) {
      const marker = fence[1][0]
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !new RegExp(`^\\s*${marker}{${fence[1].length},}\\s*$`).test(lines[index])) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      const language = fence[2] ? ` class="language-${escapeHtml(fence[2])}"` : ''
      blocks.push(`<pre><code${language}>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
      continue
    }

    const heading = /^\s*(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading) {
      const level = heading[1].length
      blocks.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`)
      index += 1
      continue
    }

    if (index + 1 < lines.length && line.includes('|') && isTableSeparator(lines[index + 1])) {
      const table = renderTable(lines, index)
      blocks.push(table.html)
      index = table.next
      continue
    }

    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push('<hr />')
      index += 1
      continue
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const list = renderList(lines, index, false)
      blocks.push(list.html)
      index = list.next
      continue
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const list = renderList(lines, index, true)
      blocks.push(list.html)
      index = list.next
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ''))
        index += 1
      }
      blocks.push(`<blockquote>${inlineMarkdown(quoteLines.join('\n'))}</blockquote>`)
      continue
    }

    const paragraph: string[] = [line]
    index += 1
    while (index < lines.length && lines[index].trim() &&
      !/^\s*(?:`{3,}|~{3,})/.test(lines[index]) &&
      !/^\s*#{1,6}\s+/.test(lines[index]) &&
      !/^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s?)/.test(lines[index])) {
      paragraph.push(lines[index])
      index += 1
    }
    blocks.push(`<p>${inlineMarkdown(paragraph.join('\n')).replace(/\n/g, '<br />')}</p>`)
  }

  return blocks.join('')
}
