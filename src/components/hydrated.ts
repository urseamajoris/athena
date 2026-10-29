import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
/** False on the server and during hydration, true afterwards: for markup that depends on the viewport or on
 *  browser-only state, which the server cannot know. */
export function useHydrated() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
