import { httpRouter } from "convex/server";

import {
  BOARD_SCENE_DELETE_GRANT_PATH,
  BOARD_SCENE_READ_GRANT_PATH,
  BOARD_SCENE_UPLOAD_GRANT_PATH,
} from "../board-scenes/types";

import { auth } from "./auth";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

auth.addHttpRoutes(http);

/**
 * The private Worker resolves every Board scene capability through these
 * routes. Each response is exactly the shape `board-scenes/types.ts` parses,
 * and single-use plus expiry enforcement happens here rather than in the
 * Worker, which fails closed on anything it does not fully understand.
 */
const boardSceneGrantToken = async (request: Request) => {
  const body = (await request.json()) as unknown;
  return typeof body === "object" &&
    body !== null &&
    "token" in body &&
    typeof body.token === "string"
    ? body.token
    : null;
};

http.route({
  path: BOARD_SCENE_UPLOAD_GRANT_PATH,
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const token = await boardSceneGrantToken(request);
    if (token === null) {
      return Response.json(
        { error: "Invalid Board scene grant" },
        { status: 400 },
      );
    }
    const grant = await ctx.runMutation(
      internal.boardScenes.resolveUploadGrant,
      { token },
    );
    if (!grant) {
      return Response.json(
        { error: "Board scene grant expired" },
        { status: 403 },
      );
    }
    return Response.json(grant);
  }),
});

http.route({
  path: BOARD_SCENE_READ_GRANT_PATH,
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const token = await boardSceneGrantToken(request);
    if (token === null) {
      return Response.json(
        { error: "Invalid Board scene read grant" },
        { status: 400 },
      );
    }
    const grant = await ctx.runQuery(internal.boardScenes.resolveReadGrant, {
      token,
    });
    if (!grant) {
      return Response.json(
        { error: "Board scene read grant expired" },
        { status: 403 },
      );
    }
    return Response.json(grant);
  }),
});

http.route({
  path: BOARD_SCENE_DELETE_GRANT_PATH,
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const token = await boardSceneGrantToken(request);
    if (token === null) {
      return Response.json(
        { error: "Invalid Board scene delete grant" },
        { status: 400 },
      );
    }
    const grant = await ctx.runMutation(
      internal.boardScenes.consumeDeleteGrant,
      { token },
    );
    if (!grant) {
      return Response.json(
        { error: "Board scene delete grant expired" },
        { status: 403 },
      );
    }
    return Response.json(grant);
  }),
});

http.route({
  path: "/asset-upload-grant",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = (await request.json()) as { token?: unknown };
    if (typeof body.token !== "string") {
      return Response.json({ error: "Invalid grant" }, { status: 400 });
    }
    const grant = await ctx.runMutation(internal.assets.validateUploadGrant, {
      token: body.token,
    });
    if (!grant) {
      return Response.json({ error: "Grant expired" }, { status: 403 });
    }
    return Response.json(grant);
  }),
});

http.route({
  path: "/presentation-animation-upload-grant",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = (await request.json()) as unknown;
    if (
      typeof body !== "object" ||
      body === null ||
      !("token" in body) ||
      typeof body.token !== "string"
    ) {
      return Response.json(
        { error: "Invalid animation grant" },
        { status: 400 },
      );
    }
    const grant = await ctx.runQuery(
      internal.presentationAnimations.validateUploadGrant,
      { token: body.token },
    );
    if (!grant) {
      return Response.json(
        { error: "Animation grant expired" },
        { status: 403 },
      );
    }
    return Response.json(grant);
  }),
});

http.route({
  path: "/presentation-animation-read-grant",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = (await request.json()) as unknown;
    if (
      typeof body !== "object" ||
      body === null ||
      !("token" in body) ||
      typeof body.token !== "string"
    ) {
      return Response.json({ error: "Invalid read grant" }, { status: 400 });
    }
    const grant = await ctx.runQuery(
      internal.presentationAnimations.validateReadGrant,
      { token: body.token },
    );
    if (!grant) {
      return Response.json(
        { error: "Animation read grant expired" },
        { status: 403 },
      );
    }
    return Response.json(grant);
  }),
});

http.route({
  path: "/asset-delete-grant",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = (await request.json()) as { token?: unknown };
    if (typeof body.token !== "string") {
      return Response.json({ error: "Invalid grant" }, { status: 400 });
    }
    const grant = await ctx.runMutation(internal.assets.consumeDeleteGrant, {
      token: body.token,
    });
    if (!grant) {
      return Response.json({ error: "Grant expired" }, { status: 403 });
    }
    return Response.json(grant);
  }),
});

export default http;
