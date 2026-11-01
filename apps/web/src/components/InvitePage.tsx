import { useMutation } from '@tanstack/react-query';
import { api } from '../api';
import { joinGroupRoom } from '../realtime';
import { navigate } from '../router';

export function InvitePage({ token }: { token: string }) {
  const accept = useMutation({
    mutationFn: () => api.acceptInvite(token),
    onSuccess: ({ groupId }) => {
      joinGroupRoom(groupId);
      navigate(`/groups/${groupId}`);
    },
  });

  return (
    <section className="card narrow">
      <h2>You’ve been invited to a group</h2>
      <p className="muted">Join to see shared expenses and balances.</p>
      {accept.error && <p className="error">{(accept.error as Error).message}</p>}
      <button type="button" onClick={() => accept.mutate()} disabled={accept.isPending}>
        Join group
      </button>
    </section>
  );
}
