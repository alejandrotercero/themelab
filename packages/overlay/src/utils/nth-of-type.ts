/** Count how many preceding siblings share the same tagName (1-indexed). */
export function computeNthOfType(el: HTMLElement): number {
  const parent = el.parentElement;
  if (!parent) {
    return 1;
  }
  let nth = 1;
  for (const sibling of parent.children) {
    if (sibling === el) {
      break;
    }
    if (sibling.tagName === el.tagName) {
      nth += 1;
    }
  }
  return nth;
}
