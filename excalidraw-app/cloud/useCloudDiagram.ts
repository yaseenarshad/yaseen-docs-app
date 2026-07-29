import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { BinaryFiles } from "@excalidraw/excalidraw/types";

import { api } from "../../convex/_generated/api";

type CloudRoute =
  | { kind: "home" }
  | { kind: "owner"; slug: string }
  | { kind: "shared"; shareToken: string };

export type CloudSaveStatus =
  | "loading"
  | "saved"
  | "saving"
  | "conflict"
  | "error"
  | "viewer";

const getRoute = (): CloudRoute => {
  const ownerMatch = window.location.pathname.match(/^\/d\/([^/]+)\/?$/);
  if (ownerMatch) {
    return { kind: "owner", slug: ownerMatch[1] };
  }
  const sharedMatch = window.location.pathname.match(/^\/s\/([^/]+)\/?$/);
  if (sharedMatch) {
    return { kind: "shared", shareToken: sharedMatch[1] };
  }
  return { kind: "home" };
};

export const useCloudDiagram = () => {
  const [route, setRoute] = useState<CloudRoute>(getRoute);
  const [saveStatus, setSaveStatus] = useState<CloudSaveStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const ensureDefault = useMutation(api.diagrams.ensureDefault);
  const createDiagram = useMutation(api.diagrams.create);
  const renameDiagram = useMutation(api.diagrams.rename);
  const saveDiagram = useMutation(api.diagrams.save);
  const setSharing = useMutation(api.diagrams.setSharing);
  const createAssetUploadGrant = useMutation(api.assets.createUploadGrant);
  const registerAssetUpload = useMutation(api.assets.registerUpload);
  const versionRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const pendingSceneRef = useRef<string | null>(null);
  const uploadedFileIdsRef = useRef(new Set<string>());
  const uploadingFileIdsRef = useRef(new Set<string>());

  const ownedDiagram = useQuery(
    api.diagrams.openMine,
    route.kind === "owner" ? { slug: route.slug } : "skip",
  );
  const diagrams = useQuery(api.diagrams.listMine, {});
  const sharedDiagram = useQuery(
    api.diagrams.openShared,
    route.kind === "shared" ? { shareToken: route.shareToken } : "skip",
  );
  const openedDiagram =
    route.kind === "owner"
      ? ownedDiagram
      : route.kind === "shared"
      ? sharedDiagram
      : undefined;
  const ownedAssets = useQuery(
    api.assets.listMine,
    route.kind === "owner" && ownedDiagram
      ? { diagramId: ownedDiagram.diagram._id }
      : "skip",
  );
  const sharedAssets = useQuery(
    api.assets.listShared,
    route.kind === "shared" ? { shareToken: route.shareToken } : "skip",
  );
  const assets =
    route.kind === "owner"
      ? ownedAssets
      : route.kind === "shared"
      ? sharedAssets
      : undefined;

  useEffect(() => {
    const handlePopState = () => setRoute(getRoute());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (route.kind !== "home") {
      return;
    }
    let cancelled = false;
    void ensureDefault({})
      .then(({ slug }) => {
        if (cancelled) {
          return;
        }
        const nextRoute = { kind: "owner", slug } as const;
        window.history.replaceState({}, "", `/d/${slug}`);
        setRoute(nextRoute);
      })
      .catch((cause) => {
        if (!cancelled) {
          setSaveStatus("error");
          setErrorMessage(
            cause instanceof Error
              ? cause.message
              : "Could not create a cloud diagram",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ensureDefault, route.kind]);

  useEffect(() => {
    if (openedDiagram) {
      versionRef.current = openedDiagram.version;
      setSaveStatus(openedDiagram.access === "viewer" ? "viewer" : "saved");
      setErrorMessage(null);
    } else if (openedDiagram === null) {
      setSaveStatus("error");
      setErrorMessage("This diagram does not exist or you do not have access.");
    }
  }, [openedDiagram]);

  useEffect(() => {
    for (const asset of assets ?? []) {
      uploadedFileIdsRef.current.add(asset.fileId);
    }
  }, [assets]);

  const flushSave = useCallback(async () => {
    if (!openedDiagram || openedDiagram.access !== "owner") {
      return;
    }
    const sceneJson = pendingSceneRef.current;
    if (!sceneJson) {
      return;
    }
    pendingSceneRef.current = null;
    setSaveStatus("saving");
    try {
      const result = await saveDiagram({
        diagramId: openedDiagram.diagram._id,
        expectedVersion: versionRef.current,
        sceneJson,
      });
      versionRef.current = result.version;
      if (result.status === "conflict") {
        setSaveStatus("conflict");
        setErrorMessage(
          "This diagram changed in another tab. Your next edit will save against the latest version.",
        );
        return;
      }
      setSaveStatus("saved");
      setErrorMessage(null);
    } catch (cause) {
      pendingSceneRef.current = sceneJson;
      setSaveStatus("error");
      setErrorMessage(
        cause instanceof Error ? cause.message : "Cloud save failed",
      );
    }
  }, [openedDiagram, saveDiagram]);

  const queueSave = useCallback(
    (sceneJson: string) => {
      if (!openedDiagram || openedDiagram.access !== "owner") {
        return;
      }
      pendingSceneRef.current = sceneJson;
      setSaveStatus("saving");
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        void flushSave();
      }, 900);
    },
    [flushSave, openedDiagram],
  );

  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    },
    [],
  );

  const enableSharing = useCallback(async () => {
    if (!openedDiagram || openedDiagram.access !== "owner") {
      return null;
    }
    const result = await setSharing({
      diagramId: openedDiagram.diagram._id,
      enabled: true,
    });
    if (!result.shareToken) {
      return null;
    }
    return `${window.location.origin}/s/${result.shareToken}`;
  }, [openedDiagram, setSharing]);

  const openDiagram = useCallback(
    async (slug: string) => {
      if (route.kind === "owner" && route.slug === slug) {
        return;
      }
      await flushSave();
      setSaveStatus("loading");
      setErrorMessage(null);
      window.history.pushState({}, "", `/d/${slug}`);
      setRoute({ kind: "owner", slug });
    },
    [flushSave, route],
  );

  const createNewDiagram = useCallback(async () => {
    await flushSave();
    const result = await createDiagram({ title: "Untitled diagram" });
    setSaveStatus("loading");
    setErrorMessage(null);
    window.history.pushState({}, "", `/d/${result.slug}`);
    setRoute({ kind: "owner", slug: result.slug });
  }, [createDiagram, flushSave]);

  const renameOpenedDiagram = useCallback(
    async (title: string) => {
      if (!openedDiagram || openedDiagram.access !== "owner") {
        return;
      }
      await renameDiagram({
        diagramId: openedDiagram.diagram._id,
        title,
      });
    },
    [openedDiagram, renameDiagram],
  );

  const queueAssets = useCallback(
    (files: BinaryFiles) => {
      if (!openedDiagram || openedDiagram.access !== "owner") {
        return;
      }
      for (const file of Object.values(files)) {
        if (
          uploadedFileIdsRef.current.has(file.id) ||
          uploadingFileIdsRef.current.has(file.id)
        ) {
          continue;
        }
        uploadingFileIdsRef.current.add(file.id);
        void (async () => {
          try {
            const response = await fetch(file.dataURL);
            const blob = await response.blob();
            const { token } = await createAssetUploadGrant({
              diagramId: openedDiagram.diagram._id,
              fileId: file.id,
              mimeType: file.mimeType,
              size: blob.size,
            });
            const uploadResponse = await fetch("/api/assets", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": file.mimeType,
              },
              body: blob,
            });
            if (!uploadResponse.ok) {
              const body = (await uploadResponse.json()) as {
                error?: string;
              };
              throw new Error(body.error || "Image upload failed");
            }
            const body = (await uploadResponse.json()) as { etag: string };
            await registerAssetUpload({ token, etag: body.etag });
            uploadedFileIdsRef.current.add(file.id);
          } catch (cause) {
            setSaveStatus("error");
            setErrorMessage(
              cause instanceof Error ? cause.message : "Image upload failed",
            );
          } finally {
            uploadingFileIdsRef.current.delete(file.id);
          }
        })();
      }
    },
    [createAssetUploadGrant, openedDiagram, registerAssetUpload],
  );

  return useMemo(
    () => ({
      route,
      openedDiagram,
      saveStatus,
      errorMessage,
      queueSave,
      flushSave,
      enableSharing,
      diagrams: diagrams ?? [],
      isDiagramListLoading: diagrams === undefined,
      openDiagram,
      createNewDiagram,
      renameOpenedDiagram,
      assets: assets ?? [],
      queueAssets,
      isViewer: openedDiagram?.access === "viewer",
      isReady: openedDiagram !== undefined && openedDiagram !== null,
    }),
    [
      enableSharing,
      diagrams,
      errorMessage,
      flushSave,
      assets,
      createNewDiagram,
      openedDiagram,
      openDiagram,
      queueAssets,
      queueSave,
      renameOpenedDiagram,
      route,
      saveStatus,
    ],
  );
};
