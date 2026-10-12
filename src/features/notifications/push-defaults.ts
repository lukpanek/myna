import {
  type IPushRule,
  type MatrixClient,
  type PushRuleAction,
  PushRuleActionName,
  PushRuleKind,
  RuleId,
  TweakName,
} from 'matrix-js-sdk';

/**
 * Account-wide notification defaults, stored in the standard underride push
 * rules so they apply on every device (and to phone push) too.
 */
export type DmDefault = 'all' | 'none';
export type GroupDefault = 'all' | 'mentions';

const DM_RULES = [RuleId.DM, RuleId.EncryptedDM];
const GROUP_RULES = [RuleId.Message, RuleId.EncryptedMessage];

function underride(client: MatrixClient, ruleId: string): IPushRule | undefined {
  return client.pushRules?.global?.underride?.find((r) => r.rule_id === ruleId);
}

function notifies(rule: IPushRule | undefined): boolean {
  return !!rule?.enabled && rule.actions.includes(PushRuleActionName.Notify);
}

export function getDmDefault(client: MatrixClient): DmDefault {
  return notifies(underride(client, RuleId.DM)) ? 'all' : 'none';
}

export function getGroupDefault(client: MatrixClient): GroupDefault {
  return notifies(underride(client, RuleId.Message)) ? 'all' : 'mentions';
}

async function setRules(client: MatrixClient, ruleIds: string[], actions: PushRuleAction[]) {
  for (const ruleId of ruleIds) {
    const rule = underride(client, ruleId);
    if (!rule) continue;
    await client.setPushRuleActions('global', PushRuleKind.Underride, ruleId, actions);
    if (!rule.enabled) await client.setPushRuleEnabled('global', PushRuleKind.Underride, ruleId, true);
  }
}

export function setDmDefault(client: MatrixClient, value: DmDefault): Promise<void> {
  return setRules(
    client,
    DM_RULES,
    value === 'all' ? [PushRuleActionName.Notify, { set_tweak: TweakName.Sound, value: 'default' }] : [],
  );
}

export function setGroupDefault(client: MatrixClient, value: GroupDefault): Promise<void> {
  // Mentions and keywords keep notifying through their own (override/content) rules.
  return setRules(client, GROUP_RULES, value === 'all' ? [PushRuleActionName.Notify] : []);
}

/** User-defined keyword rules (content rules that are not server defaults). */
export function getKeywordRules(client: MatrixClient): IPushRule[] {
  return (client.pushRules?.global?.content ?? []).filter((r) => !r.default && r.pattern);
}

export async function addKeyword(client: MatrixClient, keyword: string): Promise<void> {
  const pattern = keyword.trim();
  if (!pattern) return;
  await client.addPushRule('global', PushRuleKind.ContentSpecific, pattern, {
    pattern,
    actions: [
      PushRuleActionName.Notify,
      { set_tweak: TweakName.Sound, value: 'default' },
      { set_tweak: TweakName.Highlight },
    ],
  });
}

export function removeKeyword(client: MatrixClient, ruleId: string): Promise<unknown> {
  return client.deletePushRule('global', PushRuleKind.ContentSpecific, ruleId);
}
