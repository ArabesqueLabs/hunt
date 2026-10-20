// The sidebar's menu under the md breakpoint: a disclosure (js/nav-menu.js).
// The sections and the foot stay in the page at every width; under md, CSS
// shows them only while the menu button's aria-expanded is true.

import { wireNavMenu } from "./nav-menu.js";

/** Wire every `.al-sidebar`'s `[data-sidebar-menu-toggle]` to the menu it controls. */
export function initSidebars(root = document) {
  for (const button of root.querySelectorAll(".al-sidebar [data-sidebar-menu-toggle]")) {
    if (button.dataset.alWired !== undefined) continue;
    button.dataset.alWired = "";
    const menu = document.getElementById(button.getAttribute("aria-controls"));
    if (menu) wireNavMenu(button, menu);
  }
}
