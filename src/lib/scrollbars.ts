/**
 * Floating overlay scrollbar. Native vertical scrollbars are hidden in index.css (WebKit never
 * repaints `::-webkit-scrollbar` on hover of the content, so CSS alone can't fade them in).
 * Instead one shared thumb, fixed above everything, follows the scroller under the pointer or the
 * one being scrolled: visible while that content is hovered or scrolling, draggable, takes no space.
 * A scroller can register options via `configureScrollbar` (the timeline: date label, fixed thumb).
 * When the content changes size (pagination, window trimming, images) the thumb does not jump:
 * it keeps its on-screen spot and the difference decays over CORRECTION_MS while scrolling goes on.
 * Dragging is absolute like a native scrollbar: the thumb stays under the pointer and the content
 * follows, so holding it at the top keeps paging older history in.
 */

const IDLE_MS = 900;
const MIN_THUMB = 28;
const INSET = 2;
const CORRECTION_MS = 320;

const scrollable = new WeakMap<Element, boolean>();
const reversed = new WeakMap<Element, boolean>();

export interface ScrollbarOptions {
  /** Text shown beside the thumb while scrolling/dragging (e.g. the date in view). */
  label?: () => string | null;
  /**
   * Constant thumb size. For content of unknown length (a paginated timeline) a proportional
   * thumb would shrink with every loaded page.
   */
  fixedThumb?: boolean;
}

const options = new WeakMap<Element, ScrollbarOptions>();
const FIXED_THUMB = 44;

/** Registers per-scroller options while `el` is mounted; returns the unregister function. */
export function configureScrollbar(el: Element, opts: ScrollbarOptions): () => void {
  options.set(el, opts);
  return () => {
    if (options.get(el) === opts) options.delete(el);
  };
}

function canScrollY(el: Element): boolean {
  let cached = scrollable.get(el);
  if (cached === undefined) {
    const style = getComputedStyle(el);
    // Elements that opt out of scrollbars (e.g. the rail) stay bare.
    cached = /(auto|scroll)/.test(style.overflowY) && style.scrollbarWidth !== 'none';
    scrollable.set(el, cached);
    reversed.set(el, style.flexDirection === 'column-reverse');
  }
  return cached && el.scrollHeight > el.clientHeight + 1;
}

/** Element check that also holds for a chat pop-out's nodes (another window's realm, so no `instanceof`). */
function isElement(target: EventTarget | null): target is HTMLElement {
  return !!target && (target as Node).nodeType === Node.ELEMENT_NODE;
}

function scrollerFor(target: EventTarget | null): HTMLElement | null {
  for (let el = isElement(target) ? target : null; el && el !== el.ownerDocument.body; el = el.parentElement) {
    if (canScrollY(el)) return el;
  }
  return null;
}

/** `html { zoom }` scales both client rects and the thumb's own lengths; undo it once. */
function zoom(doc: Document): number {
  return Number.parseFloat(getComputedStyle(doc.documentElement).zoom) || 1;
}

function geometry(el: HTMLElement) {
  const z = zoom(el.ownerDocument);
  const rect = el.getBoundingClientRect();
  const track = el.clientHeight - INSET * 2;
  const height = options.get(el)?.fixedThumb
    ? Math.min(FIXED_THUMB, track / 2)
    : Math.max(MIN_THUMB, (el.clientHeight / el.scrollHeight) * track);
  return {
    z,
    rect,
    top: rect.top / z + el.clientTop,
    height,
    free: track - height,
    maxScroll: el.scrollHeight - el.clientHeight,
  };
}

/** Scrolls so the thumb sits at `fraction` (0 = top, 1 = bottom) of its track. */
function scrollToFraction(el: HTMLElement, fraction: number) {
  const max = el.scrollHeight - el.clientHeight;
  const pos = fraction * max;
  // Column-reverse scrollers (the timeline) have scrollTop 0 at the bottom, negative above.
  el.scrollTop = reversed.get(el) ? pos - max : pos;
}

/** Installs the overlay scrollbar in `doc`: the main window at startup, each chat pop-out when it opens. */
export function installScrollbarActivity(doc: Document = document): void {
  const view = doc.defaultView ?? window;
  const thumb = doc.createElement('div');
  thumb.className = 'overlay-scrollbar';
  thumb.setAttribute('aria-hidden', 'true');
  const label = doc.createElement('div');
  label.className = 'overlay-scrollbar-label';
  label.setAttribute('aria-hidden', 'true');
  doc.body.append(thumb, label);

  let current: HTMLElement | null = null;
  let hovered: HTMLElement | null = null;
  // Pointer offset inside the thumb at grab time, and the track fraction the pointer holds.
  let dragging: { grab: number; fraction: number } | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  // The label only shows while scrolling, dragging or pointing at the thumb, not on plain hover.
  let scrolling = false;
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  let thumbHovered = false;
  let frame = 0;
  // Last measured scroll height of `current`, to tell content size changes apart from scrolling.
  let lastHeight = 0;
  // Where the thumb was last drawn (offset within the track), and the pending jump being absorbed.
  let lastOffset = 0;
  let correction = 0;
  let correctionAt = 0;
  const resize = new (view as typeof globalThis).ResizeObserver(() => schedule());

  const place = () => {
    frame = 0;
    const el = current;
    if (!el || !el.isConnected || el.scrollHeight <= el.clientHeight + 1) {
      thumb.dataset.visible = 'false';
      label.dataset.visible = 'false';
      return;
    }
    const opts = options.get(el);
    const { z, rect, top, height, free, maxScroll } = geometry(el);
    const changed = lastHeight !== 0 && el.scrollHeight !== lastHeight;
    lastHeight = el.scrollHeight;

    let offset: number;
    if (dragging) {
      // The thumb belongs to the pointer; after a page loads, put the content back under it.
      if (changed) scrollToFraction(el, dragging.fraction);
      correction = 0;
      offset = dragging.fraction * free;
    } else {
      const scrollTop = reversed.get(el) ? maxScroll + el.scrollTop : el.scrollTop;
      const target = maxScroll > 0 ? (scrollTop / maxScroll) * free : 0;
      // Content changed size: start from where the thumb is now and let the gap decay, so a page
      // of history loading mid-scroll is a glide, not a jump. Scrolling keeps moving the target.
      const now = performance.now();
      if (changed) {
        correction = lastOffset - target;
        correctionAt = now;
      }
      const progress = Math.min(1, (now - correctionAt) / CORRECTION_MS);
      const remaining = correction * (1 - progress) ** 3;
      if (progress < 1) schedule();
      else correction = 0;
      offset = Math.min(Math.max(target + remaining, 0), free);
    }
    lastOffset = offset;

    const x = rect.left / z + el.clientLeft + el.clientWidth - thumb.offsetWidth - INSET;
    const y = top + INSET + offset;
    thumb.style.transform = `translate(${x}px, ${y}px)`;
    thumb.style.height = `${height}px`;

    const text = opts?.label?.() ?? null;
    if (text) {
      if (label.textContent !== text) label.textContent = text;
      // Centred on the thumb, but kept inside the scroller's viewport.
      const ly = Math.min(
        Math.max(y + height / 2 - label.offsetHeight / 2, top + INSET),
        top + el.clientHeight - label.offsetHeight - INSET,
      );
      label.style.transform = `translate(${x - label.offsetWidth - 6}px, ${ly}px)`;
    }
    const wanted = scrolling || thumbHovered || !!dragging;
    label.dataset.visible = String(!!text && wanted && thumb.dataset.visible === 'true');
  };

  const schedule = () => {
    if (!frame) frame = view.requestAnimationFrame(place);
  };

  const show = (el: HTMLElement) => {
    if (current !== el) {
      current = el;
      lastHeight = 0;
      correction = 0;
      resize.disconnect();
      resize.observe(el);
      if (el.firstElementChild) resize.observe(el.firstElementChild);
    }
    thumb.dataset.visible = 'true';
    schedule();
  };

  const hideLater = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (dragging || hovered === current) return;
      thumb.dataset.visible = 'false';
      label.dataset.visible = 'false';
    }, IDLE_MS);
  };

  doc.addEventListener(
    'scroll',
    (e) => {
      const el = e.target;
      if (!isElement(el) || !canScrollY(el)) return;
      scrolling = true;
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        scrolling = false;
        schedule();
      }, IDLE_MS);
      show(el);
      if (hovered !== el) hideLater();
    },
    { capture: true, passive: true },
  );

  doc.addEventListener(
    'pointermove',
    (e) => {
      if (dragging || e.target === thumb) return;
      const el = scrollerFor(e.target);
      if (el === hovered) {
        if (el) schedule();
        return;
      }
      hovered = el;
      if (el) show(el);
      else hideLater();
    },
    { passive: true },
  );

  doc.documentElement.addEventListener('pointerleave', () => {
    hovered = null;
    hideLater();
  });

  view.addEventListener('resize', schedule, { passive: true });

  thumb.addEventListener('pointerenter', () => {
    thumbHovered = true;
    schedule();
  });
  thumb.addEventListener('pointerleave', () => {
    thumbHovered = false;
    schedule();
  });

  thumb.addEventListener('pointerdown', (e) => {
    const el = current;
    if (!el || e.button !== 0) return;
    e.preventDefault();
    thumb.setPointerCapture(e.pointerId);
    const { z, top, free } = geometry(el);
    const grab = e.clientY / z - (top + INSET + lastOffset);
    dragging = { grab, fraction: free > 0 ? lastOffset / free : 0 };
    thumb.dataset.dragging = 'true';
    label.dataset.dragging = 'true';
  });

  thumb.addEventListener('pointermove', (e) => {
    const el = current;
    if (!dragging || !el) return;
    const { z, top, free } = geometry(el);
    const offset = e.clientY / z - dragging.grab - (top + INSET);
    dragging.fraction = free > 0 ? Math.min(Math.max(offset / free, 0), 1) : 0;
    scrollToFraction(el, dragging.fraction);
    schedule();
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = null;
    delete thumb.dataset.dragging;
    delete label.dataset.dragging;
    schedule();
    hideLater();
  };
  thumb.addEventListener('pointerup', endDrag);
  thumb.addEventListener('pointercancel', endDrag);
}
