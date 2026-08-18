import { normalizeMarkdownInput } from "./milkdownFeatureConfig";

export type MilkdownAdapterOptions = {
  root: HTMLElement;
  markdown: string;
  onMarkdownChange?: (markdown: string) => void;
  collapsedOutlineKeys?: ReadonlySet<string>;
  onCollapsedOutlineKeysChange?: (keys: readonly string[]) => void;
  onUploadFiles?: (
    files: readonly File[],
    signal: AbortSignal,
  ) => Promise<string[]>;
  resolveAssetPath?: (path: string) => Promise<string>;
};

export type MilkdownAdapter = {
  destroy: () => Promise<void>;
  getMarkdown: () => string;
  replaceMarkdown: (markdown: string) => void;
  setReadonly: (readonly: boolean) => void;
  insertFiles: (files: readonly File[]) => Promise<void>;
};

/**
 * The only browser-facing seam around Milkdown. Keeping the imports here means
 * the editor and its theme remain outside the normal Board startup bundle.
 */
export const createMilkdownAdapter = async ({
  root,
  markdown,
  onMarkdownChange,
  collapsedOutlineKeys,
  onCollapsedOutlineKeysChange,
  onUploadFiles,
  resolveAssetPath,
}: MilkdownAdapterOptions): Promise<MilkdownAdapter> => {
  const [
    { CrepeBuilder },
    { blockEdit },
    { cursor },
    { linkTooltip },
    { listItem },
    { placeholder },
    { table },
    { toolbar },
    { replaceAll },
    { createOutlineFolding },
  ] = await Promise.all([
    import("@milkdown/crepe/builder"),
    import("@milkdown/crepe/feature/block-edit"),
    import("@milkdown/crepe/feature/cursor"),
    import("@milkdown/crepe/feature/link-tooltip"),
    import("@milkdown/crepe/feature/list-item"),
    import("@milkdown/crepe/feature/placeholder"),
    import("@milkdown/crepe/feature/table"),
    import("@milkdown/crepe/feature/toolbar"),
    import("@milkdown/kit/utils"),
    import("./outlineFolding"),
    import("@milkdown/crepe/theme/common/reset.css"),
    import("@milkdown/crepe/theme/common/prosemirror.css"),
    import("@milkdown/crepe/theme/common/block-edit.css"),
    import("@milkdown/crepe/theme/common/cursor.css"),
    import("@milkdown/crepe/theme/common/link-tooltip.css"),
    import("@milkdown/crepe/theme/common/list-item.css"),
    import("@milkdown/crepe/theme/common/placeholder.css"),
    import("@milkdown/crepe/theme/common/table.css"),
    import("@milkdown/crepe/theme/common/toolbar.css"),
    import("@milkdown/crepe/theme/frame.css"),
    import("./outlineFolding.css"),
  ]);
  const crepe = new CrepeBuilder({
    root,
    defaultValue: normalizeMarkdownInput(markdown),
  })
    .addFeature(blockEdit)
    .addFeature(cursor)
    .addFeature(linkTooltip)
    .addFeature(listItem)
    .addFeature(placeholder)
    .addFeature(table)
    .addFeature(toolbar);
  crepe.editor.use(
    createOutlineFolding({
      initialCollapsedKeys: collapsedOutlineKeys,
      onCollapsedKeysChange: onCollapsedOutlineKeysChange,
    }),
  );

  let serializedMarkdown = markdown;
  crepe.on((listener) => {
    listener.markdownUpdated((_ctx, nextMarkdown, previousMarkdown) => {
      serializedMarkdown = nextMarkdown;
      if (onMarkdownChange && nextMarkdown !== previousMarkdown) {
        onMarkdownChange(nextMarkdown);
      }
    });
  });

  await crepe.create();
  serializedMarkdown = crepe.getMarkdown();
  let destroyed = false;
  const uploads = new Set<AbortController>();

  const refreshManagedAssetUrls = async () => {
    if (!resolveAssetPath || destroyed) {
      return;
    }
    const nodes = root.querySelectorAll<HTMLImageElement | HTMLAnchorElement>(
      'img[src^="assets/"], a[href^="assets/"]',
    );
    await Promise.all(
      [...nodes].map(async (node) => {
        const attribute = node instanceof HTMLImageElement ? "src" : "href";
        const stablePath = node.getAttribute(attribute);
        if (!stablePath) {
          return;
        }
        const resolved = await resolveAssetPath(stablePath).catch(() => null);
        if (!destroyed && resolved) {
          node.setAttribute(attribute, resolved);
        }
      }),
    );
  };
  void refreshManagedAssetUrls();

  const insertFiles = async (files: readonly File[]) => {
    if (!onUploadFiles || files.length === 0 || destroyed) {
      return;
    }
    const controller = new AbortController();
    uploads.add(controller);
    const marker = `Uploading ${files.map((file) => file.name).join(", ")}…`;
    const separator = serializedMarkdown.endsWith("\n") ? "\n" : "\n\n";
    crepe.editor.action(
      replaceAll(`${serializedMarkdown}${separator}${marker}`),
    );
    serializedMarkdown = crepe.getMarkdown();
    try {
      const references = await onUploadFiles(files, controller.signal);
      const next = serializedMarkdown.replace(marker, references.join("\n"));
      crepe.editor.action(replaceAll(next));
      serializedMarkdown = crepe.getMarkdown();
      onMarkdownChange?.(serializedMarkdown);
      void refreshManagedAssetUrls();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        const next = serializedMarkdown.replace(
          marker,
          `Upload failed: ${files.map((file) => file.name).join(", ")}`,
        );
        crepe.editor.action(replaceAll(next));
        serializedMarkdown = crepe.getMarkdown();
        onMarkdownChange?.(serializedMarkdown);
      }
    } finally {
      uploads.delete(controller);
    }
  };
  const onPaste = (event: ClipboardEvent) => {
    const files = [...(event.clipboardData?.files ?? [])];
    if (files.length) {
      event.preventDefault();
      void insertFiles(files);
    }
  };
  const onDrop = (event: DragEvent) => {
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length) {
      event.preventDefault();
      void insertFiles(files);
    }
  };
  root.addEventListener("paste", onPaste);
  root.addEventListener("drop", onDrop);
  const assetObserver = new MutationObserver(
    () => void refreshManagedAssetUrls(),
  );
  assetObserver.observe(root, { childList: true, subtree: true });

  return {
    // Read from the last document-changing transaction. Milkdown can otherwise
    // reserialize harmless plugin-only transactions (such as outline folding)
    // with different trailing whitespace even though the document is identical.
    getMarkdown: () => serializedMarkdown,
    replaceMarkdown: (nextMarkdown) => {
      if (destroyed) {
        return;
      }
      crepe.editor.action(replaceAll(normalizeMarkdownInput(nextMarkdown)));
      serializedMarkdown = crepe.getMarkdown();
    },
    setReadonly: (readonly) => {
      if (!destroyed) {
        crepe.setReadonly(readonly);
      }
    },
    insertFiles,
    destroy: async () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      uploads.forEach((controller) => controller.abort());
      root.removeEventListener("paste", onPaste);
      root.removeEventListener("drop", onDrop);
      assetObserver.disconnect();
      await crepe.destroy();
      root.replaceChildren();
    },
  };
};
