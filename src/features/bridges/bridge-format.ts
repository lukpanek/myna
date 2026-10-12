import { t } from '@/i18n';
import type { BridgeState, WhoamiLogin } from './types';

export type LoginStatusKind = 'connected' | 'connecting' | 'relogin' | 'disconnected' | 'error';

export interface LoginStatus {
  kind: LoginStatusKind;
  label: string;
  /** Bridge-provided detail (English, as sent by the bridge). */
  detail?: string;
}

/** Maps a bridgev2 bridge state (status.BridgeStateEvent) to a status pill. */
export function loginStatus(state: BridgeState | undefined): LoginStatus {
  const detail = state?.message || state?.reason || state?.error || undefined;
  if (state?.user_action === 'RELOGIN') return { kind: 'relogin', label: t('bridges.statusRelogin'), detail };
  switch (state?.state_event) {
    case 'CONNECTED':
    case 'BACKFILLING':
      return { kind: 'connected', label: t('bridges.statusConnected') };
    case 'CONNECTING':
    case 'STARTING':
    case 'RUNNING':
      return { kind: 'connecting', label: t('bridges.statusConnecting'), detail };
    case 'TRANSIENT_DISCONNECT':
      return { kind: 'connecting', label: t('bridges.statusTransientDisconnect'), detail };
    case 'BAD_CREDENTIALS':
    case 'LOGGED_OUT':
      return { kind: 'relogin', label: t('bridges.statusRelogin'), detail };
    case 'UNKNOWN_ERROR':
    case 'BRIDGE_UNREACHABLE':
      return { kind: 'error', label: t('bridges.statusError'), detail };
    default:
      return { kind: 'disconnected', label: t('bridges.statusDisconnected'), detail };
  }
}

export function loginDisplayName(login: WhoamiLogin): string {
  return login.profile?.name || login.name || login.profile?.username || login.profile?.phone || login.id;
}

/** Secondary line under the account name: phone, username or e-mail that is not already the name. */
export function loginSecondary(login: WhoamiLogin): string | undefined {
  const name = loginDisplayName(login);
  const p = login.profile;
  const candidates = [p?.phone, p?.username && !p.username.startsWith('@') ? `@${p.username}` : p?.username, p?.email];
  return candidates.find((c) => c && c !== name && c !== `@${name}`) || (login.name !== name ? login.name : undefined);
}

/** Folds case and Czech diacritics for local filtering. */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
