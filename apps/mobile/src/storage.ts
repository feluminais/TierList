import AsyncStorage from "@react-native-async-storage/async-storage";
import type { TokenStore } from "@tl/app-core";

/**
 * Where this device's anonymous token and its current list id live.
 *
 * `AsyncStorage` rather than `localStorage`: React Native has no DOM, and
 * `useApiClient` awaits its store's reads precisely so this can be the same
 * hook the web uses. On the web export it *is* localStorage underneath, which
 * is why one implementation serves both targets.
 */
export const tokenStore: TokenStore = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
};

/**
 * The list this device was last editing.
 *
 * The web reads this off the route; a phone has no address bar, so the app
 * remembers instead. Without it every cold start would mint a new list and the
 * previous one would only be reachable from the server's own list of them.
 */
export const LIST_ID_KEY = "tl.listId";

export async function rememberListId(id: string): Promise<void> {
  await AsyncStorage.setItem(LIST_ID_KEY, id);
}

export async function lastListId(): Promise<string | null> {
  return AsyncStorage.getItem(LIST_ID_KEY);
}
