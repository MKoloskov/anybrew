import sanitizeHtml from 'sanitize-html';

// Rich text is stored as HTML. Everything that comes in, from the editor or from an import,
// passes through here, so stored text can be shown in the browser as it is.
// Kept: headings, bold/italic/underline/strike, lists, quotes, tables, links, line breaks.
// Dropped: scripts, styles, classes, ids, images and every other attribute.

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'blockquote', 'code', 'pre',
    'ul', 'ol', 'li', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  allowedAttributes: { a: ['href'], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  // Text pasted from Google Docs arrives as spans and divs; their content is kept, the wrappers go.
  transformTags: {
    div: 'p',
    b: 'strong',
    i: 'em',
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
  },
};

const FINAL: sanitizeHtml.IOptions = {
  ...OPTIONS,
  transformTags: {},
  allowedAttributes: { ...OPTIONS.allowedAttributes, a: ['href', 'rel', 'target'] },
};

export function cleanHtml(html: string): string {
  const cleaned = sanitizeHtml(sanitizeHtml(html, OPTIONS), FINAL)
    // Empty paragraphs used as spacing in pasted text.
    .replace(/<p>(\s|&nbsp;|<br\s*\/?>)*<\/p>/g, '')
    .trim();
  return cleaned;
}

/** Plain text of rich text, for search and for telling whether anything is written at all. */
export function htmlToText(html: string): string {
  return sanitizeHtml(html.replace(/<\/(p|h\d|li|tr|blockquote)>/g, '$&\n'), { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}
