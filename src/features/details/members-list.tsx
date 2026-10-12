import { useVirtualizer } from '@tanstack/react-virtual';
import { Search } from 'lucide-react';
import { type Room, type RoomMember, RoomStateEvent } from 'matrix-js-sdk';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MxAvatar } from '@/components/mx-avatar';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { getLocale, t } from '@/i18n';
import { useRerenderOn } from '@/matrix/hooks';
import { openUserProfile } from '@/store/ui';

/** Above this many members the list is virtualized. */
const VIRTUALIZE_FROM = 100;
const ROW_HEIGHT = 40;

export function roleLabel(member: RoomMember, bridgeBot?: string): string | null {
  if (bridgeBot && member.userId === bridgeBot) return t('details.bridgeBot');
  if (member.powerLevel >= 100) return t('details.roleAdmin');
  if (member.powerLevel >= 50) return t('details.roleModerator');
  return null;
}

export function MembersList({
  room,
  bridgeBot,
  scrollEl,
}: {
  room: Room;
  bridgeBot?: string;
  /** The details panel's scroll container (the list scrolls with the whole panel). */
  scrollEl: HTMLElement | null;
}) {
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  useRerenderOn(room.currentState, RoomStateEvent.Members, RoomStateEvent.NewMember);

  useEffect(() => {
    let alive = true;
    room
      .loadMembersIfNeeded()
      .catch(() => undefined)
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [room]);

  const q = query.trim().toLowerCase();
  const members = room
    .getJoinedMembers()
    .filter((m) => !q || m.name.toLowerCase().includes(q) || m.userId.toLowerCase().includes(q))
    .sort((a, b) => b.powerLevel - a.powerLevel || a.name.localeCompare(b.name, getLocale()));

  return (
    <div className="pb-4">
      <div className="relative px-3 pt-3 pb-2">
        <Search className="pointer-events-none absolute top-1/2 left-5.5 mt-0.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('details.searchMembers')}
          className="h-8 pl-8 text-[13px]"
        />
      </div>
      {!loaded && members.length === 0 ? (
        <div className="space-y-2 px-4 pt-1">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="h-3 w-40" />
            </div>
          ))}
        </div>
      ) : members.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">{t('details.noMembersMatch')}</p>
      ) : members.length > VIRTUALIZE_FROM ? (
        <VirtualMembers members={members} bridgeBot={bridgeBot} scrollEl={scrollEl} />
      ) : (
        members.map((m) => <MemberRow key={m.userId} {...rowProps(m, bridgeBot)} />)
      )}
    </div>
  );
}

function VirtualMembers({
  members,
  bridgeBot,
  scrollEl,
}: {
  members: RoomMember[];
  bridgeBot?: string;
  scrollEl: HTMLElement | null;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  // Distance from the top of the scroll container; the header above the list can change height.
  useLayoutEffect(() => {
    if (listRef.current) setMargin(listRef.current.offsetTop);
  });

  const virtualizer = useVirtualizer({
    count: members.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    scrollMargin: margin,
  });

  return (
    <div ref={listRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => {
        const m = members[item.index];
        return (
          <div
            key={m.userId}
            className="absolute top-0 left-0 w-full"
            style={{ height: item.size, transform: `translateY(${item.start - margin}px)` }}
          >
            <MemberRow {...rowProps(m, bridgeBot)} />
          </div>
        );
      })}
    </div>
  );
}

function rowProps(member: RoomMember, bridgeBot?: string) {
  return {
    userId: member.userId,
    name: member.name,
    avatarMxc: member.getMxcAvatarUrl(),
    role: roleLabel(member, bridgeBot),
  };
}

// Plain props (not the RoomMember object) so memo notices renames and avatar changes.
const MemberRow = memo(function MemberRow({
  userId,
  name,
  avatarMxc,
  role,
}: {
  userId: string;
  name: string;
  avatarMxc?: string;
  role: string | null;
}) {
  return (
    <button
      type="button"
      onClick={() => openUserProfile(userId)}
      className="flex h-10 w-full cursor-pointer items-center gap-2.5 px-4 text-left outline-none hover:bg-accent focus-visible:bg-accent"
      title={userId}
    >
      <MxAvatar mxc={avatarMxc} name={name} seed={userId} size={28} />
      <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
      {role && <span className="shrink-0 text-[12px] text-muted-foreground">{role}</span>}
    </button>
  );
});
