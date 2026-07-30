import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FileId } from "@excalidraw/element/types";

import { API } from "../tests/helpers/api";

import { ImageBackgroundRemovalAction } from "./Actions";

import type { AppClassProperties, DataURL } from "../types";

const createFixture = (
  onImageBackgroundRemoval: NonNullable<
    AppClassProperties["props"]["onImageBackgroundRemoval"]
  >,
) => {
  const fileId = "source" as FileId;
  const image = API.createElement({
    type: "image",
    fileId,
    status: "saved",
  });
  const app = {
    props: { onImageBackgroundRemoval },
    files: {
      [fileId]: {
        id: fileId,
        mimeType: "image/png",
        dataURL: "data:image/png;base64,source" as DataURL,
        created: 1,
      },
    },
    imageCache: new Map(),
  } as unknown as AppClassProperties;
  return { image, app, fileId };
};

describe("ImageBackgroundRemovalAction", () => {
  it("shows progress, disables duplicate clicks, and completes cleanly", async () => {
    let finish: (() => void) | undefined;
    const handler = vi.fn(
      async ({
        onProgress,
      }: Parameters<
        NonNullable<AppClassProperties["props"]["onImageBackgroundRemoval"]>
      >[0]) => {
        onProgress({
          stage: "processing",
          message: "Removing background on this device…",
          progress: 0.42,
        });
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
    );
    const { image, app } = createFixture(handler);
    render(<ImageBackgroundRemovalAction app={app} targetElements={[image]} />);

    const button = screen.getByRole("button", {
      name: "Remove background",
    });
    fireEvent.click(button);
    await screen.findByRole("button", {
      name: /Removing background on this device… 42%/,
    });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(handler).toHaveBeenCalledTimes(1);

    finish?.();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Remove background" }),
      ).toBeEnabled(),
    );
  });

  it("keeps the original selection retryable after a failure", async () => {
    const handler = vi.fn(async () => {
      throw new Error("Local inference failed. Your image was not changed.");
    });
    const { image, app } = createFixture(handler);
    render(<ImageBackgroundRemovalAction app={app} targetElements={[image]} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove background" }));
    expect(
      await screen.findByRole("button", {
        name: "Retry background removal",
      }),
    ).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/was not changed/);
  });

  it("stays hidden for multi-selection and unsupported source files", () => {
    const handler = vi.fn();
    const { image, app, fileId } = createFixture(handler);
    const { rerender } = render(
      <ImageBackgroundRemovalAction
        app={app}
        targetElements={[image, { ...image, id: "other" }]}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Remove background" }),
    ).not.toBeInTheDocument();

    app.files[fileId] = {
      ...app.files[fileId],
      mimeType: "image/gif",
    };
    rerender(
      <ImageBackgroundRemovalAction app={app} targetElements={[image]} />,
    );
    expect(
      screen.queryByRole("button", { name: "Remove background" }),
    ).not.toBeInTheDocument();
  });
});
