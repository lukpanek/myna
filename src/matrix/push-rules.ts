import {
  ConditionKind,
  type IPushRule,
  type MatrixClient,
  PushRuleActionName,
  PushRuleKind,
  TweakName,
} from 'matrix-js-sdk';
import { type MessageKey, t } from '@/i18n';

/**
 * Per-room notification level, stored as standard Matrix push rules so it syncs
 * to every client (and to push on phones):
 *  - `all`:      room rule with notify + sound
 *  - `mentions`: room rule with no actions (only mentions/keywords notify)
 *  - `mute`:     override rule with no actions
 *  - `default`:  no room-specific rule; account defaults and app network defaults apply
 */
export type NotifyLevel = 'default' | 'all' | 'mentions' | 'mute';

function findRule(rules: IPushRule[] | undefined, roomId: string): IPushRule | undefined {
  return rules?.find((r) => r.rule_id === roomId);
}

function isMuteRule(rule: IPushRule, roomId: string): boolean {
  if (!rule.enabled) return false;
  const conds = rule.conditions ?? [];
  const onlyThisRoom =
    conds.length === 1 &&
    conds[0].kind === ConditionKind.EventMatch &&
    conds[0].key === 'room_id' &&
    conds[0].pattern === roomId;
  return onlyThisRoom && !rule.actions.includes(PushRuleActionName.Notify);
}

export function getNotifyLevel(client: MatrixClient, roomId: string): NotifyLevel {
  const global = client.pushRules?.global;
  const override = findRule(global?.override, roomId);
  if (override && isMuteRule(override, roomId)) return 'mute';
  const roomRule = findRule(global?.room, roomId);
  if (roomRule?.enabled) {
    return roomRule.actions.includes(PushRuleActionName.Notify) ? 'all' : 'mentions';
  }
  return 'default';
}

async function deleteIfExists(client: MatrixClient, kind: PushRuleKind, roomId: string, rules?: IPushRule[]) {
  if (findRule(rules, roomId)) await client.deletePushRule('global', kind, roomId);
}

export async function setNotifyLevel(client: MatrixClient, roomId: string, level: NotifyLevel): Promise<void> {
  const global = client.pushRules?.global;
  await deleteIfExists(client, PushRuleKind.Override, roomId, global?.override);
  await deleteIfExists(client, PushRuleKind.RoomSpecific, roomId, global?.room);

  if (level === 'mute') {
    await client.addPushRule('global', PushRuleKind.Override, roomId, {
      conditions: [{ kind: ConditionKind.EventMatch, key: 'room_id', pattern: roomId }],
      actions: [],
    });
  } else if (level === 'mentions') {
    await client.addPushRule('global', PushRuleKind.RoomSpecific, roomId, { actions: [] });
  } else if (level === 'all') {
    await client.addPushRule('global', PushRuleKind.RoomSpecific, roomId, {
      actions: [PushRuleActionName.Notify, { set_tweak: TweakName.Sound, value: 'default' }],
    });
  }
}

export const NOTIFY_LEVELS: NotifyLevel[] = ['default', 'all', 'mentions', 'mute'];

const NOTIFY_LEVEL_KEYS: Record<NotifyLevel, MessageKey> = {
  default: 'matrix.notifyDefault',
  all: 'matrix.notifyAll',
  mentions: 'matrix.notifyMentions',
  mute: 'matrix.notifyMute',
};

/** Translated label of a per-room notification level. */
export function notifyLevelLabel(level: NotifyLevel): string {
  return t(NOTIFY_LEVEL_KEYS[level]);
}
