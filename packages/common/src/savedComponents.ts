export const SAVED_COMPONENT_SCHEMA_VERSION = 1 as const;
export const MAX_SAVED_COMPONENT_BYTES = 750_000;
export const MAX_SAVED_COMPONENT_NAME_LENGTH = 120;

export const UNSUPPORTED_SAVED_COMPONENT_ELEMENT_TYPES = [
  "image",
  "iframe",
  "embeddable",
] as const;
