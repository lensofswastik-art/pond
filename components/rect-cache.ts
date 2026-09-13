export interface RectCache {
  /** Latest bounding rect of the observed element, updated on resize/scroll. */
  readonly current: DOMRect;
  /** Stop observing and release listeners. */
  destroy: () => void;
}

/**
 * Caches an element's bounding rect so hot paths (e.g. pointermove) can read
 * `.current` instead of calling getBoundingClientRect() every event.
 */
export function createRectCache(element: Element): RectCache {
  let rect = element.getBoundingClientRect();

  function update() {
    rect = element.getBoundingClientRect();
  }

  const observer = new ResizeObserver(update);
  observer.observe(element);
  window.addEventListener("scroll", update, { passive: true, capture: true });
  window.addEventListener("resize", update, { passive: true });

  return {
    get current() {
      return rect;
    },
    destroy() {
      observer.disconnect();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    },
  };
}
