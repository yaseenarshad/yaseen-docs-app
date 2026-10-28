import { Fragment, useEffect, useRef, useState } from "react";

import { extractManagedDocAssetPaths } from "../../doc-assets/types";

import { createMilkdownAdapter } from "./milkdownAdapter";
import { getOutlineFoldKey } from "./outlineFoldKeys";
import { downloadDocMarkdown, downloadPortableDocZip } from "./docExport";
import "./DocEmbeddable.scss";

import type {
  MilkdownAdapter,
  MilkdownAdapterOptions,
} from "./milkdownAdapter";
import type { ReactNode } from "react";

type DocEmbeddableProps = {
  active: boolean;
  readonly?: boolean;
  title: string;
  markdown: string;
  status?: "ready" | "loading" | "empty" | "error" | "deleted";
  onMarkdownChange: (markdown: string) => void;
  onDeactivate?: (markdown: string) => void | Promise<void>;
  saveStatus?: "saved" | "saving" | "local" | "error" | "conflict";
  onRetrySave?: () => void;
  onLoadLatest?: () => void;
  onSaveDraftAsNew?: () => void;
  onRestore?: () => void;
  onRemoveCard?: () => void;
  collapsedOutlineKeys?: ReadonlySet<string>;
  onCollapsedOutlineKeysChange?: (keys: readonly string[]) => void;
  initialScrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
  onUploadFiles?: MilkdownAdapterOptions["onUploadFiles"];
  resolveAssetPath?: MilkdownAdapterOptions["resolveAssetPath"];
  createEditor?: (options: MilkdownAdapterOptions) => Promise<MilkdownAdapter>;
};

const ManagedAsset = ({
  path,
  label,
  image,
  resolveAssetPath,
}: {
  path: string;
  label: string;
  image: boolean;
  resolveAssetPath?: (path: string) => Promise<string>;
}) => {
  const [resolved, setResolved] = useState(path);
  useEffect(() => {
    let cancelled = false;
    if (path.startsWith("assets/") && resolveAssetPath) {
      void resolveAssetPath(path).then((next) => {
        if (!cancelled) {
          setResolved(next);
        }
      });
    } else {
      setResolved(path);
    }
    return () => {
      cancelled = true;
    };
  }, [path, resolveAssetPath]);
  return image ? (
    <img src={resolved} alt={label} loading="lazy" />
  ) : (
    <a href={resolved} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
};

const renderInlineMarkdown = (
  text: string,
  resolveAssetPath?: (path: string) => Promise<string>,
): ReactNode[] =>
  text
    .split(/(!?\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`|_[^_]+_)/g)
    .filter(Boolean)
    .map((part, index) => {
      const link = /^(!?)\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
      if (link) {
        const safe =
          /^(https?:|mailto:)/i.test(link[3]) || link[3].startsWith("assets/");
        return safe ? (
          <ManagedAsset
            key={index}
            path={link[3]}
            label={link[2]}
            image={link[1] === "!"}
            resolveAssetPath={resolveAssetPath}
          />
        ) : (
          link[2]
        );
      }
      return part.startsWith("**") ? (
        <strong key={index}>{part.slice(2, -2)}</strong>
      ) : part.startsWith("~~") ? (
        <del key={index}>{part.slice(2, -2)}</del>
      ) : part.startsWith("`") ? (
        <code key={index}>{part.slice(1, -1)}</code>
      ) : part.startsWith("_") ? (
        <em key={index}>{part.slice(1, -1)}</em>
      ) : (
        part
      );
    });

const StaticMarkdown = ({
  markdown,
  collapsedKeys = new Set(),
  onCollapsedKeysChange,
  resolveAssetPath,
}: {
  markdown: string;
  collapsedKeys?: ReadonlySet<string>;
  onCollapsedKeysChange?: (keys: readonly string[]) => void;
  resolveAssetPath?: (path: string) => Promise<string>;
}) => {
  const lines = markdown.split("\n");
  const listItems = lines.map((line) => {
    const match = /^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.+)$/.exec(line);
    return match
      ? {
          indent: match[1].length,
          depth: Math.ceil(match[1].length / 3),
          marker: match[2],
          task: match[3],
          label: match[4],
        }
      : null;
  });
  const occurrences = new Map<string, number>();
  const parents = listItems.map((item, index) => {
    if (
      !item ||
      !listItems[index + 1] ||
      listItems[index + 1]!.depth <= item.depth
    ) {
      return null;
    }
    const occurrence = occurrences.get(item.label) ?? 0;
    occurrences.set(item.label, occurrence + 1);
    return getOutlineFoldKey(item.label, occurrence);
  });
  const hidden = new Set<number>();
  const parentStack: Array<{ depth: number; collapsed: boolean }> = [];
  listItems.forEach((item, index) => {
    if (!item) {
      parentStack.length = 0;
      return;
    }
    while (
      parentStack.length &&
      parentStack[parentStack.length - 1].depth >= item.depth
    ) {
      parentStack.pop();
    }
    if (parentStack.some((parent) => parent.collapsed)) {
      hidden.add(index);
    }
    if (parents[index]) {
      parentStack.push({
        depth: item.depth,
        collapsed: collapsedKeys.has(parents[index]!),
      });
    }
  });
  const toggle = (key: string) => {
    const next = new Set(collapsedKeys);
    next.has(key) ? next.delete(key) : next.add(key);
    onCollapsedKeysChange?.([...next].sort());
  };
  const blockStarts = new Map<number, ReactNode>();
  const skippedBlockLines = new Set<number>();
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].startsWith("```")) {
      const end = lines.findIndex(
        (line, candidate) => candidate > index && line.startsWith("```"),
      );
      if (end > index) {
        blockStarts.set(
          index,
          <pre>
            <code>{lines.slice(index + 1, end).join("\n")}</code>
          </pre>,
        );
        for (let skipped = index + 1; skipped <= end; skipped += 1) {
          skippedBlockLines.add(skipped);
        }
      }
    }
    if (
      lines[index].includes("|") &&
      /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/.test(lines[index + 1] ?? "")
    ) {
      let end = index + 2;
      while (end < lines.length && lines[end].includes("|")) {
        end += 1;
      }
      const rows = [lines[index], ...lines.slice(index + 2, end)].map((row) =>
        row
          .replace(/^\s*\||\|\s*$/g, "")
          .split("|")
          .map((cell) => cell.trim()),
      );
      blockStarts.set(
        index,
        <table>
          <thead>
            <tr>
              {rows[0].map((cell) => (
                <th key={cell}>
                  {renderInlineMarkdown(cell, resolveAssetPath)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(1).map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>
                    {renderInlineMarkdown(cell, resolveAssetPath)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      for (let skipped = index + 1; skipped < end; skipped += 1) {
        skippedBlockLines.add(skipped);
      }
    }
  }

  return (
    <div className="yaseendraw-doc-embeddable__markdown">
      {lines.map((line, index) => {
        if (skippedBlockLines.has(index)) {
          return null;
        }
        if (blockStarts.has(index)) {
          return <Fragment key={index}>{blockStarts.get(index)}</Fragment>;
        }
        if (hidden.has(index)) {
          return null;
        }
        const item = listItems[index];
        if (item) {
          const parentKey = parents[index];
          const collapsed = parentKey ? collapsedKeys.has(parentKey) : false;
          const bullet = /^\d/.test(item.marker)
            ? item.marker
            : ["●", "○", "▪"][item.depth % 3];
          return (
            <div
              key={index}
              className="yaseendraw-doc-embeddable__bullet"
              style={{ paddingInlineStart: `${item.depth * 1.5}em` }}
            >
              {parentKey && (
                <button
                  type="button"
                  className="yaseendraw-outline-toggle"
                  aria-expanded={!collapsed}
                  aria-label={`${collapsed ? "Expand" : "Collapse"} ${
                    item.label
                  }`}
                  onClick={() => toggle(parentKey)}
                >
                  {collapsed ? "▸" : "▾"}
                </button>
              )}
              <span aria-hidden="true">
                {item.task ? (item.task.trim() ? "☑" : "☐") : bullet}
              </span>
              <span>{renderInlineMarkdown(item.label, resolveAssetPath)}</span>
            </div>
          );
        }
        const heading = /^(#{1,3})\s+(.+)$/.exec(line);
        if (heading) {
          const content = heading[2];
          return heading[1].length === 1 ? (
            <h1 key={index}>
              {renderInlineMarkdown(content, resolveAssetPath)}
            </h1>
          ) : heading[1].length === 2 ? (
            <h2 key={index}>
              {renderInlineMarkdown(content, resolveAssetPath)}
            </h2>
          ) : (
            <h3 key={index}>
              {renderInlineMarkdown(content, resolveAssetPath)}
            </h3>
          );
        }
        return /^\s*(\*{3,}|-{3,}|_{3,})\s*$/.test(line) ? (
          <hr key={index} />
        ) : line.startsWith("> ") ? (
          <blockquote key={index}>
            {renderInlineMarkdown(line.slice(2), resolveAssetPath)}
          </blockquote>
        ) : line ? (
          <p key={index}>{renderInlineMarkdown(line, resolveAssetPath)}</p>
        ) : (
          <Fragment key={index}>
            <br />
          </Fragment>
        );
      })}
    </div>
  );
};

export const DocEmbeddable = ({
  active,
  readonly = false,
  title,
  markdown,
  status = "ready",
  onMarkdownChange,
  onDeactivate,
  saveStatus,
  onRetrySave,
  onLoadLatest,
  onSaveDraftAsNew,
  onRestore,
  onRemoveCard,
  collapsedOutlineKeys,
  onCollapsedOutlineKeysChange,
  initialScrollTop = 0,
  onScrollTopChange,
  onUploadFiles,
  resolveAssetPath,
  createEditor = createMilkdownAdapter,
}: DocEmbeddableProps) => {
  const editorRootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MilkdownAdapter | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const markdownRef = useRef(markdown);
  const onMarkdownChangeRef = useRef(onMarkdownChange);
  const onDeactivateRef = useRef(onDeactivate);
  const initialScrollTopRef = useRef(initialScrollTop);

  useEffect(() => {
    markdownRef.current = markdown;
    onMarkdownChangeRef.current = onMarkdownChange;
    onDeactivateRef.current = onDeactivate;
    initialScrollTopRef.current = initialScrollTop;
  }, [initialScrollTop, markdown, onDeactivate, onMarkdownChange]);

  useEffect(() => {
    const root = editorRootRef.current;
    if (!active || !root || (status !== "ready" && status !== "empty")) {
      return;
    }

    let editor: MilkdownAdapter | null = null;
    let disposed = false;
    root.scrollTop = initialScrollTopRef.current;
    const disposeEditor = async (nextEditor: MilkdownAdapter) => {
      const latestMarkdown = nextEditor.getMarkdown();
      await onDeactivateRef.current?.(latestMarkdown);
      await nextEditor.destroy();
    };
    void createEditor({
      root,
      markdown: markdownRef.current,
      onMarkdownChange: (nextMarkdown) =>
        onMarkdownChangeRef.current(nextMarkdown),
      collapsedOutlineKeys,
      onCollapsedOutlineKeysChange,
      onUploadFiles,
      resolveAssetPath,
    }).then((nextEditor) => {
      if (disposed) {
        void disposeEditor(nextEditor);
        return;
      }
      nextEditor.setReadonly(readonly);
      editor = nextEditor;
      editorRef.current = nextEditor;
    });

    return () => {
      disposed = true;
      if (editor) {
        editorRef.current = null;
        void disposeEditor(editor);
      }
    };
  }, [
    active,
    collapsedOutlineKeys,
    createEditor,
    onCollapsedOutlineKeysChange,
    onUploadFiles,
    readonly,
    resolveAssetPath,
    status,
  ]);

  const canEdit = active && (status === "ready" || status === "empty");

  const staticBody =
    status === "loading" ? (
      <div className="yaseendraw-doc-embeddable__message">Loading Doc…</div>
    ) : status === "empty" ? (
      <div className="yaseendraw-doc-embeddable__message">Start writing…</div>
    ) : status === "error" ? (
      <div className="yaseendraw-doc-embeddable__message">Doc unavailable</div>
    ) : status === "deleted" ? (
      <div className="yaseendraw-doc-embeddable__message">
        <span>“{title}” was deleted</span>
        {onRestore && (
          <button type="button" onClick={onRestore}>
            Restore
          </button>
        )}
        {onRemoveCard && (
          <button type="button" onClick={onRemoveCard}>
            Remove card
          </button>
        )}
      </div>
    ) : (
      <StaticMarkdown
        markdown={markdown}
        collapsedKeys={collapsedOutlineKeys}
        onCollapsedKeysChange={onCollapsedOutlineKeysChange}
        resolveAssetPath={resolveAssetPath}
      />
    );

  return (
    <article className="yaseendraw-doc-embeddable" data-status={status}>
      <header className="yaseendraw-doc-embeddable__header" title={title}>
        <span className="yaseendraw-doc-embeddable__title">{title}</span>
        <div className="yaseendraw-doc-embeddable__actions">
          <button
            type="button"
            className="yaseendraw-doc-embeddable__copy-markdown"
            title="Copy canonical Markdown"
            aria-label={`Copy ${title} Markdown`}
            onClick={() => void navigator.clipboard?.writeText(markdown)}
          >
            Copy Markdown
          </button>
          <button
            type="button"
            className="yaseendraw-doc-embeddable__download-markdown"
            onClick={() => downloadDocMarkdown(title, markdown)}
          >
            Download .md
          </button>
          {resolveAssetPath &&
            extractManagedDocAssetPaths(markdown).length > 0 && (
              <button
                type="button"
                className="yaseendraw-doc-embeddable__download-zip"
                onClick={() =>
                  void downloadPortableDocZip({
                    title,
                    markdown,
                    resolveAssetPath,
                  })
                }
              >
                Download ZIP
              </button>
            )}
          {canEdit && onUploadFiles && (
            <>
              <button
                type="button"
                className="yaseendraw-doc-embeddable__attach"
                onClick={() => fileInputRef.current?.click()}
              >
                Attach
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(event) => {
                  const files = [...(event.currentTarget.files ?? [])];
                  event.currentTarget.value = "";
                  void editorRef.current?.insertFiles(files);
                }}
              />
            </>
          )}
          {saveStatus && (
            <span className="yaseendraw-doc-embeddable__save-status">
              {saveStatus === "saving"
                ? "Saving…"
                : saveStatus === "saved"
                ? "Saved"
                : saveStatus === "local"
                ? "Saved locally"
                : saveStatus === "conflict"
                ? "Conflict"
                : "Couldn’t save"}
              {saveStatus === "error" && onRetrySave && (
                <button type="button" onClick={onRetrySave}>
                  Retry
                </button>
              )}
              {saveStatus === "conflict" && onLoadLatest && (
                <button type="button" onClick={onLoadLatest}>
                  Load latest
                </button>
              )}
              {saveStatus === "conflict" && onSaveDraftAsNew && (
                <button type="button" onClick={onSaveDraftAsNew}>
                  Save draft as new Doc
                </button>
              )}
            </span>
          )}
        </div>
      </header>
      {canEdit ? (
        <div
          key="milkdown-editor"
          ref={editorRootRef}
          className="yaseendraw-doc-embeddable__editor"
          aria-label={`Editing ${title}`}
          onScroll={(event) =>
            onScrollTopChange?.(event.currentTarget.scrollTop)
          }
        />
      ) : (
        <div
          key="static-preview"
          className="yaseendraw-doc-embeddable__preview"
          aria-label={`${title} preview`}
          ref={(node) => {
            if (node) {
              node.scrollTop = initialScrollTop;
            }
          }}
          onScroll={(event) =>
            onScrollTopChange?.(event.currentTarget.scrollTop)
          }
        >
          {staticBody}
        </div>
      )}
    </article>
  );
};
