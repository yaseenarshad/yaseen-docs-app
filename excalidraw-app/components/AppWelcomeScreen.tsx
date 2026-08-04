import { WelcomeScreen } from "@excalidraw/excalidraw/index";
import React from "react";

import "./AppWelcomeScreen.scss";

export const AppWelcomeScreen: React.FC<{
  onCollabDialogOpen: () => any;
  isCollabEnabled: boolean;
}> = React.memo(() => {
  return (
    <WelcomeScreen>
      <WelcomeScreen.Center>
        <WelcomeScreen.Center.Logo>
          <div className="yaseen-welcome-lockup">
            <img
              className="yaseen-welcome-lockup__logo"
              src="/favicon.svg"
              alt=""
              aria-hidden="true"
            />
            <h1 className="yaseen-welcome-lockup__title">
              Yaseen’s Whiteboard
            </h1>
          </div>
        </WelcomeScreen.Center.Logo>
      </WelcomeScreen.Center>
    </WelcomeScreen>
  );
});
