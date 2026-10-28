import migrations from "@convex-dev/migrations/convex.config.js";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    ALLOW_DEV_ACCOUNT_CREATION: v.optional(v.string()),
    BOARD_SCENE_R2_ENDPOINT: v.optional(v.string()),
    BOARD_SCENE_R2_BUCKET: v.optional(v.string()),
    BOARD_SCENE_R2_ACCESS_KEY_ID: v.optional(v.string()),
    BOARD_SCENE_R2_SECRET_ACCESS_KEY: v.optional(v.string()),
  },
});
app.use(migrations);

export default app;
