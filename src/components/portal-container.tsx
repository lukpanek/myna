import { createContext, useContext } from 'react';

/**
 * Where Radix portals (menus, dialogs, tooltips) mount. Unset = the main
 * document's body; a chat pop-out window points it at its own body, otherwise
 * its menus would open in the main window.
 */
export const PortalContainerContext = createContext<HTMLElement | undefined>(undefined);

export function usePortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainerContext);
}
