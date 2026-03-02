import { useEffect, useMemo, useState } from 'react'
import beautify from 'js-beautify'
import { highlightCode } from './highlight'
import './App.css'

const STORAGE_KEY = 'component-template-copier.templates.v1'

const DEFAULT_TEMPLATES = [
  {
    id: 'btn-primary',
    name: 'PrimaryButton',
    language: 'jsx',
    content: `import { PrimaryButton } from '@/components/shared/PrimaryButton'

export default function Example() {
  // Nhan vao de submit form
  const handleClick = () => {
    console.log('Submitted')
  }

  return (
    <PrimaryButton onClick={handleClick} size="lg">
      Submit form
    </PrimaryButton>
  )
}`,
  },
  {
    id: 'modal-basic',
    name: 'BasicModal',
    language: 'jsx',
    content: `import { BasicModal } from '@/components/shared/BasicModal'

export function Page() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button onClick={() => setOpen(true)}>Open modal</button>
      <BasicModal open={open} onClose={() => setOpen(false)}>
        {/* Noi dung modal */}
        <p>Hello world</p>
      </BasicModal>
    </>
  )
}`,
  },
  {
    id: 'table-config',
    name: 'TableConfigJson',
    language: 'json',
    content: `{
  "columns": [
    { "key": "name", "title": "Name" },
    { "key": "email", "title": "Email" }
  ],
  "pagination": true,
  "pageSize": 20
}`,
  },
]

function readTemplates() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_TEMPLATES

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_TEMPLATES

    return parsed.filter((item) => item && item.id && item.name && item.language && item.content)
  } catch {
    return DEFAULT_TEMPLATES
  }
}

const EMPTY_FORM = {
  name: '',
  language: 'jsx',
  content: '',
}

function normalizeTextWhitespace(content, trimBoundary = true) {
  const normalized = content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .join('\n')

  return trimBoundary ? normalized.trim() : normalized
}

const jsBeautify = beautify.js_beautify

export default function App() {
  const [templates, setTemplates] = useState(readTemplates)
  const [selectedId, setSelectedId] = useState(() => readTemplates()[0]?.id ?? null)
  const [editingId, setEditingId] = useState(undefined)
  const [form, setForm] = useState(EMPTY_FORM)
  const [isFormatting, setIsFormatting] = useState(false)
  const [autoFormatOnPaste, setAutoFormatOnPaste] = useState(true)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))

    if (!templates.some((item) => item.id === selectedId)) {
      setSelectedId(templates[0]?.id ?? null)
    }
  }, [templates, selectedId])

  const selectedTemplate = useMemo(
    () => templates.find((item) => item.id === selectedId) ?? null,
    [templates, selectedId],
  )

  const highlightedCode = useMemo(() => {
    if (!selectedTemplate) return ''
    return highlightCode(selectedTemplate.content, selectedTemplate.language)
  }, [selectedTemplate])

  const startCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  const startEdit = () => {
    if (!selectedTemplate) return
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
      const formatted = jsBeautify(content, {
        indent_char: ' ',
        indent_size: 2,
        preserve_newlines: true,
        max_preserve_newlines: 2,
        e4x: true,
        brace_style: 'collapse',
        wrap_line_length: 0,
        end_with_newline: false,
      })
      return trimBoundary ? formatted.trim() : formatted
    }

    if (language === 'json') {
      const parsed = JSON.parse(content)
      const formatted = JSON.stringify(parsed, null, 2)
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
      alert('Format that bai. Kiem tra lai noi dung va kieu du lieu.')
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

      // Re-format the whole editor content to keep indentation consistent after paste.
      const nextFormattedContent =
        form.language === 'jsx'
          ? await formatByLanguage(nextRawContent, form.language, false)
          : nextRawContent

      setForm((prev) => ({ ...prev, content: nextFormattedContent }))
    } catch {
      alert('Noi dung paste khong format duoc theo kieu du lieu hien tai.')
    } finally {
      setIsFormatting(false)
    }
  }

  const saveTemplate = (event) => {
    event.preventDefault()
    const nextName = form.name.trim()
    const nextContent = form.content.trim()

    if (!nextName || !nextContent) {
      alert('Ten va noi dung khong duoc de trong.')
      return
    }

    if (editingId === null) {
      const newId = `${Date.now()}`
      const newTemplate = {
        id: newId,
        name: nextName,
        language: form.language,
        content: form.content,
      }
      setTemplates((prev) => [newTemplate, ...prev])
      setSelectedId(newId)
    } else {
      setTemplates((prev) =>
        prev.map((item) =>
          item.id === editingId
            ? {
                ...item,
                name: nextName,
                language: form.language,
                content: form.content,
              }
            : item,
        ),
      )
    }

    clearEditor()
  }

  const removeSelected = () => {
    if (!selectedTemplate) return

    const ok = window.confirm(`Xoa template "${selectedTemplate.name}"?`)
    if (!ok) return

    setTemplates((prev) => prev.filter((item) => item.id !== selectedTemplate.id))
  }

  const copyCurrent = async () => {
    if (!selectedTemplate) return

    try {
      await navigator.clipboard.writeText(selectedTemplate.content)
      alert('Da copy template vao clipboard.')
    } catch {
      alert('Khong copy duoc. Trinh duyet dang chan clipboard.')
    }
  }

  const isEditing = editingId !== undefined
  const modeLabel = editingId === null ? 'Them template moi' : 'Sua template'

  return (
    <main className="app-shell">
      <aside className="left-panel">
        <div className="panel-header">
          <h2>Components</h2>
          <button type="button" onClick={startCreate} className="btn-primary">
            + Them
          </button>
        </div>

        <ul className="template-list">
          {templates.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`template-item ${item.id === selectedId ? 'active' : ''}`}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="name">{item.name}</span>
                <span className="lang">{item.language}</span>
              </button>
            </li>
          ))}
          {!templates.length && <p className="empty">Chua co template nao.</p>}
        </ul>
      </aside>

      <section className="right-panel">
        <div className="right-header">
          <div>
            <h1>{selectedTemplate?.name ?? 'Khong co template'}</h1>
            <p className="subtitle">Docs va template su dung component</p>
          </div>
          <div className="actions">
            <button type="button" onClick={copyCurrent} disabled={!selectedTemplate}>
              Copy
            </button>
            <button type="button" onClick={startEdit} disabled={!selectedTemplate}>
              Sua
            </button>
            <button type="button" onClick={removeSelected} disabled={!selectedTemplate} className="danger">
              Xoa
            </button>
          </div>
        </div>

        <div className="viewer">
          {selectedTemplate ? (
            <pre className="code-block">
              <code dangerouslySetInnerHTML={{ __html: highlightedCode }} />
            </pre>
          ) : (
            <p className="empty">Hay tao template moi de bat dau.</p>
          )}
        </div>

        {isEditing && (
          <form className="editor" onSubmit={saveTemplate}>
            <h3>{modeLabel}</h3>

            <label>
              Ten template
              <input
                type="text"
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Vi du: SearchBar"
              />
            </label>

            <label>
              Kieu noi dung
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
              Noi dung docs/template
              <textarea
                value={form.content}
                onChange={(event) => setForm((prev) => ({ ...prev, content: event.target.value }))}
                onPaste={handleContentPaste}
                rows={12}
                placeholder="Dan code template vao day..."
              />
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={autoFormatOnPaste}
                onChange={(event) => setAutoFormatOnPaste(event.target.checked)}
              />
              Tu format JS/JSX khi paste
            </label>

            <div className="editor-actions">
              <button type="button" onClick={formatFormContent} disabled={isFormatting}>
                {isFormatting ? 'Dang format...' : 'Format'}
              </button>
              <button type="button" onClick={clearEditor}>
                Huy
              </button>
              <button type="submit" className="btn-primary">
                Luu
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  )
}
