import type { MatrixClient } from 'matrix-js-sdk';
import { createContext, useContext, useEffect, useRef } from 'react';
import { t } from '@/i18n';

const MatrixContext = createContext<MatrixClient | null>(null);

export const MatrixProvider = MatrixContext.Provider;

/** The running client. Only valid inside the logged-in app shell. */
export function useMatrixClient(): MatrixClient {
  const client = useContext(MatrixContext);
  if (!client) throw new Error(t('matrix.clientNotConnected'));
  return client;
}

interface Emitter {
  on(event: string, handler: (...args: never[]) => void): unknown;
  off(event: string, handler: (...args: never[]) => void): unknown;
}

/**
 * Subscribes to an SDK event emitter for the component's lifetime.
 * The handler may change between renders without resubscribing.
 */
export function useEmitterEvent<A extends unknown[]>(
  emitter: unknown,
  event: string,
  handler: (...args: A) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    const target = emitter as Emitter | null | undefined;
    if (!target) return;
    const fn = (...args: A) => handlerRef.current(...args);
    target.on(event, fn as unknown as (...args: never[]) => void);
    return () => {
      target.off(event, fn as unknown as (...args: never[]) => void);
    };
  }, [emitter, event]);
}
