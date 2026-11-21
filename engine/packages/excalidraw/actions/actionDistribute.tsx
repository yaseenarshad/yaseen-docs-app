import {
  CaptureUpdateAction,
  distributeElements,
  getNonDeletedElements,
  getSelectedElementsByGroup,
  isFrameLikeElement,
  updateBoundElements,
  updateFrameMembershipOfSelectedElements,
} from "@excalidraw/element";

import { CODES, KEYS, arrayToMap } from "@excalidraw/common";

import type {
  ElementsMap,
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import type { Distribution, Scene } from "@excalidraw/element";

import { IconButton } from "../components/IconButton";
import {
  DistributeHorizontallyIcon,
  DistributeVerticallyIcon,
} from "../components/icons";

import { t } from "../i18n";

import { isSomeElementSelected } from "../scene";
import { getSnapBounds } from "../snapping";

import { boundShortcut } from "../keyRemap";
import { getShortcutKey } from "../shortcut";

import { register } from "./register";

import type { AppClassProperties, AppState, UIAppState } from "../types";

const MIN_GRID_GAP = 8;
const FALLBACK_GRID_GAP = 16;

type TidyBoundingBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  midX: number;
  midY: number;
};

const getTidyBoundingBox = (
  elements: readonly NonDeletedExcalidrawElement[],
  elementsMap: ElementsMap,
): TidyBoundingBox => {
  const [minX, minY, maxX, maxY] = getSnapBounds(elements, elementsMap);
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    midX: (minX + maxX) / 2,
    midY: (minY + maxY) / 2,
  };
};

type TidyGroupItem = {
  group: readonly NonDeletedExcalidrawElement[];
  box: TidyBoundingBox;
};

const translateGroup = (
  group: readonly NonDeletedExcalidrawElement[],
  dx: number,
  dy: number,
  scene: Scene,
): NonDeletedExcalidrawElement[] => {
  return group.map((element) => {
    const updatedElement = scene.mutateElement(element, {
      x: element.x + dx,
      y: element.y + dy,
    });
    updateBoundElements(element, scene, {
      simultaneouslyUpdated: group,
    });
    return updatedElement;
  });
};

export const tidyUpElements = (
  selectedElements: readonly NonDeletedExcalidrawElement[],
  elementsMap: ElementsMap,
  appState: Readonly<AppState>,
  scene: Scene,
): NonDeletedExcalidrawElement[] => {
  if (selectedElements.some((el) => isFrameLikeElement(el))) {
    return [];
  }

  const groups: TidyGroupItem[] = getSelectedElementsByGroup(
    [...selectedElements],
    elementsMap,
    appState,
  )
    .map(getNonDeletedElements)
    .filter((group) => group.length > 0)
    .map((group) => ({
      group,
      box: getTidyBoundingBox(group, elementsMap),
    }));

  if (groups.length < 3) {
    return [];
  }

  const commonBox = getTidyBoundingBox(selectedElements, elementsMap);

  // Cluster groups into visual rows based on Y overlap.
  const sortedByY = [...groups].sort(
    (a, b) => a.box.minY - b.box.minY || a.box.minX - b.box.minX,
  );
  const rows: { items: TidyGroupItem[]; minY: number; maxY: number }[] = [];

  for (const item of sortedByY) {
    const lastRow = rows[rows.length - 1];
    if (lastRow && item.box.minY < lastRow.maxY) {
      lastRow.items.push(item);
      lastRow.minY = Math.min(lastRow.minY, item.box.minY);
      lastRow.maxY = Math.max(lastRow.maxY, item.box.maxY);
    } else {
      rows.push({
        items: [item],
        minY: item.box.minY,
        maxY: item.box.maxY,
      });
    }
  }

  for (const row of rows) {
    row.items.sort((a, b) => a.box.minX - b.box.minX);
  }

  // Case 1: 1D horizontal row -> equalize horizontal gaps + align vertical centers.
  if (rows.length === 1) {
    const items = rows[0].items;
    const totalW = items.reduce((sum, item) => sum + item.box.width, 0);
    const rawGap =
      (commonBox.maxX - commonBox.minX - totalW) / (items.length - 1);
    const gap = rawGap < 0 ? FALLBACK_GRID_GAP : rawGap;
    const targetMidY = (commonBox.minY + commonBox.maxY) / 2;

    let cursorX = commonBox.minX;
    return items.flatMap((item) => {
      const dx = cursorX - item.box.minX;
      const dy = targetMidY - item.box.midY;
      cursorX += item.box.width + gap;
      return translateGroup(item.group, dx, dy, scene);
    });
  }

  // Case 2: 1D vertical column -> equalize vertical gaps + align horizontal centers.
  if (rows.every((row) => row.items.length === 1)) {
    const items = rows.map((row) => row.items[0]);
    const totalH = items.reduce((sum, item) => sum + item.box.height, 0);
    const rawGap =
      (commonBox.maxY - commonBox.minY - totalH) / (items.length - 1);
    const gap = rawGap < 0 ? FALLBACK_GRID_GAP : rawGap;
    const targetMidX = (commonBox.minX + commonBox.maxX) / 2;

    let cursorY = commonBox.minY;
    return items.flatMap((item) => {
      const dx = targetMidX - item.box.midX;
      const dy = cursorY - item.box.minY;
      cursorY += item.box.height + gap;
      return translateGroup(item.group, dx, dy, scene);
    });
  }

  // Case 3: 2D grid (>=2 rows and >=1 row with >=2 items).
  const posGapsX: number[] = [];
  for (const row of rows) {
    for (let c = 0; c + 1 < row.items.length; c++) {
      const gap = row.items[c + 1].box.minX - row.items[c].box.maxX;
      if (gap > 0) {
        posGapsX.push(gap);
      }
    }
  }
  const gapX =
    posGapsX.length > 0
      ? Math.max(
          MIN_GRID_GAP,
          posGapsX.reduce((a, b) => a + b, 0) / posGapsX.length,
        )
      : FALLBACK_GRID_GAP;

  const posGapsY: number[] = [];
  for (let r = 0; r + 1 < rows.length; r++) {
    const gap = rows[r + 1].minY - rows[r].maxY;
    if (gap > 0) {
      posGapsY.push(gap);
    }
  }
  const gapY =
    posGapsY.length > 0
      ? Math.max(
          MIN_GRID_GAP,
          posGapsY.reduce((a, b) => a + b, 0) / posGapsY.length,
        )
      : FALLBACK_GRID_GAP;

  const numCols = Math.max(...rows.map((r) => r.items.length));
  const colWidths = Array.from({ length: numCols }, (_, c) =>
    Math.max(
      ...rows
        .filter((r) => c < r.items.length)
        .map((r) => r.items[c].box.width),
    ),
  );
  const rowHeights = rows.map((r) =>
    Math.max(...r.items.map((item) => item.box.height)),
  );

  const colX: number[] = [];
  let cx = commonBox.minX;
  for (let c = 0; c < numCols; c++) {
    colX.push(cx);
    cx += colWidths[c] + gapX;
  }

  const rowY: number[] = [];
  let cy = commonBox.minY;
  for (let r = 0; r < rows.length; r++) {
    rowY.push(cy);
    cy += rowHeights[r] + gapY;
  }

  const updatedElements: NonDeletedExcalidrawElement[] = [];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].items.length; c++) {
      const item = rows[r].items[c];
      const dx = colX[c] - item.box.minX;
      const dy = rowY[r] - item.box.minY;
      updatedElements.push(...translateGroup(item.group, dx, dy, scene));
    }
  }

  return updatedElements;
};

const enableActionGroup = (appState: UIAppState, app: AppClassProperties) => {
  const selectedElements = app.scene.getSelectedElements(appState);
  return (
    getSelectedElementsByGroup(
      selectedElements,
      app.scene.getNonDeletedElementsMap(),
      appState,
    ).length > 2 &&
    // TODO enable distributing frames when implemented properly
    !selectedElements.some((el) => isFrameLikeElement(el))
  );
};

const distributeSelectedElements = (
  elements: readonly ExcalidrawElement[],
  appState: Readonly<AppState>,
  app: AppClassProperties,
  distribution: Distribution,
) => {
  const selectedElements = app.scene.getSelectedElements(appState);

  const updatedElements = distributeElements(
    selectedElements,
    app.scene.getNonDeletedElementsMap(),
    distribution,
    appState,
    app.scene,
  );

  const updatedElementsMap = arrayToMap(updatedElements);

  return updateFrameMembershipOfSelectedElements(
    elements.map((element) => updatedElementsMap.get(element.id) || element),
    appState,
    app,
  );
};

export const actionTidyUp = register({
  name: "tidyUp",
  label: "labels.tidyUp",
  trackEvent: { category: "element" },
  predicate: (_elements, appState, _appProps, app) =>
    enableActionGroup(appState, app),
  keyTest: (event) =>
    !event[KEYS.CTRL_OR_CMD] && event.altKey && event.code === CODES.T,
  perform: (elements, appState, _, app) => {
    const selectedElements = app.scene.getSelectedElements(appState);
    const updatedElements = tidyUpElements(
      selectedElements,
      app.scene.getNonDeletedElementsMap(),
      appState,
      app.scene,
    );
    if (updatedElements.length === 0) {
      return false;
    }
    const updatedElementsMap = arrayToMap(updatedElements);
    return {
      appState,
      elements: updateFrameMembershipOfSelectedElements(
        elements.map(
          (element) => updatedElementsMap.get(element.id) || element,
        ),
        appState,
        app,
      ),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
});

export const distributeHorizontally = register({
  name: "distributeHorizontally",
  label: "labels.distributeHorizontally",
  trackEvent: { category: "element" },
  predicate: (_elements, appState, _appProps, app) =>
    enableActionGroup(appState, app),
  perform: (elements, appState, _, app) => {
    return {
      appState,
      elements: distributeSelectedElements(elements, appState, app, {
        space: "between",
        axis: "x",
      }),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  keyTest: (event) =>
    !event[KEYS.CTRL_OR_CMD] && event.altKey && event.code === CODES.H,
  PanelComponent: ({ elements, appState, updateData, app }) => (
    <IconButton
      hidden={!enableActionGroup(appState, app)}
      type="button"
      icon={DistributeHorizontallyIcon}
      onClick={() => updateData(null)}
      // Yaseen Docs (YAZ-3564 K12)
      title={`${t("labels.distributeHorizontally")} — ${
        boundShortcut("distributeHorizontally") ?? getShortcutKey("Alt+H")
      }`}
      aria-label={t("labels.distributeHorizontally")}
      visible={isSomeElementSelected(getNonDeletedElements(elements), appState)}
    />
  ),
});

export const distributeVertically = register({
  name: "distributeVertically",
  label: "labels.distributeVertically",
  trackEvent: { category: "element" },
  predicate: (_elements, appState, _appProps, app) =>
    enableActionGroup(appState, app),
  perform: (elements, appState, _, app) => {
    return {
      appState,
      elements: distributeSelectedElements(elements, appState, app, {
        space: "between",
        axis: "y",
      }),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  keyTest: (event) =>
    !event[KEYS.CTRL_OR_CMD] && event.altKey && event.code === CODES.V,
  PanelComponent: ({ elements, appState, updateData, app }) => (
    <IconButton
      hidden={!enableActionGroup(appState, app)}
      type="button"
      icon={DistributeVerticallyIcon}
      onClick={() => updateData(null)}
      // Yaseen Docs (YAZ-3564 K12)
      title={`${t("labels.distributeVertically")} — ${
        boundShortcut("distributeVertically") ?? getShortcutKey("Alt+V")
      }`}
      aria-label={t("labels.distributeVertically")}
      visible={isSomeElementSelected(getNonDeletedElements(elements), appState)}
    />
  ),
});
