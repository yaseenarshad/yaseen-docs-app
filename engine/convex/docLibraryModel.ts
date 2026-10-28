import { v } from "convex/values";

import { docLifecycleValidator } from "./docModel";

export const MAX_DOC_TITLE_LENGTH = 120;
export const MAX_DOC_FOLDER_NAME_LENGTH = 120;
export const MAX_DOC_FOLDERS_PER_OWNER = 200;
export const MAX_DOCS_PER_FOLDER_SCOPE = 1000;

export const docSortValidator = v.union(
  v.literal("name-asc"),
  v.literal("name-desc"),
  v.literal("created-desc"),
  v.literal("created-asc"),
  v.literal("modified-desc"),
  v.literal("modified-asc"),
);

export const docSummaryValidator = v.object({
  _id: v.id("docs"),
  title: v.string(),
  folderId: v.optional(v.id("docFolders")),
  lifecycle: docLifecycleValidator,
  deletedAt: v.optional(v.number()),
  purgedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const docFolderSummaryValidator = v.object({
  _id: v.id("docFolders"),
  name: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const normalizeRequiredValue = (
  value: string,
  label: string,
  maxLength: number,
) => {
  const displayValue = value.trim();
  if (!displayValue) {
    throw new Error(`${label} is required`);
  }
  if (displayValue.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`);
  }
  return {
    displayValue,
    normalizedValue: displayValue.toLocaleLowerCase("en-US"),
  };
};

export const validateDocTitle = (value: string) => {
  const { displayValue, normalizedValue } = normalizeRequiredValue(
    value,
    "Doc title",
    MAX_DOC_TITLE_LENGTH,
  );
  return { title: displayValue, normalizedTitle: normalizedValue };
};

export const validateDocFolderName = (value: string) => {
  const { displayValue, normalizedValue } = normalizeRequiredValue(
    value,
    "Folder name",
    MAX_DOC_FOLDER_NAME_LENGTH,
  );
  return { name: displayValue, normalizedName: normalizedValue };
};
