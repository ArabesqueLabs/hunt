// A chart's marks from the keyboard: one tab stop for the whole chart, and
// the arrow keys move from mark to mark (along the reading direction, so
// reversed in right-to-left); Home and End jump to the ends. Each mark is
// role="img" with its value and what it is as its name, so focusing one
// says it; the tooltip shows the same.
//
//   <span class="al-chart__bar" data-series="1" role="img" aria-label="£120,900 Offer A, Year 1"
//         data-al-tip="£120,900|Offer A, Year 1"></span>
//   initChartKeys(chartElement);

export function initChartKeys(chart, { marks = "[data-al-tip]" } = {}) {
  const list = () => [...chart.querySelectorAll(marks)];
  const all = list();
  all.forEach((m, i) => { m.tabIndex = i === 0 ? 0 : -1; });
  if (chart.dataset.alChartKeys) return;
  chart.dataset.alChartKeys = "on";
  chart.addEventListener("keydown", (e) => {
    const items = list();
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    const rtl = getComputedStyle(chart).direction === "rtl";
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: 1, ArrowUp: -1 }[e.key];
    let next = null;
    if (step) next = items[Math.min(items.length - 1, Math.max(0, i + step))];
    else if (e.key === "Home") next = items[0];
    else if (e.key === "End") next = items[items.length - 1];
    if (!next) return;
    e.preventDefault();
    for (const m of items) m.tabIndex = m === next ? 0 : -1;
    next.focus();
  });
}
