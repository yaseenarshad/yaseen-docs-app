import { v } from "convex/values";

export const boardPreviewSummaryValidator = v.union(
  v.object({
    status: v.literal("legacy"),
  }),
  v.object({
    status: v.literal("empty"),
    version: v.number(),
    updatedAt: v.optional(v.number()),
  }),
  v.object({
    status: v.literal("available"),
    version: v.number(),
    url: v.string(),
    mimeType: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  }),
);

export const toBoardPreviewSummary = (diagram: {
  previewObjectKey?: string;
  previewVersion?: number;
  previewMimeType?: string;
  previewWidth?: number;
  previewHeight?: number;
  previewUpdatedAt?: number;
}) => {
  if (diagram.previewVersion === undefined) {
    return { status: "legacy" as const };
  }
  if (!diagram.previewObjectKey) {
    return {
      status: "empty" as const,
      version: diagram.previewVersion,
      ...(diagram.previewUpdatedAt === undefined
        ? {}
        : { updatedAt: diagram.previewUpdatedAt }),
    };
  }
  return {
    status: "available" as const,
    version: diagram.previewVersion,
    url: `/api/assets/${diagram.previewObjectKey}`,
    ...(diagram.previewMimeType === undefined
      ? {}
      : { mimeType: diagram.previewMimeType }),
    ...(diagram.previewWidth === undefined
      ? {}
      : { width: diagram.previewWidth }),
    ...(diagram.previewHeight === undefined
      ? {}
      : { height: diagram.previewHeight }),
    ...(diagram.previewUpdatedAt === undefined
      ? {}
      : { updatedAt: diagram.previewUpdatedAt }),
  };
};
