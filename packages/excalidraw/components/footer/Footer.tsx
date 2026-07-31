import clsx from "clsx";

import { actionShortcuts, actionZoomToFit } from "../../actions";
import { getShortcutFromShortcutName } from "../../actions/shortcuts";
import { useTunnels } from "../../context/tunnels";
import { t } from "../../i18n";
import { ExitZenModeButton, UndoRedoActions, ZoomActions } from "../Actions";
import { useApp } from "../App";
import { HelpButton } from "../HelpButton";
import { IconButton } from "../IconButton";
import { Section } from "../Section";
import Stack from "../Stack";
import { Tooltip } from "../Tooltip";
import { zoomAreaIcon } from "../icons";

import type { ActionManager } from "../../actions/manager";
import type { UIAppState } from "../../types";

const Footer = ({
  appState,
  actionManager,
  showExitZenModeBtn,
  renderWelcomeScreen,
  defaultUIEnabled,
  zoomUIEnabled,
}: {
  appState: UIAppState;
  actionManager: ActionManager;
  showExitZenModeBtn: boolean;
  renderWelcomeScreen: boolean;
  defaultUIEnabled: boolean;
  zoomUIEnabled: boolean;
}) => {
  const { FooterCenterTunnel, WelcomeScreenHelpHintTunnel } = useTunnels();
  const app = useApp();
  const fitBoardLabel = t("labels.fitBoard");

  return (
    <footer
      role="contentinfo"
      className="layer-ui__wrapper__footer App-menu App-menu_bottom"
    >
      {(defaultUIEnabled || (zoomUIEnabled && app.isNavigationEnabled())) && (
        <div
          className={clsx(
            "layer-ui__wrapper__footer-left zen-mode-transition",
            {
              "layer-ui__wrapper__footer-left--transition-left":
                appState.zenModeEnabled,
            },
          )}
        >
          <Stack.Col gap={2}>
            <Section heading="canvasActions">
              {zoomUIEnabled && app.isNavigationEnabled() && (
                <ZoomActions renderAction={actionManager.renderAction} />
              )}

              {defaultUIEnabled && app.isNavigationEnabled() && (
                <div
                  className={clsx(
                    "history-and-fit-board-actions zen-mode-transition",
                    {
                      "layer-ui__wrapper__footer-left--transition-bottom":
                        appState.zenModeEnabled,
                    },
                  )}
                >
                  {!appState.viewModeEnabled && (
                    <UndoRedoActions
                      renderAction={actionManager.renderAction}
                    />
                  )}
                  <div className="fit-board-footer-island">
                    <Tooltip
                      label={`${fitBoardLabel} (${getShortcutFromShortcutName(
                        "zoomToFit",
                      )})`}
                    >
                      <IconButton
                        type="button"
                        className="fit-board-button"
                        data-testid="fit-board-button"
                        icon={zoomAreaIcon}
                        title={fitBoardLabel}
                        aria-label={fitBoardLabel}
                        aria-keyshortcuts="Shift+1"
                        disabled={
                          !actionManager.isActionEnabled(actionZoomToFit)
                        }
                        onClick={() =>
                          actionManager.executeAction(actionZoomToFit, "ui")
                        }
                      />
                    </Tooltip>
                  </div>
                </div>
              )}
            </Section>
          </Stack.Col>
        </div>
      )}
      <FooterCenterTunnel.Out />
      {(defaultUIEnabled || renderWelcomeScreen) && (
        <div
          className={clsx(
            "layer-ui__wrapper__footer-right zen-mode-transition",
            {
              "transition-right": appState.zenModeEnabled,
            },
          )}
        >
          <div style={{ position: "relative" }}>
            {renderWelcomeScreen && <WelcomeScreenHelpHintTunnel.Out />}
            {defaultUIEnabled && (
              <HelpButton
                onClick={() => actionManager.executeAction(actionShortcuts)}
              />
            )}
          </div>
        </div>
      )}
      {defaultUIEnabled && (
        <ExitZenModeButton
          actionManager={actionManager}
          showExitZenModeBtn={showExitZenModeBtn}
        />
      )}
    </footer>
  );
};

export default Footer;
Footer.displayName = "Footer";
