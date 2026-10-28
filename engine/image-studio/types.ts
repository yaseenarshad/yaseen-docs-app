export type ImageStudioProvider = "pixabay" | "iconify" | "shape";
export type ImageStudioSearchSource = "all" | "pixabay" | "iconify";
export type ImageStudioItemKind =
  | "photo"
  | "illustration"
  | "icon"
  | "logo"
  | "shape";

export type ImageStudioItem = {
  itemKey: string;
  provider: ImageStudioProvider;
  providerId: string;
  kind: ImageStudioItemKind;
  title: string;
  previewUrl: string;
  creator?: string;
  creatorUrl?: string;
  collectionName?: string;
  sourceUrl?: string;
  licenseName?: string;
  licenseUrl?: string;
  attribution?: string;
  width?: number;
  height?: number;
  trademarkNotice?: boolean;
};

export type ImageStudioSearchResponse = {
  results: ImageStudioItem[];
  cursor: string | null;
  warnings: Array<{
    provider: Exclude<ImageStudioProvider, "shape">;
    message: string;
  }>;
};

export type StoredMediaItem = Omit<ImageStudioItem, "previewUrl"> & {
  previewUrl?: string;
};
