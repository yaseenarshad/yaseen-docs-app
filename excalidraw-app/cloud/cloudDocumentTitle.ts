import type { CloudRoute } from "./cloudRoutes";

export const PRODUCT_DOCUMENT_TITLE = "Yaseen Whiteboard";

export const getCloudDocumentTitle = (
  route: CloudRoute,
  board:
    | {
        slug: string;
        title: string;
      }
    | null
    | undefined,
) => {
  if (route.kind !== "owner" || !board || board.slug !== route.slug) {
    return PRODUCT_DOCUMENT_TITLE;
  }
  const title = board.title.trim() || "Untitled board";
  return `${title} — ${PRODUCT_DOCUMENT_TITLE}`;
};
