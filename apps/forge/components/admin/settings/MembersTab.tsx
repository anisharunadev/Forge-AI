'use client';

/**
 * Settings — Members tab.
 *
 * Two stacked tables: active members and pending invitations. The
 * "Invite member" header button opens the `InviteMemberDialog`.
 *
 * Status pills are powered by the `StatusPill` shell primitive so
 * tone is consistent with the rest of the app.
 */

import * as React from 'react';
import { UserPlus, Users, Mail } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill, SectionCard, EmptyState } from '@/components/shell';
import { DataTable } from '@/components/data';

import {
  useMembers,
  useRemoveMember,
  useUpdateMemberRole,
  useRoles,
} from '@/lib/hooks/useSettings';
import { useToast } from '@/hooks/use-toast';
import type { Invitation, Member } from '@/lib/settings/types';
import { InviteMemberDialog } from './InviteMemberDialog';

const memberColumns: ReadonlyArray<ColumnDef<Member>> = [
  {
    accessorKey: 'displayName',
    header: 'Name',
    cell: ({ row }) => {
      const m = row.original;
      return m.displayName || m.email;
    },
  },
  {
    accessorKey: 'email',
    header: 'Email',
  },
  {
    accessorKey: 'roleName',
    header: 'Role',
    cell: ({ row }) => (
      <StatusPill
        tone={row.original.status === 'active' ? 'success' : 'idle'}
        label={row.original.roleName}
      />
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <StatusPill
        tone={row.original.status === 'active' ? 'success' : 'idle'}
        label={row.original.status}
      />
    ),
  },
  {
    accessorKey: 'joinedAt',
    header: 'Joined',
    cell: ({ row }) => new Date(row.original.joinedAt).toLocaleDateString(),
  },
];

const invitationColumns: ReadonlyArray<ColumnDef<Invitation>> = [
  {
    accessorKey: 'email',
    header: 'Email',
    cell: ({ row }) => row.original.email,
  },
  {
    accessorKey: 'roleName',
    header: 'Role',
    cell: ({ row }) => row.original.roleName,
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const tone =
        row.original.status === 'pending'
          ? 'warn'
          : row.original.status === 'accepted'
            ? 'success'
            : row.original.status === 'revoked'
              ? 'danger'
              : 'idle';
      return <StatusPill tone={tone} label={row.original.status} />;
    },
  },
  {
    accessorKey: 'expiresAt',
    header: 'Expires',
    cell: ({ row }) => new Date(row.original.expiresAt).toLocaleDateString(),
  },
];

export function MembersTab() {
  const membersQuery = useMembers();
  const rolesQuery = useRoles();
  const removeMember = useRemoveMember();
  const updateRole = useUpdateMemberRole();
  const { toast } = useToast();
  const [inviteOpen, setInviteOpen] = React.useState(false);

  const data = membersQuery.data;
  const members = data?.members ?? [];
  const invitations = data?.invitations ?? [];

  return (
    <>
      <SectionCard
        title="Members"
        description="People with access to this project."
        headerRight={
          <Button
            onClick={() => setInviteOpen(true)}
            data-testid="members-invite-button"
          >
            <UserPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Invite member
          </Button>
        }
      >
        {membersQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : members.length === 0 ? (
          <EmptyState
            icon={<Users className="h-5 w-5" aria-hidden="true" />}
            title="No members yet"
            description="Invite a developer to start collaborating on this project."
            testId="members-empty"
          />
        ) : (
          <DataTable<Member, unknown>
            data={members}
            columns={[...memberColumns]}
            enableSorting
            getRowId={(row) => row.id}
          />
        )}
      </SectionCard>

      <SectionCard
        title="Invitations"
        description="Pending and historical invitations."
      >
        {membersQuery.isLoading ? (
          <Skeleton className="h-9 w-full" />
        ) : invitations.length === 0 ? (
          <EmptyState
            icon={<Mail className="h-5 w-5" aria-hidden="true" />}
            title="No invitations"
            description="Pending invitations will appear here until accepted."
            testId="invitations-empty"
          />
        ) : (
          <DataTable<Invitation, unknown>
            data={invitations}
            columns={[...invitationColumns]}
            enableSorting
            getRowId={(row) => row.id}
          />
        )}
      </SectionCard>

      <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </>
  );
}
