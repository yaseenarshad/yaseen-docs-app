import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import { defaultLang, languages } from "@excalidraw/excalidraw/i18n";
import { UI } from "@excalidraw/excalidraw/tests/helpers/ui";
import {
  screen,
  fireEvent,
  waitFor,
  render,
  togglePopover,
} from "@excalidraw/excalidraw/tests/test-utils";

import { LanguageList } from "../app-language/LanguageList";
import { useAppLangCode } from "../app-language/language-state";
import { Provider } from "../app-jotai";

const TEST_LANG_CODE = "fr-FR";

const TestApp = () => {
  const [langCode] = useAppLangCode();

  return (
    <Excalidraw langCode={langCode}>
      <MainMenu>
        <MainMenu.ItemCustom>
          <LanguageList />
        </MainMenu.ItemCustom>
      </MainMenu>
    </Excalidraw>
  );
};

describe("Test LanguageList", () => {
  it("rerenders UI on language change", async () => {
    expect(languages.some((lang) => lang.code === TEST_LANG_CODE)).toBe(true);

    await render(
      <Provider>
        <TestApp />
      </Provider>,
    );

    // select rectangle tool to show properties menu
    UI.clickTool("rectangle");
    togglePopover("More properties");
    // English should display the unlocalized Architect roughness label.
    expect(screen.queryByTitle(/^architect$/i)).not.toBeNull();
    togglePopover("More properties");
    fireEvent.click(document.querySelector(".dropdown-menu-button")!);

    fireEvent.change(document.querySelector(".dropdown-select__language")!, {
      target: { value: TEST_LANG_CODE },
    });
    await waitFor(() => {
      expect(document.documentElement.lang).toBe(TEST_LANG_CODE);
    });
    fireEvent.click(document.querySelector(".dropdown-menu-button")!);
    togglePopover("More properties");
    // Switching to French replaces the English label.
    await waitFor(() => {
      expect(screen.queryByTitle(/^architect$/i)).toBeNull();
      expect(screen.queryByTitle(/architecte/i)).not.toBeNull();
    });
    togglePopover("More properties");
    fireEvent.click(document.querySelector(".dropdown-menu-button")!);
    // reset language
    fireEvent.change(document.querySelector(".dropdown-select__language")!, {
      target: { value: defaultLang.code },
    });
    await waitFor(() => {
      expect(document.documentElement.lang).toBe(defaultLang.code);
    });
    fireEvent.click(document.querySelector(".dropdown-menu-button")!);
    togglePopover("More properties");
    // switching back to English
    await waitFor(() =>
      expect(screen.queryByTitle(/^architect$/i)).not.toBeNull(),
    );
  });
});
