import {
  CaptureUpdateAction,
  SMART_SHAPE_HANDLE_PARAMETERS,
  getSmartShapeDefinition,
  getSmartShapeMetadata,
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
  headLengthRatio: "Arrowhead length",
  thicknessRatio: "Thickness",
  tailPositionRatio: "Tail position",
  bendRatio: "Bend",
  gapRatio: "Gap",
  openingRatio: "Opening",
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
    if (!metadata || !definition) {
      return null;
    }

    return (
      <fieldset>
        <legend>Smart shape</legend>
        {definition.handles.map((handle) => {
          const parameter = SMART_SHAPE_HANDLE_PARAMETERS[handle];
          // Each slider spans its parameter's own limits (YAZ-4356), as a handle drag does.
          const [min, max] = definition.limits[parameter] ?? [0.1, 0.9];
          const value =
            metadata.parameters[parameter] ??
            definition.defaults[parameter] ??
            min;
          return (
            <Range
              key={parameter}
              label={labels[parameter]}
              value={Math.round(value * 100)}
              min={Math.round(min * 100)}
              max={Math.round(max * 100)}
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
