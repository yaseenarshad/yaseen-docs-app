import {
  CaptureUpdateAction,
  getSmartShapeDefinition,
  getSmartShapeHandleParameter,
  getSmartShapeMetadata,
  readSmartShapeParameter,
  updateSmartShapeParameter,
} from "@excalidraw/element";

import type { SmartShapeParameterName } from "@excalidraw/element";
import type { ExcalidrawLinearElement } from "@excalidraw/element/types";

import { Range } from "../components/Range";

import { register } from "./register";

type SmartShapeActionData = {
  parameter: SmartShapeParameterName;
  value: number;
};

const labels: Record<SmartShapeParameterName, string> = {
  shaftRatio: "Shaft thickness",
  headAspect: "Arrowhead length",
  headLengthRatio: "Arrowhead length",
  thicknessRatio: "Thickness",
  tailPositionRatio: "Tail position",
  bendRatio: "Bend",
  gapRatio: "Gap",
  openingRatio: "Opening",
  cuspRatio: "Tip position",
  skewRatio: "Skew",
  topWidthRatio: "Top width",
};

export const actionChangeSmartShape = register<SmartShapeActionData>({
  name: "changeSmartShape",
  label: "Smart shape",
  trackEvent: false,
  perform: (elements, appState, data) => ({
    elements: data
      ? elements.map((element) =>
          appState.selectedElementIds[element.id] &&
          getSmartShapeMetadata(element)
            ? updateSmartShapeParameter(
                element as ExcalidrawLinearElement,
                data.parameter,
                data.value,
              )
            : element,
        )
      : elements,
    appState,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  }),
  PanelComponent: ({ elements, appState, updateData }) => {
    const selected = elements.filter(
      (element) => appState.selectedElementIds[element.id],
    );
    if (selected.length !== 1 || selected[0].locked) {
      return null;
    }
    const metadata = getSmartShapeMetadata(selected[0]);
    const definition = metadata
      ? getSmartShapeDefinition(metadata.id)
      : undefined;
    if (!metadata || !definition || definition.handles.length === 0) {
      return null;
    }

    return (
      <fieldset>
        <legend>Smart shape</legend>
        {definition.handles.map((handle) => {
          const parameter = getSmartShapeHandleParameter(definition, handle);
          // Each slider spans its parameter's own limits (YAZ-4356), as a handle drag does.
          const [min, max] = definition.limits[parameter] ?? [0.1, 0.9];
          const value = readSmartShapeParameter(
            metadata.id,
            selected[0].width,
            selected[0].height,
            metadata.parameters,
            parameter,
          );
          const formatBound = (bound: number) =>
            parameter === "headAspect"
              ? `${bound}×`
              : `${Math.round(bound * 100)}%`;
          return (
            <Range
              key={parameter}
              label={labels[parameter]}
              value={Math.round(value * 100)}
              min={Math.round(min * 100)}
              max={Math.round(max * 100)}
              minLabel={formatBound(min)}
              maxLabel={formatBound(max)}
              step={1}
              onChange={(nextValue) =>
                updateData<SmartShapeActionData>({
                  parameter,
                  value: nextValue / 100,
                })
              }
              testId={`smart-shape-${parameter}`}
            />
          );
        })}
      </fieldset>
    );
  },
});
