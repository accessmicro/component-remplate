const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * Escapes HTML special characters to prevent XSS attacks and ensure proper rendering.
 * 
 * @param {string} text - The text to escape
 * @returns {string} The escaped text with HTML entities
 * @example
 * escapeHtml('<div>Hello "world"</div>') // '&lt;div&gt;Hello &quot;world&quot;&lt;/div&gt;'
 */
export function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char])
}

/**
 * Internal helper function that applies syntax highlighting rules to source code.
 * 
 * @param {string} source - The source code to highlight
 * @param {RegExp} regex - Regular expression to match tokens (must have global flag)
 * @param {function} tokenClass - Function that takes a matched value and returns the CSS class name
 * @returns {string} HTML string with syntax highlighting applied
 * @private
 */
function highlightWithRules(source, regex, tokenClass) {
  let result = ''
  let lastIndex = 0
  let match

  while ((match = regex.exec(source)) !== null) {
    const [value] = match
    const index = match.index

    result += escapeHtml(source.slice(lastIndex, index))
    result += `<span class="token ${tokenClass(value)}">${escapeHtml(value)}</span>`
    lastIndex = index + value.length
  }

  result += escapeHtml(source.slice(lastIndex))
  return result
}

/**
 * Highlights code with syntax highlighting based on the specified language.
 * 
 * @param {string} code - The source code to highlight
 * @param {string} language - The programming language ('json', 'text', or any other for JavaScript-like syntax)
 * @returns {string} HTML string with syntax highlighting markup
 * 
 * @example
 * // Highlight JSON
 * highlightCode('{"key": "value"}', 'json')
 * 
 * @example
 * // Highlight JavaScript/JSX
 * highlightCode('const x = () => <div>Hello</div>', 'javascript')
 * 
 * @example
 * // Plain text (just escapes HTML)
 * highlightCode('<script>alert("hi")</script>', 'text')
 */
export function highlightCode(code, language) {
  if (language === 'json') {
    const regex = /("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|-?\b\d+(?:\.\d+)?\b|\btrue\b|\bfalse\b|\bnull\b|[{}\[\],:])/g
    return highlightWithRules(code, regex, (value) => {
      if (/^"(?:\\.|[^"\\])*"\s*:$/.test(value)) return 'key'
      if (/^"/.test(value)) return 'string'
      if (/^-?\d/.test(value)) return 'number'
      if (/^(true|false|null)$/.test(value)) return 'keyword'
      return 'symbol'
    })
  }

  if (language === 'text') {
    return escapeHtml(code)
  }

  const regex = /(\/\/.*$|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:import|from|return|const|let|var|function|export|default|if|else|for|while|new|class|extends|async|await|try|catch|finally|switch|case|break|continue|null|true|false)\b|<\/?[A-Za-z][\w.-]*|[{}()[\],.:=])/gm

  return highlightWithRules(code, regex, (value) => {
    if (/^\/\//.test(value) || /^\/\*/.test(value)) return 'comment'
    if (/^['"`]/.test(value)) return 'string'
    if (/^<\/?[A-Za-z]/.test(value)) return 'component'
    if (/^[{}()[\],.:=]$/.test(value)) return 'symbol'
    return 'keyword'
  })
}
