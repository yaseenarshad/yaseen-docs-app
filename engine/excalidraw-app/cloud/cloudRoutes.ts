export type CloudRoute =
  | { kind: "home" }
  | { kind: "owner"; slug: string; isLegacyPath: boolean }
  | { kind: "shared"; shareToken: string };

const decodeRouteSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};

export const getCanonicalOwnerPath = (slug: string) =>
  `/b/${encodeURIComponent(slug)}`;

export const parseCloudRoute = (pathname: string): CloudRoute => {
  const ownerMatch = pathname.match(/^\/b\/([^/]+)\/?$/);
  if (ownerMatch) {
    const slug = decodeRouteSegment(ownerMatch[1]);
    if (!slug) {
      return { kind: "home" };
    }
    return {
      kind: "owner",
      slug,
      isLegacyPath: false,
    };
  }
  const legacyOwnerMatch = pathname.match(/^\/d\/([^/]+)\/?$/);
  if (legacyOwnerMatch) {
    const slug = decodeRouteSegment(legacyOwnerMatch[1]);
    if (!slug) {
      return { kind: "home" };
    }
    return {
      kind: "owner",
      slug,
      isLegacyPath: true,
    };
  }
  const sharedMatch = pathname.match(/^\/s\/([^/]+)\/?$/);
  if (sharedMatch) {
    const shareToken = decodeRouteSegment(sharedMatch[1]);
    if (!shareToken) {
      return { kind: "home" };
    }
    return {
      kind: "shared",
      shareToken,
    };
  }
  return { kind: "home" };
};

export const getLegacyOwnerReplacement = (
  route: CloudRoute,
  search: string,
  hash: string,
) =>
  route.kind === "owner" && route.isLegacyPath
    ? `${getCanonicalOwnerPath(route.slug)}${search}${hash}`
    : null;
