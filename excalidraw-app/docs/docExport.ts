import { zipSync } from "fflate";

import { extractManagedDocAssetPaths } from "../../doc-assets/types";

export const portableDocFilename = (title: string) =>
  title
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "Untitled";

const download = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  queueMicrotask(() => URL.revokeObjectURL(url));
};

export const downloadDocMarkdown = (title: string, markdown: string) =>
  download(
    new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
    `${portableDocFilename(title)}.md`,
  );

export const buildPortableDocZip = async (args: {
  title: string;
  markdown: string;
  resolveAssetPath: (path: string) => Promise<string>;
}) => {
  const assets = await Promise.all(
    extractManagedDocAssetPaths(args.markdown).map(async (path) => {
      const response = await fetch(await args.resolveAssetPath(path));
      if (!response.ok) {
        throw new Error(`Could not export ${path}`);
      }
      return [path, new Uint8Array(await response.arrayBuffer())] as const;
    }),
  );
  const files: Record<string, Uint8Array> = {
    [`${portableDocFilename(args.title)}.md`]: new Uint8Array(
      await new Response(args.markdown).arrayBuffer(),
    ),
  };
  for (const [path, bytes] of assets) {
    files[path] = bytes;
  }
  return zipSync(files, { level: 6 });
};

export const downloadPortableDocZip = async (args: {
  title: string;
  markdown: string;
  resolveAssetPath: (path: string) => Promise<string>;
}) =>
  download(
    new Blob(
      [(await buildPortableDocZip(args)).slice().buffer as ArrayBuffer],
      {
        type: "application/zip",
      },
    ),
    `${portableDocFilename(args.title)}.zip`,
  );
