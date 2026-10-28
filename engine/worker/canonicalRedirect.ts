const OLD_HOSTNAME = "draw.yasinarshad.com";
const CANONICAL_HOSTNAME = "draw.yaseenarshad.com";

export const getCanonicalRedirect = (requestUrl: URL) => {
  const target = new URL(requestUrl);
  let changed = false;

  if (target.hostname === OLD_HOSTNAME) {
    target.hostname = CANONICAL_HOSTNAME;
    changed = true;
  }

  const legacyBoardMatch = target.pathname.match(/^\/d\/([^/]+)\/?$/);
  if (legacyBoardMatch) {
    target.pathname = `/b/${legacyBoardMatch[1]}`;
    changed = true;
  }

  return changed ? target : null;
};

export const getCanonicalRedirectResponse = (requestUrl: URL) => {
  const target = getCanonicalRedirect(requestUrl);
  if (!target) {
    return null;
  }

  return new Response(null, {
    status: 308,
    headers: {
      "Cache-Control": "no-store",
      Location: target.toString(),
    },
  });
};
