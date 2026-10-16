import { createContext, useContext } from 'react';

/** The pop-out window a component renders in; null in the main window. */
export interface PopoutScope {
  roomId: string;
  win: Window;
}

export const PopoutScopeContext = createContext<PopoutScope | null>(null);

export function usePopoutScope(): PopoutScope | null {
  return useContext(PopoutScopeContext);
}

/** Window owning `node` (a pop-out or the main one): its timers and frames keep running when the main window is hidden. */
export function viewOf(node: Node | null | undefined): Window {
  return node?.ownerDocument?.defaultView ?? window;
}
