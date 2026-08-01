import { httpRouter } from "convex/server";

import { auth } from "./auth";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

auth.addHttpRoutes(http);

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
