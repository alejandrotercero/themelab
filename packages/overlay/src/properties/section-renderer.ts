import type { PropertyDescriptor, PropertyGroup } from "@react-rewrite/shared";
import type { PropertyControl, OnPreview, OnCommit, ControlContext } from "./controls/types.js";
import { createNumberScrub } from "./controls/number-scrub.js";
import { createSegmented } from "./controls/segmented.js";
import { createColorSwatch } from "./controls/color-swatch.js";
import { createBoxModel } from "./controls/box-model.js";
import { PANEL, FONT_MONO, RADII, TRANSITIONS } from "../design-tokens.js";

// Persists collapse state across re-renders and element selections
const collapsedGroups = new Set<string>();

/** Returns true if the given group is currently collapsed in the sidebar. */
export function isGroupCollapsed(group: string): boolean {
  return collapsedGroups.has(group);
}

/** Listeners notified when a section is expanded so deferred values can be read. */
type SectionExpandListener = (group: string) => void;
const expandListeners: SectionExpandListener[] = [];

/** Register a callback for when a collapsed section is expanded. */
export function onSectionExpand(fn: SectionExpandListener): () => void {
  expandListeners.push(fn);
  return () => {
    const idx = expandListeners.indexOf(fn);
    if (idx >= 0) expandListeners.splice(idx, 1);
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GROUP_LABELS: Record<PropertyGroup, string> = {
  layout: "Layout",
  spacing: "Spacing",
  size: "Size",
  typography: "Typography",
  background: "Background",
  border: "Border",
};

type ControlFactory = (
  descriptors: PropertyDescriptor[],
  values: Map<string, string>,
  onPreview: OnPreview,
  onCommit: OnCommit,
  ctx?: ControlContext,
) => PropertyControl;

const CONTROL_FACTORIES: Record<string, ControlFactory> = {
  "number-scrub": createNumberScrub,
  "segmented": createSegmented,
  "color-swatch": createColorSwatch,
  "box-model": createBoxModel,
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const SECTION_STYLES = `
  .prop-sections {
    font-family: ${FONT_MONO};
  }
  .prop-section {
    border-bottom: none;
  }
  .prop-section-header {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: ${PANEL.surface};
    cursor: pointer;
    user-select: none;
    font-family: ${FONT_MONO};
    font-size: 11px;
    font-weight: 400;
    color: ${PANEL.text};
    text-transform: uppercase;
    letter-spacing: 1.1px;
  }
  .prop-section-header:hover .prop-section-chevron {
    color: ${PANEL.text};
  }
  .prop-section-chevron {
    width: 14px;
    height: 14px;
    transition: transform 150ms ease;
    color: ${PANEL.textDim};
  }
  .prop-section-chevron.collapsed {
    transform: rotate(-90deg);
  }
  .prop-section-body {
    padding: 16px 12px;
    display: flex;
    flex-direction: column;
    gap: 15px;
  }
  .prop-section-body.collapsed {
    display: none;
  }
  .prop-input {
    background: ${PANEL.surface};
    border: 1px solid ${PANEL.border};
    border-radius: ${RADII.xs};
    padding: 4px 8px;
    font-family: ${FONT_MONO};
    font-size: 12px;
    color: ${PANEL.text};
    outline: none;
    box-sizing: border-box;
    transition: border-color ${TRANSITIONS.fast}, box-shadow ${TRANSITIONS.fast};
  }
  .prop-input:hover {
    border-color: ${PANEL.btnBorder};
  }
  .prop-input:focus {
    border-color: ${PANEL.accent};
    box-shadow: 0 0 0 2px ${PANEL.focusRing};
  }
  .prop-control-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .prop-control-label {
    width: 80px;
    flex-shrink: 0;
    font-size: 12px;
    font-family: ${FONT_MONO};
    color: ${PANEL.text};
    text-transform: capitalize;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .prop-control-value {
    flex: 1;
    min-width: 0;
  }
  .prop-show-all {
    padding: 12px;
    font-family: ${FONT_MONO};
    font-size: 11px;
    color: ${PANEL.textDim};
    cursor: pointer;
    text-align: center;
    user-select: none;
  }
  .prop-show-all:hover {
    color: ${PANEL.accent};
  }
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createChevronSvg(): string {
  return `<svg class="prop-section-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 4.5 6 7.5 9 4.5"/></svg>`;
}

/**
 * Groups descriptors by their `group` field, maintaining the order they appear
 * in the input array (i.e. the canonical descriptor order).
 */
function groupDescriptors(
  descriptors: PropertyDescriptor[],
): Map<PropertyGroup, PropertyDescriptor[]> {
  const groups = new Map<PropertyGroup, PropertyDescriptor[]>();
  for (const desc of descriptors) {
    let list = groups.get(desc.group);
    if (!list) {
      list = [];
      groups.set(desc.group, list);
    }
    list.push(desc);
  }
  return groups;
}

/**
 * Splits a group's descriptors into individual controls and compound controls.
 * Compound descriptors sharing the same `compoundGroup` are collected into a
 * single entry so the factory receives all of them at once.
 */
function splitCompound(
  descriptors: PropertyDescriptor[],
): Array<{ controlType: string; descriptors: PropertyDescriptor[] }> {
  const result: Array<{ controlType: string; descriptors: PropertyDescriptor[] }> = [];
  const compoundBuckets = new Map<string, PropertyDescriptor[]>();

  for (const desc of descriptors) {
    if (desc.compound && desc.compoundGroup) {
      let bucket = compoundBuckets.get(desc.compoundGroup);
      if (!bucket) {
        bucket = [];
        compoundBuckets.set(desc.compoundGroup, bucket);
      }
      bucket.push(desc);
    } else {
      result.push({ controlType: desc.controlType, descriptors: [desc] });
    }
  }

  // Append compound groups in the order they were first encountered
  for (const [, bucket] of compoundBuckets) {
    result.push({ controlType: bucket[0].controlType, descriptors: bucket });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Flex-specific descriptor keys (only shown when display is flex/inline-flex)
// ---------------------------------------------------------------------------

const FLEX_ONLY_KEYS = new Set(["flexDirection", "justifyContent", "alignItems", "gap"]);

function isFlexDisplay(currentValues: Map<string, string>): boolean {
  const display = currentValues.get("display") ?? "";
  return display === "flex" || display === "inline-flex";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderSections(
  descriptors: PropertyDescriptor[],
  currentValues: Map<string, string>,
  onPreview: OnPreview,
  onCommit: OnCommit,
  onShowAll?: () => void,
  ctx?: ControlContext,
): { container: HTMLElement; controls: PropertyControl[] } {
  const container = document.createElement("div");
  container.className = "prop-sections";

  // Inject styles once
  const style = document.createElement("style");
  style.textContent = SECTION_STYLES;
  container.appendChild(style);

  const allControls: PropertyControl[] = [];
  const grouped = groupDescriptors(descriptors);

  for (const [group, descs] of grouped) {
    // Filter out flex-only descriptors when display is not flex/inline-flex
    const filteredDescs = group === "layout" && !isFlexDisplay(currentValues)
      ? descs.filter(d => !FLEX_ONLY_KEYS.has(d.key))
      : descs;

    if (filteredDescs.length === 0) continue;

    const section = document.createElement("div");
    section.className = "prop-section";

    // Header
    const header = document.createElement("div");
    header.className = "prop-section-header";
    header.innerHTML = `<span>${GROUP_LABELS[group]}</span>${createChevronSvg()}`;

    const body = document.createElement("div");
    body.className = "prop-section-body";

    let collapsed = collapsedGroups.has(group);
    if (collapsed) {
      const chevron = header.querySelector(".prop-section-chevron");
      if (chevron) chevron.classList.add("collapsed");
      body.classList.add("collapsed");
    }

    header.addEventListener("click", () => {
      collapsed = !collapsed;
      if (collapsed) {
        collapsedGroups.add(group);
      } else {
        collapsedGroups.delete(group);
        // Notify listeners so deferred values can be read
        for (const fn of expandListeners) fn(group);
      }
      const chevron = header.querySelector(".prop-section-chevron");
      if (chevron) {
        chevron.classList.toggle("collapsed", collapsed);
      }
      body.classList.toggle("collapsed", collapsed);
    });

    section.appendChild(header);

    // Controls
    const entries = splitCompound(filteredDescs);
    for (const entry of entries) {
      const factory = CONTROL_FACTORIES[entry.controlType];
      if (!factory) continue;

      const control = factory(entry.descriptors, currentValues, onPreview, onCommit, ctx);

      // Compound controls (box-model) have their own layout — no label wrapper
      if (entry.descriptors.length > 1 || entry.controlType === "box-model") {
        body.appendChild(control.element);
      } else {
        const row = document.createElement("div");
        row.className = "prop-control-row";

        const label = document.createElement("span");
        label.className = "prop-control-label";
        label.textContent = entry.descriptors[0].label;
        label.title = entry.descriptors[0].label;

        const valueWrap = document.createElement("div");
        valueWrap.className = "prop-control-value";
        valueWrap.appendChild(control.element);

        row.appendChild(label);
        row.appendChild(valueWrap);
        body.appendChild(row);
      }

      allControls.push(control);
    }

    section.appendChild(body);
    container.appendChild(section);
  }

  if (onShowAll) {
    const showAllLink = document.createElement("div");
    showAllLink.className = "prop-show-all";
    showAllLink.textContent = "Show all properties";
    showAllLink.addEventListener("click", onShowAll);
    container.appendChild(showAllLink);
  }

  return { container, controls: allControls };
}
