import { useEffect, useMemo, useState } from 'react'
import { format as prettierFormat } from 'prettier/standalone'
import * as prettierPluginBabel from 'prettier/plugins/babel'
import * as prettierPluginEstree from 'prettier/plugins/estree'
import { highlightCode } from './highlight'
import './App.css'

const STORAGE_KEY = 'component-template-copier.templates.v1'
const API_BASE_URL = 'https://663484909bb0df2359a1be82.mockapi.io'
const TEMPLATE_API_URL = `${API_BASE_URL}/template-component`
const SUPPORTED_TYPES = ['jsx', 'json', 'text']
const REQUEST_WARNING = 'Tất cả các request bạn đang dùng là free nên hãy tiết kiệm nhé'

const EMPTY_FORM = {
  name: '',
  language: 'jsx',
  content: '',
}

function indicesToRanges(indices) {
  if (!indices.length) return []
  const ranges = []
  let start = indices[0]
  let prev = indices[0]

  for (let i = 1; i < indices.length; i += 1) {
    const current = indices[i]
    if (current === prev + 1) {
      prev = current
      continue
    }
    ranges.push({ start, end: prev + 1 })
    start = current
    prev = current
  }

  ranges.push({ start, end: prev + 1 })
  return ranges
}

function matchTemplateName(name, query) {
  const source = name.toLowerCase()
  const keyword = query.toLowerCase().trim()
  if (!keyword) return { ranges: [], score: 0 }

  const contiguousStart = source.indexOf(keyword)
  if (contiguousStart >= 0) {
    return {
      ranges: [{ start: contiguousStart, end: contiguousStart + keyword.length }],
      score: 1000 - contiguousStart,
    }
  }

  const indices = []
  let cursor = 0
  for (const char of keyword) {
    const foundIndex = source.indexOf(char, cursor)
    if (foundIndex < 0) return null
    indices.push(foundIndex)
    cursor = foundIndex + 1
  }

  const spread = indices[indices.length - 1] - indices[0]
  return {
    ranges: indicesToRanges(indices),
    score: 100 - spread,
  }
}

function normalizeType(type) {
  return SUPPORTED_TYPES.includes(type) ? type : 'text'
}

function normalizeTemplate(item) {
  if (!item || !item.id || !item.name) return null

  const language = normalizeType(item.language ?? item.type)
  const content = item.content ?? item.value

  if (typeof content !== 'string') return null

  return {
    id: String(item.id),
    name: String(item.name),
    language,
    content,
  }
}

function toApiPayload(template) {
  return {
    name: template.name,
    type: template.language,
    value: template.content,
  }
}

function normalizeTextWhitespace(content, trimBoundary = true) {
  const normalized = content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .join('\n')

  return trimBoundary ? normalized.trim() : normalized
}

function isPureJsxSnippet(content) {
  const trimmed = content.trim()
  return trimmed.startsWith('<') && trimmed.endsWith('>')
}

function isJsxCommentThenMarkup(content) {
  const trimmed = content.trim()
  return /^\{\/\*[\s\S]*?\*\/\}\s*</.test(trimmed)
}

function normalizeLeadingLineJsxComments(content) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const converted = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      converted.push(line)
      index += 1
      continue
    }

    if (trimmed.startsWith('//')) {
      const indent = line.match(/^\s*/)?.[0] ?? ''
      const comment = trimmed.slice(2).trim()
      converted.push(`${indent}{/* ${comment} */}`)
      index += 1
      continue
    }

    break
  }

  const rest = lines.slice(index).join('\n').trimStart()
  if (!rest.startsWith('<')) return content

  return [...converted, rest].filter(Boolean).join('\n')
}

function normalizeBrokenLeadingJsxComment(content) {
  const match = content.match(/^\s*\{\s*\/\*([\s\S]*?)\*\/\s*\}\s*;?\s*/)
  if (!match) return content

  const normalizedComment = `{/*${match[1]}*/}\n`
  return normalizedComment + content.slice(match[0].length).trimStart()
}

function extractWrappedJsx(formatted) {
  const match = formatted.match(/const __CODEX_TEMP__ = \(\n([\s\S]*?)\n\)\n?;?$/)
  return match ? match[1] : formatted
}

function extractWrappedJsxFragment(formatted) {
  const match = formatted.match(/const __CODEX_TEMP__ = \(\n<>\n([\s\S]*?)\n<\/>\n\)\n?;?$/)
  return match ? match[1] : formatted
}

function stripCommonIndent(content) {
  const lines = content.split('\n')
  const nonEmpty = lines.filter((line) => line.trim())
  if (!nonEmpty.length) return content

  const minIndent = Math.min(
    ...nonEmpty.map((line) => {
      const match = line.match(/^ */)
      return match ? match[0].length : 0
    }),
  )

  if (!minIndent) return content
  return lines.map((line) => line.slice(minIndent)).join('\n')
}

function readTemplates() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    const normalized = parsed.map(normalizeTemplate).filter(Boolean)
    return normalized
  } catch {
    return []
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return response.json()
}

export default function App() {
  const [templates, setTemplates] = useState(readTemplates)
  const [selectedId, setSelectedId] = useState(() => readTemplates()[0]?.id ?? null)
  const [editingId, setEditingId] = useState(undefined)
  const [form, setForm] = useState(EMPTY_FORM)
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [isFormatting, setIsFormatting] = useState(false)
  const [autoFormatOnPaste, setAutoFormatOnPaste] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))

    if (!templates.some((item) => item.id === selectedId)) {
      setSelectedId(templates[0]?.id ?? null)
    }
  }, [templates, selectedId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput)
    }, 300)

    return () => window.clearTimeout(timer)
  }, [searchInput])

  const selectedTemplate = useMemo(
    () => templates.find((item) => item.id === selectedId) ?? null,
    [templates, selectedId],
  )

  const filteredTemplates = useMemo(() => {
    const keyword = debouncedSearch.trim()
    if (!keyword) return templates.map((item) => ({ ...item, highlightRanges: [] }))

    return templates
      .map((item) => {
        const match = matchTemplateName(item.name, keyword)
        if (!match) return null
        return {
          ...item,
          highlightRanges: match.ranges,
          _score: match.score,
        }
      })
      .filter(Boolean)
      .sort((a, b) => b._score - a._score)
  }, [templates, debouncedSearch])

  const highlightedCode = useMemo(() => {
    if (!selectedTemplate) return ''
    return highlightCode(selectedTemplate.content, selectedTemplate.language)
  }, [selectedTemplate])

  const renderHighlightedName = (name, ranges) => {
    if (!ranges.length) return name

    const nodes = []
    let cursor = 0

    ranges.forEach((range, index) => {
      if (cursor < range.start) {
        nodes.push(<span key={`plain-${index}-${cursor}`}>{name.slice(cursor, range.start)}</span>)
      }
      nodes.push(
        <span key={`match-${index}-${range.start}`} className="name-highlight">
          {name.slice(range.start, range.end)}
        </span>,
      )
      cursor = range.end
    })

    if (cursor < name.length) {
      nodes.push(<span key={`plain-tail-${cursor}`}>{name.slice(cursor)}</span>)
    }

    return nodes
  }

  const startCreate = () => {
    const ok = window.confirm(`Add template?\n\n${REQUEST_WARNING}`)
    if (!ok) return

    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  const startEdit = () => {
    if (!selectedTemplate) return

    const ok = window.confirm(`Edit template "${selectedTemplate.name}"?\n\n${REQUEST_WARNING}`)
    if (!ok) return

    setEditingId(selectedTemplate.id)
    setForm({
      name: selectedTemplate.name,
      language: selectedTemplate.language,
      content: selectedTemplate.content,
    })
  }

  const clearEditor = () => {
    setEditingId(undefined)
    setForm(EMPTY_FORM)
  }

  const formatByLanguage = async (content, language, trimBoundary = true) => {
    if (language === 'jsx') {
      const normalizedInput = normalizeLeadingLineJsxComments(
        normalizeBrokenLeadingJsxComment(content),
      )
      const wrapAsFragment = isJsxCommentThenMarkup(normalizedInput)
      const wrapAsSingleJsx = isPureJsxSnippet(normalizedInput)

      const source = wrapAsFragment
        ? `const __CODEX_TEMP__ = (\n<>\n${normalizedInput.trim()}\n</>\n)\n`
        : wrapAsSingleJsx
          ? `const __CODEX_TEMP__ = (\n${normalizedInput.trim()}\n)\n`
          : normalizedInput

      const formatted = await prettierFormat(source, {
        parser: 'babel',
        plugins: [prettierPluginBabel, prettierPluginEstree],
        semi: false,
        singleQuote: true,
        tabWidth: 2,
        trailingComma: 'es5',
        printWidth: 100,
      })

      const result = wrapAsFragment
        ? stripCommonIndent(extractWrappedJsxFragment(formatted))
        : wrapAsSingleJsx
          ? stripCommonIndent(extractWrappedJsx(formatted))
          : formatted
      return trimBoundary ? result.trim() : result
    }

    if (language === 'json') {
      const formatted = await prettierFormat(content, {
        parser: 'json',
        plugins: [prettierPluginBabel, prettierPluginEstree],
        tabWidth: 2,
      })
      return trimBoundary ? formatted.trim() : formatted
    }

    return normalizeTextWhitespace(content, trimBoundary)
  }

  const formatFormContent = async () => {
    if (!form.content.trim()) return

    try {
      setIsFormatting(true)
      const formatted = await formatByLanguage(form.content, form.language)
      setForm((prev) => ({ ...prev, content: formatted }))
    } catch {
      alert('Format failed. Please check the content and selected type.')
    } finally {
      setIsFormatting(false)
    }
  }

  const handleContentPaste = async (event) => {
    if (!autoFormatOnPaste) return

    const pasted = event.clipboardData.getData('text')
    if (!pasted) return

    event.preventDefault()

    const { selectionStart, selectionEnd } = event.currentTarget

    try {
      setIsFormatting(true)
      const nextRawContent =
        form.content.slice(0, selectionStart) + pasted + form.content.slice(selectionEnd)

      const shouldAutoFormat = form.language === 'jsx'
      const nextFormattedContent = shouldAutoFormat
        ? await formatByLanguage(nextRawContent, form.language, false)
        : nextRawContent

      setForm((prev) => ({ ...prev, content: nextFormattedContent }))
    } catch {
      alert('Cannot format pasted content with the current type.')
    } finally {
      setIsFormatting(false)
    }
  }

  const refetchTemplates = async () => {
    try {
      setIsSyncing(true)
      const serverList = await requestJson(TEMPLATE_API_URL)
      const normalized = Array.isArray(serverList) ? serverList.map(normalizeTemplate).filter(Boolean) : []

      setTemplates(normalized)
      setSelectedId(normalized[0]?.id ?? null)
      alert('Latest templates were fetched from the server.')
    } catch {
      alert('Refetch failed. Could not load data from server.')
    } finally {
      setIsSyncing(false)
    }
  }

  const saveTemplate = async (event) => {
    event.preventDefault()
    const nextName = form.name.trim()
    const nextContent = form.content.trim()

    if (!nextName || !nextContent) {
      alert('Name and content are required.')
      return
    }

    const candidateTemplate = {
      id: editingId ?? '',
      name: nextName,
      language: form.language,
      content: form.content,
    }

    try {
      setIsSyncing(true)

      if (editingId === null) {
        const created = await requestJson(TEMPLATE_API_URL, {
          method: 'POST',
          body: JSON.stringify(toApiPayload(candidateTemplate)),
        })

        const normalized = normalizeTemplate(created)
        if (!normalized) throw new Error('Invalid create response')

        setTemplates((prev) => [normalized, ...prev])
        setSelectedId(normalized.id)
      } else {
        const updated = await requestJson(`${TEMPLATE_API_URL}/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(toApiPayload(candidateTemplate)),
        })

        const normalized = normalizeTemplate(updated)
        if (!normalized) throw new Error('Invalid update response')

        setTemplates((prev) =>
          prev.map((item) =>
            item.id === editingId
              ? {
                  ...item,
                  ...normalized,
                }
              : item,
          ),
        )
      }

      clearEditor()
    } catch {
      alert('Save failed. Could not sync with server.')
    } finally {
      setIsSyncing(false)
    }
  }

  const removeSelected = async () => {
    if (!selectedTemplate) return

    const ok = window.confirm(`Delete template "${selectedTemplate.name}"?\n\n${REQUEST_WARNING}`)
    if (!ok) return

    try {
      setIsSyncing(true)
      await requestJson(`${TEMPLATE_API_URL}/${selectedTemplate.id}`, {
        method: 'DELETE',
      })

      setTemplates((prev) => prev.filter((item) => item.id !== selectedTemplate.id))
    } catch {
      alert('Delete failed. Could not sync with server.')
    } finally {
      setIsSyncing(false)
    }
  }

  const copyCurrent = async () => {
    if (!selectedTemplate) return

    try {
      await navigator.clipboard.writeText(selectedTemplate.content)
      alert('Template copied to clipboard.')
    } catch {
      alert('Copy failed. Clipboard access is blocked.')
    }
  }

  const isEditing = editingId !== undefined
  const modeLabel = editingId === null ? 'Add New Template' : 'Edit Template'

  return (
    <main className="app-shell">
      <aside className="left-panel">
        <div className="panel-header">
          <div className="panel-top">
            <h2>Components</h2>
            <div className="panel-actions">
              <button type="button" onClick={refetchTemplates} disabled={isSyncing}>
                {isSyncing ? 'Loading...' : 'Refetch'}
              </button>
              <button type="button" onClick={startCreate} className="btn-primary">
                + Add
              </button>
            </div>
          </div>
          <div className="search-row">
            <input
              type="text"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search component..."
            />
            <button type="button" onClick={() => setSearchInput('')} disabled={!searchInput} className="clear-btn">
              Clear
            </button>
          </div>
        </div>

        <ul className="template-list">
          {filteredTemplates.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`template-item ${item.id === selectedId ? 'active' : ''}`}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="name">{renderHighlightedName(item.name, item.highlightRanges)}</span>
                <span className="lang">{item.language}</span>
              </button>
            </li>
          ))}
          {!templates.length && <p className="empty">No templates yet.</p>}
          {!!templates.length && !filteredTemplates.length && <p className="empty">No matched components.</p>}
        </ul>
      </aside>

      <section className="right-panel">
        <div className="right-header">
          <div>
            <h1>{selectedTemplate?.name ?? 'No template selected'}</h1>
            <p className="subtitle">Component docs and usage template</p>
          </div>
          <div className="actions">
            <button type="button" onClick={copyCurrent} disabled={!selectedTemplate}>
              Copy
            </button>
            <button type="button" onClick={startEdit} disabled={!selectedTemplate || isSyncing}>
              Edit
            </button>
            <button
              type="button"
              onClick={removeSelected}
              disabled={!selectedTemplate || isSyncing}
              className="danger"
            >
              Delete
            </button>
          </div>
        </div>

        <div className="viewer">
          {selectedTemplate ? (
            <pre className="code-block">
              <code dangerouslySetInnerHTML={{ __html: highlightedCode }} />
            </pre>
          ) : (
            <p className="empty">Create a new template to get started.</p>
          )}
        </div>

        {isEditing && (
          <form className="editor" onSubmit={saveTemplate}>
            <h3>{modeLabel}</h3>

            <label>
              Template Name
              <input
                type="text"
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Example: SearchBar"
              />
            </label>

            <label>
              Content Type
              <select
                value={form.language}
                onChange={(event) => setForm((prev) => ({ ...prev, language: event.target.value }))}
              >
                <option value="jsx">JS / JSX</option>
                <option value="json">JSON</option>
                <option value="text">Text / String</option>
              </select>
            </label>

            <label>
              Docs/Template Content
              <textarea
                value={form.content}
                onChange={(event) => setForm((prev) => ({ ...prev, content: event.target.value }))}
                onPaste={handleContentPaste}
                rows={12}
                placeholder="Paste your template code here..."
              />
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={autoFormatOnPaste}
                onChange={(event) => setAutoFormatOnPaste(event.target.checked)}
              />
              Auto format JS/JSX on paste
            </label>

            <div className="editor-actions">
              <button type="button" onClick={formatFormContent} disabled={isFormatting || isSyncing}>
                {isFormatting ? 'Formatting...' : 'Format'}
              </button>
              <button type="button" onClick={clearEditor} disabled={isSyncing}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={isSyncing}>
                {isSyncing ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  )
}
