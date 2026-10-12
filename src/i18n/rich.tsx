import { Fragment, type ReactNode } from 'react';
import { type MessageKey, template } from './index';

/**
 * Like `t()`, but placeholders may be React nodes (bold names, <kbd>, links):
 * `tn('composer.replyTo', { name: <b>{name}</b> })`.
 */
export function tn(key: MessageKey, params: Record<string, ReactNode>): ReactNode {
  const count = typeof params.count === 'number' ? params.count : undefined;
  const parts = template(key, count).split(/\{(\w+)\}/g);
  // split() with a capture group alternates text, name, text, name, …
  return parts.map((part, i) =>
    i % 2 === 0 ? part : <Fragment key={i}>{part in params ? params[part] : `{${part}}`}</Fragment>,
  );
}
