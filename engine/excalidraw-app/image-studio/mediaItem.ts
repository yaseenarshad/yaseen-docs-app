import type {
  ImageStudioItem,
  StoredMediaItem,
} from "../../image-studio/types";

export const normalizeMediaItem = (
  item: ImageStudioItem | StoredMediaItem,
): StoredMediaItem => {
  const normalized: StoredMediaItem = {
    itemKey: item.itemKey,
    provider: item.provider,
    providerId: item.providerId,
    kind: item.kind,
    title: item.title,
  };

  const optionalFields = [
    "previewUrl",
    "creator",
    "creatorUrl",
    "collectionName",
    "sourceUrl",
    "licenseName",
    "licenseUrl",
    "attribution",
    "width",
    "height",
    "trademarkNotice",
  ] as const;

  for (const field of optionalFields) {
    const value = item[field];
    if (value !== undefined) {
      Object.assign(normalized, { [field]: value });
    }
  }

  return normalized;
};
