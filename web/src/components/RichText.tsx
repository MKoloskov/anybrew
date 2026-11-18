import { TableKit } from '@tiptap/extension-table';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect } from 'react';

/** Formatted text as stored. The server has already removed everything but plain formatting. */
export function RichTextView({ html }: { html: string }) {
  return <div className="rich" dangerouslySetInnerHTML={{ __html: html }} />;
}

type Props = {
  value: string;
  disabled: boolean;
  label: string;
  onSave: (html: string | null) => void;
  /** Called on every change, for a text that is sent with a button instead of saved on leaving (request messages). */
  onChange?: (html: string) => void;
};

/** An editor for formatted text. It saves when the cursor leaves it, like the other fields. */
export function RichTextEditor({ value, disabled, label, onSave, onChange }: Props) {
  const editor = useEditor({
    extensions: [StarterKit, TableKit.configure({ table: { resizable: false } })],
    content: value,
    editable: !disabled,
    editorProps: { attributes: { class: 'rich min-h-24 px-3 py-2 outline-none', 'aria-label': label, role: 'textbox' } },
    onUpdate: ({ editor: e }) => onChange?.(e.isEmpty ? '' : e.getHTML()),
    onBlur: ({ editor: e }) => {
      const html = e.isEmpty ? '' : e.getHTML();
      if (html !== value) onSave(html === '' ? null : html);
    },
  });

  // Someone else's edit arrives through the regular refresh; show it unless this editor is being typed in.
  useEffect(() => {
    if (editor && !editor.isFocused && editor.getHTML() !== value && !(editor.isEmpty && value === ''))
      editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  if (!editor) return null;
  if (disabled) return value ? <RichTextView html={value} /> : <p className="text-sm text-muted">–</p>;

  const button = (name: string, title: string, active: boolean, run: () => void) => (
    <button
      type="button"
      title={title}
      // Keeps the cursor in the text, so pressing a button does not count as leaving the field.
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      className={`rounded px-2 py-0.5 text-xs font-medium ${active ? 'bg-accent text-accent-ink' : 'hover:bg-surface-2'}`}
    >
      {name}
    </button>
  );
  const chain = () => editor.chain().focus();
  return (
    <div className="rounded-md border border-line bg-surface focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
      <div className="flex flex-wrap gap-0.5 border-b border-line px-1 py-1">
        {button('B', 'Bold', editor.isActive('bold'), () => chain().toggleBold().run())}
        {button('I', 'Italic', editor.isActive('italic'), () => chain().toggleItalic().run())}
        {button('H2', 'Heading', editor.isActive('heading', { level: 2 }), () => chain().toggleHeading({ level: 2 }).run())}
        {button('H3', 'Smaller heading', editor.isActive('heading', { level: 3 }), () => chain().toggleHeading({ level: 3 }).run())}
        {button('• List', 'Bullet list', editor.isActive('bulletList'), () => chain().toggleBulletList().run())}
        {button('1. List', 'Numbered list', editor.isActive('orderedList'), () => chain().toggleOrderedList().run())}
        {button('Quote', 'Quote', editor.isActive('blockquote'), () => chain().toggleBlockquote().run())}
        {button('Table', 'Insert a table', false, () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
        {editor.isActive('table') && (
          <>
            {button('+ Row', 'Add a row below', false, () => chain().addRowAfter().run())}
            {button('+ Column', 'Add a column to the right', false, () => chain().addColumnAfter().run())}
            {button('− Row', 'Remove this row', false, () => chain().deleteRow().run())}
            {button('− Column', 'Remove this column', false, () => chain().deleteColumn().run())}
          </>
        )}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
