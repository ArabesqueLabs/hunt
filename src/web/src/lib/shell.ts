// What pages tell the shell around them: the sections Settings and the
// admin centre put in the sidebar, and whether there's an offer to
// celebrate (its link in the sidebar).

import { S, createStore } from "./state";

/** A page's sections, in the sidebar in place of the app's. */
export interface SectionNav { label: string; base: string; tabs: [string, string, string, string][]; tab: string }
export const sectionNav = createStore<SectionNav | null>(null);

/** An accepted offer's process, while there's one to celebrate. */
export const offerNav = createStore<boolean>(false);

/** The page's own title, as index.html has it. */
const PAGE_TITLE = document.title;

/** The page's title, for pages that put theirs first: this hunt's name, where its admins gave one. */
export const baseTitle = () => S.META?.about?.name || PAGE_TITLE;
