import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import python from 'highlight.js/lib/languages/python'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import { escapeHtml } from '@/utils/html'

const AUTO_DETECT_LANGUAGES = ['sql', 'kotlin', 'java', 'go', 'bash', 'typescript', 'javascript', 'python', 'json']
const MIN_AUTO_DETECT_RELEVANCE = 3
const TRAILING_JSON_PROMPT_MARKER = /([}\]])%$/
const SHELL_COMMAND_START = /^(?:[$#>]\s*)?(?:curl|wget|http|git|docker|kubectl|helm|npm|pnpm|yarn|node|npx|go|python|python3|pip|pip3|ssh|scp|rsync|make|cmake|cargo|java|mvn|gradle|grep|rg|sed|awk|jq|cat|less|tail|head|echo|printf|cd|ls|cp|mv|rm|mkdir|chmod|chown|sudo|env|export|\.[/]|[/][\w./-]+)(?:\s|$)/

const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  bash: 'Shell',
  go: 'Go',
  java: 'Java',
  javascript: 'JavaScript',
  json: 'JSON',
  kotlin: 'Kotlin',
  python: 'Python',
  sql: 'SQL',
  typescript: 'TypeScript',
}

const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  postgres: 'sql',
  postgresql: 'sql',
  psql: 'sql',
  sh: 'bash',
  shell: 'bash',
  ts: 'typescript',
  zsh: 'bash',
}

export interface HighlightedCode {
  html: string
  language: string
  languageClass: string
  displayName: string
}

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('go', go)
hljs.registerLanguage('java', java)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('kotlin', kotlin)
hljs.registerLanguage('python', python)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('typescript', typescript)

for (const [alias, languageName] of Object.entries(LANGUAGE_ALIASES)) {
  hljs.registerAliases([alias], { languageName })
}

function normalizeLanguage(input: string | null | undefined): string {
  const [language = ''] = (input ?? '').trim().toLowerCase().split(/\s+/)
  return language
}

function canonicalLanguage(input: string | null | undefined): string {
  const normalized = normalizeLanguage(input)
  if (!normalized) return ''

  const canonical = LANGUAGE_ALIASES[normalized] ?? normalized
  return hljs.getLanguage(canonical) ? canonical : ''
}

function languageClassName(language: string): string {
  return language === 'bash' ? 'shell' : language
}

function buildHighlightedCode(html: string, language: string): HighlightedCode {
  return {
    html,
    language,
    languageClass: language ? languageClassName(language) : '',
    displayName: LANGUAGE_DISPLAY_NAMES[language] ?? '',
  }
}

function normalizeJsonCandidate(code: string): string {
  return code.trim().replace(TRAILING_JSON_PROMPT_MARKER, '$1').trimEnd()
}

function looksLikeJson(code: string): boolean {
  const candidate = normalizeJsonCandidate(code)
  if (!candidate || !/^[{[]/.test(candidate) || !/[}\]]$/.test(candidate)) return false

  try {
    JSON.parse(candidate)
    return true
  } catch {
    return false
  }
}

function looksLikeShell(code: string): boolean {
  const trimmed = code.trim()
  if (!trimmed) return false
  if (SHELL_COMMAND_START.test(trimmed)) return true

  const lines = trimmed.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length < 2) return false

  const hasContinuation = lines.some(line => line.endsWith('\\'))
  const hasCliOptionLine = lines.some(line => /^--?[\w-]+(?:\s|=|$)/.test(line))
  return hasContinuation && hasCliOptionLine
}

function heuristicLanguage(code: string): string {
  if (looksLikeJson(code)) return 'json'
  if (looksLikeShell(code)) return 'bash'
  return ''
}

function renderCodeBlock(highlighted: HighlightedCode): string {
  const className = ['markdown-code-block', highlighted.languageClass ? `language-${highlighted.languageClass}` : '']
    .filter(Boolean)
    .join(' ')
  const codeClassName = ['hljs', highlighted.languageClass ? `language-${highlighted.languageClass}` : '']
    .filter(Boolean)
    .join(' ')
  const dataLanguage = highlighted.displayName ? ` data-language="${escapeHtml(highlighted.displayName)}"` : ''

  return `<pre class="${className}"${dataLanguage}><code class="${codeClassName}">${highlighted.html}</code></pre>`
}

export function highlightCodeForDisplay(code: string, language: string | null | undefined = ''): HighlightedCode {
  const explicitLanguage = canonicalLanguage(language)

  if (explicitLanguage) {
    try {
      const result = hljs.highlight(code, {
        language: explicitLanguage,
        ignoreIllegals: true,
      })
      return buildHighlightedCode(result.value, explicitLanguage)
    } catch {
      return buildHighlightedCode(escapeHtml(code), '')
    }
  }

  const heuristic = heuristicLanguage(code)
  if (heuristic) {
    try {
      const result = hljs.highlight(code, {
        language: heuristic,
        ignoreIllegals: true,
      })
      return buildHighlightedCode(result.value, heuristic)
    } catch {
      return buildHighlightedCode(escapeHtml(code), '')
    }
  }

  try {
    const result = hljs.highlightAuto(code, AUTO_DETECT_LANGUAGES)
    const detectedLanguage = canonicalLanguage(result.language)
    if (detectedLanguage && result.relevance >= MIN_AUTO_DETECT_RELEVANCE) {
      return buildHighlightedCode(result.value, detectedLanguage)
    }
  } catch {
    // Fall through to escaped plain code.
  }

  return buildHighlightedCode(escapeHtml(code), '')
}

export function highlightCodeToHtml(code: string, language: string | null | undefined = ''): string {
  return renderCodeBlock(highlightCodeForDisplay(code, language))
}
