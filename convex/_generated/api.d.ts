/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account from "../account.js";
import type * as assetPersistence from "../assetPersistence.js";
import type * as assets from "../assets.js";
import type * as auth from "../auth.js";
import type * as boardAssets from "../boardAssets.js";
import type * as boardFolders from "../boardFolders.js";
import type * as boardHistory from "../boardHistory.js";
import type * as boardPersistence from "../boardPersistence.js";
import type * as boards from "../boards.js";
import type * as crons from "../crons.js";
import type * as diagramHistory from "../diagramHistory.js";
import type * as diagrams from "../diagrams.js";
import type * as fixedAccounts from "../fixedAccounts.js";
import type * as historyPersistence from "../historyPersistence.js";
import type * as http from "../http.js";
import type * as mediaLibrary from "../mediaLibrary.js";
import type * as mediaTypes from "../mediaTypes.js";
import type * as migrations from "../migrations.js";
import type * as programmaticBoardEdits from "../programmaticBoardEdits.js";
import type * as programmaticEditPersistence from "../programmaticEditPersistence.js";
import type * as programmaticEdits from "../programmaticEdits.js";
import type * as programmaticScene from "../programmaticScene.js";
import type * as sceneConflict from "../sceneConflict.js";
import type * as snapshotPolicy from "../snapshotPolicy.js";
import type * as snapshotRetention from "../snapshotRetention.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  account: typeof account;
  assetPersistence: typeof assetPersistence;
  assets: typeof assets;
  auth: typeof auth;
  boardAssets: typeof boardAssets;
  boardFolders: typeof boardFolders;
  boardHistory: typeof boardHistory;
  boardPersistence: typeof boardPersistence;
  boards: typeof boards;
  crons: typeof crons;
  diagramHistory: typeof diagramHistory;
  diagrams: typeof diagrams;
  fixedAccounts: typeof fixedAccounts;
  historyPersistence: typeof historyPersistence;
  http: typeof http;
  mediaLibrary: typeof mediaLibrary;
  mediaTypes: typeof mediaTypes;
  migrations: typeof migrations;
  programmaticBoardEdits: typeof programmaticBoardEdits;
  programmaticEditPersistence: typeof programmaticEditPersistence;
  programmaticEdits: typeof programmaticEdits;
  programmaticScene: typeof programmaticScene;
  sceneConflict: typeof sceneConflict;
  snapshotPolicy: typeof snapshotPolicy;
  snapshotRetention: typeof snapshotRetention;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
};
