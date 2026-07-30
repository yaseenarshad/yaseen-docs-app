import type {
  ImageStudioItem,
  ImageStudioSearchResponse,
  ImageStudioSearchSource,
} from "../../image-studio/types";

export const searchImageStudio = async (
  query: string,
  source: ImageStudioSearchSource,
  cursor?: string | null,
) => {
  const url = new URL("/api/image-studio/search", window.location.origin);
  url.searchParams.set("q", query);
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }
  url.searchParams.set("source", source);
  const response = await fetch(`${url.pathname}${url.search}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error ?? "Image search failed");
  }
  return (await response.json()) as ImageStudioSearchResponse;
};

export const importImageStudioFile = async (item: ImageStudioItem) => {
  if (item.provider === "shape") {
    throw new Error("Shapes are inserted as editable elements");
  }
  const response = await fetch(
    `/api/image-studio/import/${item.provider}/${encodeURIComponent(
      item.providerId,
    )}`,
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error ?? "Image import failed");
  }
  const blob = await response.blob();
  const extension =
    blob.type === "image/svg+xml"
      ? "svg"
      : blob.type === "image/png"
      ? "png"
      : blob.type === "image/webp"
      ? "webp"
      : "jpg";
  return new File(
    [blob],
    `${item.providerId.replaceAll(":", "-")}.${extension}`,
    {
      type: blob.type,
    },
  );
};
