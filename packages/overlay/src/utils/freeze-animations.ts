// packages/overlay/src/utils/freeze-animations.ts
//
// Adapted from react-grab (packages/react-grab/src/utils/freeze-animations.ts),
// trimmed to the element-scoped path. While a component is selected, ThemeLab
// pauses animations within the selected subtree so the target can't animate,
// transition, or move out from under an edit — the highlight rect and any
// subsequent AST edit stay aligned with what the user sees.
//
// Scope note: react-grab freezes the WHOLE page during a momentary "grab".
// ThemeLab's selection is a persistent editing state, so freezing the entire
// page for the whole session would be heavy and surprising (a background video
// or carousel would stall while you edit something unrelated). We freeze only
// the selected element's subtree instead. The global path, GSAP integration,
// and pointer-events freeze from react-grab are intentionally omitted.

const FROZEN_ELEMENT_ATTRIBUTE = "data-themelab-frozen";

const FROZEN_STYLES = `
[${FROZEN_ELEMENT_ATTRIBUTE}],
[${FROZEN_ELEMENT_ATTRIBUTE}] * {
  animation-play-state: paused !important;
  transition: none !important;
}
`;

const SVG_ROOT_SELECTOR = "svg";

let styleElement: HTMLStyleElement | null = null;

const ensureStylesInjected = (): void => {
  if (styleElement && styleElement.isConnected) return;
  styleElement = document.createElement("style");
  styleElement.setAttribute("data-themelab-frozen-styles", "");
  styleElement.textContent = FROZEN_STYLES;
  document.head.appendChild(styleElement);
};

const collectSvgRoots = (elements: Element[]): SVGSVGElement[] => {
  const svgElements = new Set<SVGSVGElement>();
  for (const element of elements) {
    if (element instanceof SVGSVGElement) {
      svgElements.add(element);
    } else if (element instanceof SVGElement && element.ownerSVGElement) {
      svgElements.add(element.ownerSVGElement);
    }
    for (const innerSvg of element.querySelectorAll(SVG_ROOT_SELECTOR)) {
      if (innerSvg instanceof SVGSVGElement) svgElements.add(innerSvg);
    }
  }
  return [...svgElements];
};

const callSvgAnimationMethod = (
  svgElement: SVGSVGElement,
  methodName: "pauseAnimations" | "unpauseAnimations",
): void => {
  const animationMethod = Reflect.get(svgElement, methodName);
  if (typeof animationMethod !== "function") return;
  try {
    animationMethod.call(svgElement);
  } catch {
    // pauseAnimations/unpauseAnimations can throw if the SVG has no timeline
  }
};

const collectRunningWaapiAnimations = (elements: Element[]): Animation[] => {
  const animations: Animation[] = [];
  for (const element of elements) {
    for (const animation of element.getAnimations({ subtree: true })) {
      if (animation.playState === "running") animations.push(animation);
    }
  }
  return animations;
};

const finishAnimations = (animations: Iterable<Animation>): void => {
  for (const animation of animations) {
    try {
      // Advance finite animations to their end so they don't visually jump
      // backward through their timeline when the paused-state rule is removed.
      animation.finish();
    } catch {
      // finish() throws for infinite animations or zero playback rate; for
      // those, resume looping rather than leave them stuck.
      try {
        animation.play();
      } catch {
        // animation was cancelled or its target detached during the freeze
      }
    }
  }
};

/**
 * Pause CSS/WAAPI/SVG animations within the given element subtrees. Returns a
 * release function (idempotent) that resumes them. Re-entrancy is the caller's
 * responsibility: release the previous freeze before starting a new one.
 */
export function freezeAnimations(elements: Element[]): () => void {
  if (elements.length === 0) return () => {};

  ensureStylesInjected();

  for (const element of elements) {
    element.setAttribute(FROZEN_ELEMENT_ATTRIBUTE, "");
  }

  const svgRoots = collectSvgRoots(elements);
  for (const svg of svgRoots) callSvgAnimationMethod(svg, "pauseAnimations");

  const waapiAnimations = collectRunningWaapiAnimations(elements);
  for (const animation of waapiAnimations) {
    try {
      animation.pause();
    } catch {
      // target may have detached between collection and pause
    }
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;

    for (const element of elements) {
      element.removeAttribute(FROZEN_ELEMENT_ATTRIBUTE);
    }
    for (const svg of svgRoots) callSvgAnimationMethod(svg, "unpauseAnimations");
    finishAnimations(waapiAnimations);
  };
}
