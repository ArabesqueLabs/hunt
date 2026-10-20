// Place a floating element (a menu, a tooltip) next to what it belongs to,
// on the side text starts from, flipping above or inward if it won't fit.
export function place(floating, anchor, { side = "below", gap = 6 } = {}) {
  const r = anchor.getBoundingClientRect();
  const f = floating.getBoundingClientRect();
  const rtl = getComputedStyle(anchor).direction === "rtl";
  // The viewport without its scrollbar, so nothing lands under it.
  const width = document.documentElement.clientWidth;
  const height = document.documentElement.clientHeight;
  let top = side === "above" ? r.top - f.height - gap : r.bottom + gap;
  if (side === "below" && top + f.height > height - 8) top = r.top - f.height - gap;
  if (side === "above" && top < 8) top = r.bottom + gap;
  let left = side === "above" ? r.left + r.width / 2 - f.width / 2 : rtl ? r.right - f.width : r.left;
  left = Math.min(Math.max(8, left), width - f.width - 8);
  floating.style.position = "fixed";
  floating.style.top = `${Math.max(8, top)}px`;
  floating.style.left = `${left}px`;
}
