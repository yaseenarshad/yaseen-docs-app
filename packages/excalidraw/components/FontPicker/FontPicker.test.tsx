import { KEYS } from "@excalidraw/common";
import { fireEvent, waitFor } from "@testing-library/react";

import { Excalidraw } from "../../index";
import { Keyboard } from "../../tests/helpers/ui";
import { act, render } from "../../tests/test-utils";

describe("FontPicker", () => {
  it("should be able to open font picker", async () => {
    (global as any).ResizeObserver =
      (global as any).ResizeObserver ||
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      };

    const { queryByTestId } = await render(
      <Excalidraw handleKeyboardGlobally={true} />,
    );

    Keyboard.keyPress(KEYS.T);

    const fontPickerTrigger = queryByTestId("font-family-show-fonts");

    expect(fontPickerTrigger).not.toBeNull();

    act(() => {
      fontPickerTrigger!.click();
    });
  });

  it("lists and searches every professional family by its truthful name", async () => {
    (global as any).ResizeObserver =
      (global as any).ResizeObserver ||
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      };

    const { getByPlaceholderText, getByTestId, getByTitle, queryByTitle } =
      await render(<Excalidraw handleKeyboardGlobally={true} />);

    Keyboard.keyPress(KEYS.T);
    act(() => {
      getByTestId("font-family-show-fonts").click();
    });

    for (const family of [
      "Inter",
      "Roboto",
      "Liberation Sans",
      "Liberation Serif",
      "IBM Plex Mono",
    ]) {
      expect(getByTitle(family)).toBeInTheDocument();
    }

    fireEvent.change(getByPlaceholderText("Quick search"), {
      target: { value: "plex mono" },
    });

    await waitFor(() => {
      expect(getByTitle("IBM Plex Mono")).toBeInTheDocument();
      expect(queryByTitle("Inter")).not.toBeInTheDocument();
    });
  });
});
