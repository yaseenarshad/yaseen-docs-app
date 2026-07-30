import { Tabs as RadixTabs } from "radix-ui";

import type { SidebarTabName } from "../../types";

export const SidebarTab = ({
  tab,
  children,
  style,
  ...rest
}: {
  tab: SidebarTabName;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <RadixTabs.Content
      {...rest}
      value={tab}
      data-testid={tab}
      style={{ ...style, minHeight: 0 }}
    >
      {children}
    </RadixTabs.Content>
  );
};
SidebarTab.displayName = "SidebarTab";
