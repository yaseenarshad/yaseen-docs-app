import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

import { getOutlineFoldKey } from "./outlineFoldKeys";

import type { Node as ProseNode } from "@milkdown/kit/prose/model";

type OutlineEntry = {
  foldKey: string;
  itemPos: number;
  label: string;
  nestedList: ProseNode;
  nestedListPos: number;
};

type OutlineFoldingState = {
  collapsedItemPositions: ReadonlySet<number>;
};

type OutlineFoldingOptions = {
  initialCollapsedKeys?: ReadonlySet<string>;
  onCollapsedKeysChange?: (keys: readonly string[]) => void;
};

const LIST_NODE_NAMES = new Set(["bullet_list", "ordered_list"]);

const getOutlineEntries = (doc: ProseNode): OutlineEntry[] => {
  const entries: OutlineEntry[] = [];
  const labelOccurrences = new Map<string, number>();

  doc.descendants((node, itemPos) => {
    if (node.type.name !== "list_item") {
      return true;
    }

    let nestedList: ProseNode | null = null;
    let nestedListPos = -1;
    node.forEach((child, offset) => {
      if (!nestedList && LIST_NODE_NAMES.has(child.type.name)) {
        nestedList = child;
        nestedListPos = itemPos + 1 + offset;
      }
    });
    if (!nestedList) {
      return true;
    }

    const label = node.firstChild?.textContent.trim() || "Untitled item";
    const occurrence = labelOccurrences.get(label) ?? 0;
    labelOccurrences.set(label, occurrence + 1);
    entries.push({
      foldKey: getOutlineFoldKey(label, occurrence),
      itemPos,
      label,
      nestedList,
      nestedListPos,
    });
    return true;
  });

  return entries;
};

const getCollapsedKeys = (
  doc: ProseNode,
  collapsedItemPositions: ReadonlySet<number>,
) =>
  getOutlineEntries(doc)
    .filter(({ itemPos }) => collapsedItemPositions.has(itemPos))
    .map(({ foldKey }) => foldKey)
    .sort();

export const createOutlineFolding = ({
  initialCollapsedKeys = new Set(),
  onCollapsedKeysChange,
}: OutlineFoldingOptions = {}) => {
  const pluginKey = new PluginKey<OutlineFoldingState>(
    "yaseendraw-outline-folding",
  );

  return $prose(
    () =>
      new Plugin<OutlineFoldingState>({
        key: pluginKey,
        state: {
          init: (_config, state) => ({
            collapsedItemPositions: new Set(
              getOutlineEntries(state.doc)
                .filter(({ foldKey }) => initialCollapsedKeys.has(foldKey))
                .map(({ itemPos }) => itemPos),
            ),
          }),
          apply: (transaction, previousState, _oldState, newState) => {
            const parentPositions = new Set(
              getOutlineEntries(newState.doc).map(({ itemPos }) => itemPos),
            );
            const collapsedItemPositions = new Set<number>();
            previousState.collapsedItemPositions.forEach((position) => {
              const mappedPosition = transaction.mapping.map(position, 1);
              if (parentPositions.has(mappedPosition)) {
                collapsedItemPositions.add(mappedPosition);
              }
            });

            const toggledPosition = transaction.getMeta(pluginKey) as
              | number
              | undefined;
            if (toggledPosition !== undefined) {
              if (collapsedItemPositions.has(toggledPosition)) {
                collapsedItemPositions.delete(toggledPosition);
              } else if (parentPositions.has(toggledPosition)) {
                collapsedItemPositions.add(toggledPosition);
              }
            }
            return { collapsedItemPositions };
          },
        },
        props: {
          decorations: (state) => {
            const foldingState = pluginKey.getState(state);
            if (!foldingState) {
              return DecorationSet.empty;
            }

            const decorations: Decoration[] = [];
            getOutlineEntries(state.doc).forEach((entry) => {
              const collapsed = foldingState.collapsedItemPositions.has(
                entry.itemPos,
              );
              decorations.push(
                Decoration.widget(
                  entry.itemPos + 1,
                  (view) => {
                    const button = document.createElement("button");
                    button.type = "button";
                    button.className = "yaseendraw-outline-toggle";
                    button.dataset.outlineFoldKey = entry.foldKey;
                    button.setAttribute("aria-expanded", String(!collapsed));
                    button.setAttribute(
                      "aria-label",
                      `${collapsed ? "Expand" : "Collapse"} ${entry.label}`,
                    );
                    button.textContent = collapsed ? "▸" : "▾";
                    button.addEventListener("mousedown", (event) => {
                      event.preventDefault();
                    });
                    button.addEventListener("click", (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      view.dispatch(
                        view.state.tr.setMeta(pluginKey, entry.itemPos),
                      );
                    });
                    return button;
                  },
                  {
                    key: `outline-toggle:${entry.foldKey}:${
                      collapsed ? "collapsed" : "expanded"
                    }`,
                  },
                ),
              );
              if (collapsed) {
                decorations.push(
                  Decoration.node(
                    entry.nestedListPos,
                    entry.nestedListPos + entry.nestedList.nodeSize,
                    { "data-yaseendraw-outline-folded": "true" },
                  ),
                );
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
        view: (view) => {
          let previousKeys = "";
          const notify = () => {
            const foldingState = pluginKey.getState(view.state);
            if (!foldingState || !onCollapsedKeysChange) {
              return;
            }
            const keys = getCollapsedKeys(
              view.state.doc,
              foldingState.collapsedItemPositions,
            );
            const serializedKeys = keys.join("\u0000");
            if (serializedKeys !== previousKeys) {
              previousKeys = serializedKeys;
              onCollapsedKeysChange(keys);
            }
          };
          notify();
          return { update: notify };
        },
      }),
  );
};
