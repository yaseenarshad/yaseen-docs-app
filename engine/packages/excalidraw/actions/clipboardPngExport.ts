export const getClipboardPngExportOptions = <
  TAppState extends { exportBackground: boolean },
  TExportingFrame,
>({
  appState,
  exportingFrame,
  hasSelection,
  name,
}: {
  appState: TAppState;
  exportingFrame: TExportingFrame;
  hasSelection: boolean;
  name: string;
}) => ({
  ...appState,
  exportingFrame,
  name,
  ...(hasSelection
    ? {
        exportBackground: false,
        exportPadding: 0,
      }
    : {}),
});
