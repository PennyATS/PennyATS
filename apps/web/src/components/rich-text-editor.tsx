"use client";

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useRef, useState } from "react";
import { MERGE_FIELDS } from "@/lib/merge-fields";

/** Accept "example.com", "https://…", or an email address; return a safe href or null. */
function normalizeHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(value)) return `mailto:${value}`;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? withScheme : null;
  } catch {
    return null;
  }
}

function ToolButton({ label, shortcut, active, disabled, onClick, children }: {
  label: string; shortcut?: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button type="button" className="rte-btn" aria-label={label} title={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={active === undefined ? undefined : active} disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  );
}

function Toolbar({ editor, onLink }: { editor: Editor; onLink: () => void }) {
  const chain = () => editor.chain().focus();
  return (
    <div className="rte-toolbar" role="toolbar" aria-label="Formatting">
      <ToolButton label="Bold" shortcut="Ctrl+B" active={editor.isActive("bold")} onClick={() => chain().toggleBold().run()}><strong>B</strong></ToolButton>
      <ToolButton label="Italic" shortcut="Ctrl+I" active={editor.isActive("italic")} onClick={() => chain().toggleItalic().run()}><em className="font-serif">I</em></ToolButton>
      <ToolButton label="Underline" shortcut="Ctrl+U" active={editor.isActive("underline")} onClick={() => chain().toggleUnderline().run()}><span className="underline">U</span></ToolButton>
      <ToolButton label="Strikethrough" active={editor.isActive("strike")} onClick={() => chain().toggleStrike().run()}><span className="line-through">S</span></ToolButton>
      <span className="rte-sep" aria-hidden="true" />
      <ToolButton label="Heading" active={editor.isActive("heading", { level: 2 })} onClick={() => chain().toggleHeading({ level: 2 }).run()}>H2</ToolButton>
      <ToolButton label="Subheading" active={editor.isActive("heading", { level: 3 })} onClick={() => chain().toggleHeading({ level: 3 }).run()}>H3</ToolButton>
      <span className="rte-sep" aria-hidden="true" />
      <ToolButton label="Bulleted list" active={editor.isActive("bulletList")} onClick={() => chain().toggleBulletList().run()}>• List</ToolButton>
      <ToolButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => chain().toggleOrderedList().run()}>1. List</ToolButton>
      <ToolButton label="Quote" active={editor.isActive("blockquote")} onClick={() => chain().toggleBlockquote().run()}>“ ”</ToolButton>
      <ToolButton label="Divider" onClick={() => chain().setHorizontalRule().run()}>―</ToolButton>
      <span className="rte-sep" aria-hidden="true" />
      <ToolButton label={editor.isActive("link") ? "Edit link" : "Add link"} shortcut="Ctrl+K" active={editor.isActive("link")} onClick={onLink}>Link</ToolButton>
      <ToolButton label="Remove link" disabled={!editor.isActive("link")} onClick={() => chain().extendMarkRange("link").unsetLink().run()}>Unlink</ToolButton>
      <span className="rte-sep" aria-hidden="true" />
      <ToolButton label="Undo" shortcut="Ctrl+Z" disabled={!editor.can().undo()} onClick={() => chain().undo().run()}>↶</ToolButton>
      <ToolButton label="Redo" shortcut="Ctrl+Shift+Z" disabled={!editor.can().redo()} onClick={() => chain().redo().run()}>↷</ToolButton>
      <span className="rte-sep" aria-hidden="true" />
      <label className="sr-only" htmlFor="rte-merge">Insert merge field</label>
      <select id="rte-merge" className="input h-8 w-auto py-0 text-xs" value=""
        onChange={(e) => { if (e.target.value) chain().insertContent(`{{${e.target.value}}}`).run(); }}>
        <option value="">Insert field…</option>
        {MERGE_FIELDS.map((f) => <option key={f.token} value={f.token}>{f.label}</option>)}
      </select>
    </div>
  );
}

/**
 * Rich text editor for email templates (Tiptap). Writes its HTML to a hidden input named
 * `name`; the server sanitizes it before storing, so nothing here is trusted.
 */
export function RichTextEditor({ name, defaultHtml, labelledBy }: { name: string; defaultHtml: string; labelledBy: string }) {
  const [html, setHtml] = useState(defaultHtml);
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  // The editor's key handler is created once; keep it pointed at the latest openLink.
  const openLinkRef = useRef<() => void>(() => {});

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        codeBlock: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: "https", protocols: ["mailto"] },
      }),
    ],
    content: defaultHtml,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { class: "rich-text", "aria-labelledby": labelledBy, "aria-multiline": "true", role: "textbox" },
      handleKeyDown: (_view, event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
          event.preventDefault();
          openLinkRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => setHtml(editor.isEmpty ? "" : editor.getHTML()),
  });

  openLinkRef.current = openLink;
  function openLink() {
    if (!editor) return;
    setHref((editor.getAttributes("link").href as string | undefined) ?? "");
    setLinkError(null);
    setLinkOpen(true);
  }

  function applyLink() {
    if (!editor) return;
    const safe = normalizeHref(href);
    if (!safe) { setLinkError("Enter a web address or an email address."); return; }
    const chain = editor.chain().focus().extendMarkRange("link");
    if (editor.state.selection.empty && !editor.isActive("link")) {
      chain.insertContent({ type: "text", text: href.trim(), marks: [{ type: "link", attrs: { href: safe } }] }).run();
    } else {
      chain.setLink({ href: safe }).run();
    }
    setLinkOpen(false);
  }

  return (
    <div className="rte">
      <input type="hidden" name={name} value={html} />
      {editor ? <Toolbar editor={editor} onLink={openLink} /> : <div className="rte-toolbar h-[45px]" aria-hidden="true" />}
      {linkOpen && (
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
          <label htmlFor="rte-link" className="font-medium">Link to</label>
          <input id="rte-link" className="input h-8 max-w-sm flex-1 py-1" value={href} autoFocus
            placeholder="https://example.com or name@example.com" onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); applyLink(); }
              if (e.key === "Escape") { e.preventDefault(); setLinkOpen(false); editor?.commands.focus(); }
            }} />
          <button type="button" className="btn h-8 min-h-0 py-0" onClick={applyLink}>Apply</button>
          <button type="button" className="btn btn-secondary h-8 min-h-0 py-0" onClick={() => { setLinkOpen(false); editor?.commands.focus(); }}>Cancel</button>
          {linkError && <p role="alert" className="error w-full text-xs">{linkError}</p>}
        </div>
      )}
      <EditorContent editor={editor} className="rte-content" />
    </div>
  );
}
