"use client";
import { useLanguage } from "./language";

import { useState, useRef } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Link2,
  Unlink,
  Undo2,
  Redo2,
  Code2,
  Eye,
  Pilcrow,
  Quote,
  Minus,
  Pencil,
} from "lucide-react";
import { textToLegalHtml, type LegalFormat } from "@/src/core/legal-content";
import { api } from "./api-client";

export function LegalEditor({
  content,
  format = "text",
  title,
  onContentChange,
  documentLocale,
}: {
  content: string;
  format?: LegalFormat;
  title: string;
  onContentChange?: (html: string) => void;
  documentLocale?: "de" | "en";
}) {
  const { ui, localeTag, locale } = useLanguage();

  const onChangeRef = useRef(onContentChange);
  onChangeRef.current = onContentChange;
  const [html, setHtml] = useState(() =>
    format === "html" ? content : textToLegalHtml(content),
  );
  const [mode, setMode] = useState<"edit" | "html" | "preview">("edit");
  const [preview, setPreview] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        link: {
          openOnClick: false,
          protocols: ["mailto", "tel"],
          HTMLAttributes: {
            target: "_blank",
            rel: "noopener noreferrer nofollow",
          },
        },
      }),
    ],
    content: html,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": ui("Inhalt: {0}", [title]),
        class: "legal-editor-document legal-richtext",
      },
    },
    onUpdate: ({ editor: current }) => {
      const value = current.getHTML();
      setHtml(value);
      onChangeRef.current?.(value);
    },
  });
  const selection = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive("bold") ?? false,
      italic: current?.isActive("italic") ?? false,
      underline: current?.isActive("underline") ?? false,
      list: current?.isActive("bulletList") ?? false,
      ordered: current?.isActive("orderedList") ?? false,
      quote: current?.isActive("blockquote") ?? false,
      heading:
        [2, 3, 4].find((level) => current?.isActive("heading", { level })) ?? 0,
      undo: current?.can().undo() ?? false,
      redo: current?.can().redo() ?? false,
    }),
  });

  async function changeMode(next: typeof mode) {
    setError("");
    setLink(null);
    if (next === "preview") {
      setLoading(true);
      try {
        const result = await api<{ html: string }>("admin/legal-preview", {
          content: html,
          format: "html",
          locale: documentLocale ?? locale,
        });
        setPreview(result.html);
        setMode(next);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    } else {
      if (next === "edit" && mode !== "edit") {
        editor?.commands.setContent(html);
        if (editor) {
          const value = editor.getHTML();
          setHtml(value);
          onChangeRef.current?.(value);
        }
      }
      setMode(next);
    }
  }

  function applyLink() {
    if (link && !/^(https?:\/\/|mailto:|tel:)/i.test(link.trim())) {
      setError(
        ui(
          "Bitte eine https://-, http://-, mailto:- oder tel:-Adresse angeben.",
        ),
      );
      return;
    }
    if (link?.trim())
      editor
        ?.chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: link.trim() })
        .run();
    else editor?.chain().focus().extendMarkRange("link").unsetLink().run();
    setLink(null);
    setError("");
  }

  return (
    <div className="legal-editor">
      <input type="hidden" name="content" value={html} />
      <input type="hidden" name="format" value="html" />
      <div
        className="legal-editor-tabs"
        role="group"
        aria-label={ui("Ansicht für {0}", [title])}
      >
        {(
          [
            ["edit", ui("Bearbeiten"), Pencil],
            ["html", "HTML", Code2],
            ["preview", ui("Vorschau"), Eye],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => void changeMode(value)}
            disabled={loading}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
        <small>
          {loading ? ui("Vorschau wird geladen …") : "Richtext & HTML"}
        </small>
      </div>
      {mode === "edit" && (
        <>
          <div
            className="legal-editor-toolbar"
            role="group"
            aria-label={ui("Formatierung für {0}", [title])}
          >
            <select
              aria-label={ui("Absatzformat für {0}", [title])}
              value={selection?.heading ?? 0}
              disabled={!editor}
              onChange={(event) => {
                const level = Number(event.target.value);
                if (level)
                  editor
                    ?.chain()
                    .focus()
                    .setHeading({ level: level as 2 | 3 | 4 })
                    .run();
                else editor?.chain().focus().setParagraph().run();
              }}
            >
              <option value={0}>{ui("Absatz")}</option>
              <option value={2}>{ui("Überschrift 2")}</option>
              <option value={3}>{ui("Überschrift 3")}</option>
              <option value={4}>{ui("Überschrift 4")}</option>
            </select>
            {(
              [
                [
                  ui("Fett"),
                  Bold,
                  selection?.bold,
                  () => editor?.chain().focus().toggleBold().run(),
                ],
                [
                  ui("Kursiv"),
                  Italic,
                  selection?.italic,
                  () => editor?.chain().focus().toggleItalic().run(),
                ],
                [
                  ui("Unterstrichen"),
                  Underline,
                  selection?.underline,
                  () => editor?.chain().focus().toggleUnderline().run(),
                ],
                [
                  ui("Aufzählung"),
                  List,
                  selection?.list,
                  () => editor?.chain().focus().toggleBulletList().run(),
                ],
                [
                  ui("Nummerierte Liste"),
                  ListOrdered,
                  selection?.ordered,
                  () => editor?.chain().focus().toggleOrderedList().run(),
                ],
                [
                  ui("Zitat"),
                  Quote,
                  selection?.quote,
                  () => editor?.chain().focus().toggleBlockquote().run(),
                ],
                [
                  ui("Link bearbeiten"),
                  Link2,
                  false,
                  () => setLink(editor?.getAttributes("link").href ?? ""),
                ],
                [
                  ui("Link entfernen"),
                  Unlink,
                  false,
                  () => editor?.chain().focus().unsetLink().run(),
                ],
                [
                  ui("Trennlinie"),
                  Minus,
                  false,
                  () => editor?.chain().focus().setHorizontalRule().run(),
                ],
                [
                  ui("Formatierung entfernen"),
                  Pilcrow,
                  false,
                  () =>
                    editor?.chain().focus().unsetAllMarks().clearNodes().run(),
                ],
              ] as const
            ).map(([label, Icon, active, action]) => (
              <button
                key={label}
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={Boolean(active)}
                disabled={!editor}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => action()}
              >
                <Icon size={16} />
              </button>
            ))}
            <button
              type="button"
              title={ui("Rückgängig")}
              aria-label={ui("Rückgängig")}
              disabled={!selection?.undo}
              onClick={() => editor?.chain().focus().undo().run()}
            >
              <Undo2 size={16} />
            </button>
            <button
              type="button"
              title={ui("Wiederholen")}
              aria-label={ui("Wiederholen")}
              disabled={!selection?.redo}
              onClick={() => editor?.chain().focus().redo().run()}
            >
              <Redo2 size={16} />
            </button>
          </div>
          {link !== null && (
            <div className="legal-link-form">
              <input
                aria-label={ui("Link-Adresse für {0}", [title])}
                type="text"
                value={link}
                onChange={(event) => setLink(event.target.value)}
                placeholder="https://example.de oder mailto:kontakt@example.de"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyLink();
                  }
                }}
              />
              <button type="button" className="secondary" onClick={applyLink}>
                {ui("Übernehmen")}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => setLink(null)}
              >
                {ui("Abbrechen")}
              </button>
            </div>
          )}
        </>
      )}
      <div hidden={mode !== "edit"}>
        <EditorContent editor={editor} />
      </div>
      {mode === "html" && (
        <textarea
          className="legal-html-source"
          aria-label={ui("HTML für {0}", [title])}
          value={html}
          onChange={(event) => {
            setHtml(event.target.value);
            onChangeRef.current?.(event.target.value);
          }}
          rows={14}
          maxLength={100000}
          spellCheck={false}
        />
      )}
      {mode === "preview" && (
        <div
          className="legal-editor-preview legal-richtext"
          aria-label={ui("Vorschau für {0}", [title])}
          dangerouslySetInnerHTML={{ __html: preview }}
        />
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="legal-editor-note">
        {ui(
          "Überschriften, Listen, Links und Textformatierung. Skripte, Einbettungen und externe Bilder werden entfernt. Die Vorschau zeigt die bereinigte Darstellung.",
        )}
      </div>
    </div>
  );
}
