import type { PropertyDescriptor } from "@react-rewrite/shared";

export interface PropertyControl {
  /** The DOM element to mount in the sidebar */
  element: HTMLElement;
  /** Update the displayed value for a property key */
  setValue(key: string, cssValue: string): void;
  /** Cleanup event listeners */
  destroy(): void;
}

export type OnPreview = (key: string, cssValue: string) => void;
export type OnCommit = () => void;

/** Extra context passed to control factories (currently used by the color
 *  control to detect/offer shadcn theme-variable bindings). */
export interface ControlContext {
  /** className of the currently selected element — lets the color control
   *  detect that a color is bound to a theme token (e.g. `bg-primary`). */
  selectedClassName?: string;
  /** Bind a color property to a theme token, writing e.g. `bg-primary`
   *  instead of a raw color. Editing the token then updates it everywhere. */
  onBindToken?: (key: string, token: string) => void;
  /** Apply a Tailwind palette color, writing the token class (e.g. `bg-red-500`).
   *  `css` is the renderable color for live preview. */
  onPickTailwind?: (key: string, token: string, css: string) => void;
}
