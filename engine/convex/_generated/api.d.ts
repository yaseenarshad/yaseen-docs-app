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
import type * as assetDeletePersistence from "../assetDeletePersistence.js";
import type * as assetPersistence from "../assetPersistence.js";
import type * as assets from "../assets.js";
import type * as auth from "../auth.js";
import type * as authPolicy from "../authPolicy.js";
import type * as boardAssets from "../boardAssets.js";
import type * as boardDocs from "../boardDocs.js";
import type * as boardFolders from "../boardFolders.js";
import type * as boardHistory from "../boardHistory.js";
import type * as boardPersistence from "../boardPersistence.js";
import type * as boardPreviewModel from "../boardPreviewModel.js";
import type * as boardPreviewPersistence from "../boardPreviewPersistence.js";
import type * as boardPreviews from "../boardPreviews.js";
import type * as boardSceneCleanup from "../boardSceneCleanup.js";
import type * as boardSceneEditing from "../boardSceneEditing.js";
import type * as boardSceneEdits from "../boardSceneEdits.js";
import type * as boardSceneFinalization from "../boardSceneFinalization.js";
import type * as boardSceneModel from "../boardSceneModel.js";
import type * as boardScenePersistence from "../boardScenePersistence.js";
import type * as boardSceneR2 from "../boardSceneR2.js";
import type * as boardSceneTransport from "../boardSceneTransport.js";
import type * as boardSceneUploads from "../boardSceneUploads.js";
import type * as boardScenes from "../boardScenes.js";
import type * as boards from "../boards.js";
import type * as cloudSaveProtocol from "../cloudSaveProtocol.js";
import type * as crons from "../crons.js";
import type * as diagramHistory from "../diagramHistory.js";
import type * as diagrams from "../diagrams.js";
import type * as docAssets from "../docAssets.js";
import type * as docContentModel from "../docContentModel.js";
import type * as docContentPersistence from "../docContentPersistence.js";
import type * as docContents from "../docContents.js";
import type * as docFolders from "../docFolders.js";
import type * as docLibraryModel from "../docLibraryModel.js";
import type * as docModel from "../docModel.js";
import type * as docSnapshotRetention from "../docSnapshotRetention.js";
import type * as docs from "../docs.js";
import type * as docsMode from "../docsMode.js";
import type * as fixedAccounts from "../fixedAccounts.js";
import type * as historyPersistence from "../historyPersistence.js";
import type * as http from "../http.js";
import type * as legacyBoardContent from "../legacyBoardContent.js";
import type * as mediaLibrary from "../mediaLibrary.js";
import type * as mediaTypes from "../mediaTypes.js";
import type * as migrations from "../migrations.js";
import type * as presentationAnimationModel from "../presentationAnimationModel.js";
import type * as presentationAnimations from "../presentationAnimations.js";
import type * as programmaticBoardEdits from "../programmaticBoardEdits.js";
import type * as programmaticEditPersistence from "../programmaticEditPersistence.js";
import type * as programmaticEdits from "../programmaticEdits.js";
import type * as programmaticScene from "../programmaticScene.js";
import type * as savedComponentModel from "../savedComponentModel.js";
import type * as savedComponents from "../savedComponents.js";
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
  assetDeletePersistence: typeof assetDeletePersistence;
  assetPersistence: typeof assetPersistence;
  assets: typeof assets;
  auth: typeof auth;
  authPolicy: typeof authPolicy;
  boardAssets: typeof boardAssets;
  boardDocs: typeof boardDocs;
  boardFolders: typeof boardFolders;
  boardHistory: typeof boardHistory;
  boardPersistence: typeof boardPersistence;
  boardPreviewModel: typeof boardPreviewModel;
  boardPreviewPersistence: typeof boardPreviewPersistence;
  boardPreviews: typeof boardPreviews;
  boardSceneCleanup: typeof boardSceneCleanup;
  boardSceneEditing: typeof boardSceneEditing;
  boardSceneEdits: typeof boardSceneEdits;
  boardSceneFinalization: typeof boardSceneFinalization;
  boardSceneModel: typeof boardSceneModel;
  boardScenePersistence: typeof boardScenePersistence;
  boardSceneR2: typeof boardSceneR2;
  boardSceneTransport: typeof boardSceneTransport;
  boardSceneUploads: typeof boardSceneUploads;
  boardScenes: typeof boardScenes;
  boards: typeof boards;
  cloudSaveProtocol: typeof cloudSaveProtocol;
  crons: typeof crons;
  diagramHistory: typeof diagramHistory;
  diagrams: typeof diagrams;
  docAssets: typeof docAssets;
  docContentModel: typeof docContentModel;
  docContentPersistence: typeof docContentPersistence;
  docContents: typeof docContents;
  docFolders: typeof docFolders;
  docLibraryModel: typeof docLibraryModel;
  docModel: typeof docModel;
  docSnapshotRetention: typeof docSnapshotRetention;
  docs: typeof docs;
  docsMode: typeof docsMode;
  fixedAccounts: typeof fixedAccounts;
  historyPersistence: typeof historyPersistence;
  http: typeof http;
  legacyBoardContent: typeof legacyBoardContent;
  mediaLibrary: typeof mediaLibrary;
  mediaTypes: typeof mediaTypes;
  migrations: typeof migrations;
  presentationAnimationModel: typeof presentationAnimationModel;
  presentationAnimations: typeof presentationAnimations;
  programmaticBoardEdits: typeof programmaticBoardEdits;
  programmaticEditPersistence: typeof programmaticEditPersistence;
  programmaticEdits: typeof programmaticEdits;
  programmaticScene: typeof programmaticScene;
  savedComponentModel: typeof savedComponentModel;
  savedComponents: typeof savedComponents;
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
