// Shared to hunt from another app (a posting's link, some text): the
// share screen, which reads what was shared.

import { getShareExtensionKey } from "expo-share-intent";

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (path.includes(`dataUrl=${getShareExtensionKey()}`)) return "/share";
    return path;
  } catch {
    return "/";
  }
}
