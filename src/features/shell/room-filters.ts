import { getLocale, t } from '@/i18n';
import type { RoomSummary } from '@/matrix/rooms-store';
import type { View } from '@/store/ui';

/** Rooms belonging to the rail selection, before sectioning. */
export function roomsForView(
  rooms: Record<string, RoomSummary>,
  view: View,
  accountId: string | null | undefined,
): RoomSummary[] {
  const all = Object.values(rooms).filter((r) => !r.isBotRoom);
  switch (view.kind) {
    case 'all':
      return all;
    case 'matrix':
      return all.filter((r) => !r.bridge);
    case 'network':
      return all.filter(
        (r) => r.bridge?.networkId === view.networkId && (!accountId || !r.accountId || r.accountId === accountId),
      );
    case 'space':
      return all.filter((r) => r.spaceIds.includes(view.spaceId));
  }
}

export interface Section {
  key: string;
  title: string;
  rooms: RoomSummary[];
  defaultCollapsed?: boolean;
}

const byRecent = (a: RoomSummary, b: RoomSummary) => b.lastTs - a.lastTs;

export function isRoomUnread(r: RoomSummary): boolean {
  return r.isUnread || r.unreadCount > 0 || r.highlightCount > 0 || r.membership === 'invite';
}

/**
 * Slack-style sections: invites and message requests first, favourites, then
 * per-subgroup sections (Discord servers, Slack workspaces), direct messages,
 * groups and finally low priority. Every section is sorted by recent activity.
 */
export function buildSections(rooms: RoomSummary[], unreadOnly: boolean): Section[] {
  const list = (unreadOnly ? rooms.filter(isRoomUnread) : rooms).slice().sort(byRecent);
  const invites: RoomSummary[] = [];
  const requests: RoomSummary[] = [];
  const favourites: RoomSummary[] = [];
  const dms: RoomSummary[] = [];
  const groups: RoomSummary[] = [];
  const low: RoomSummary[] = [];
  const subgroups = new Map<string, Section>();

  for (const r of list) {
    if (r.membership === 'invite') invites.push(r);
    else if (r.bridge?.messageRequest) requests.push(r);
    else if (r.favourite) favourites.push(r);
    else if (r.lowPriority) low.push(r);
    else if (r.isDm) dms.push(r);
    else if (r.bridge?.group) {
      const key = `group:${r.bridge.networkId}:${r.bridge.group.id}`;
      let section = subgroups.get(key);
      if (!section) {
        section = { key, title: r.bridge.group.name, rooms: [] };
        subgroups.set(key, section);
      }
      section.rooms.push(r);
    } else groups.push(r);
  }

  const sections: Section[] = [
    { key: 'invites', title: t('shell.sectionInvites'), rooms: invites },
    { key: 'requests', title: t('shell.sectionRequests'), rooms: requests },
    { key: 'favourites', title: t('shell.sectionFavourites'), rooms: favourites },
    { key: 'dms', title: t('shell.sectionDms'), rooms: dms },
    { key: 'groups', title: t('shell.sectionGroups'), rooms: groups },
    ...[...subgroups.values()].sort((a, b) => a.title.localeCompare(b.title, getLocale())),
    { key: 'low', title: t('shell.sectionLowPriority'), rooms: low, defaultCollapsed: true },
  ];
  return sections.filter((s) => s.rooms.length > 0);
}

export function unreadTotals(rooms: RoomSummary[]): { unread: boolean; highlight: number } {
  let unread = false;
  let highlight = 0;
  for (const r of rooms) {
    if (r.notifyLevel === 'mute') continue;
    if (isRoomUnread(r)) unread = true;
    // DMs count fully, like mentions: every DM message is addressed to you.
    highlight += r.isDm ? r.unreadCount : r.highlightCount;
    if (r.membership === 'invite') highlight += 1;
  }
  return { unread, highlight };
}
