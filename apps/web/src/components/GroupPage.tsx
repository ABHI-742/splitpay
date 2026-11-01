import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, formatMoney, type User } from '../api';
import { ExpenseForm } from './ExpenseForm';
import { RecurringPanel } from './RecurringPanel';

export function GroupPage({ groupId, me }: { groupId: string; me: User }) {
  const queryClient = useQueryClient();
  const { data: group, error } = useQuery({ queryKey: ['group', groupId], queryFn: () => api.group(groupId) });
  const { data: expenses } = useQuery({ queryKey: ['group', groupId, 'expenses'], queryFn: () => api.expenses(groupId) });
  const { data: activity } = useQuery({ queryKey: ['group', groupId, 'activity'], queryFn: () => api.activity(groupId) });
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const status = new URLSearchParams(window.location.search).get('status');

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['group', groupId] });
  const pay = useMutation({
    mutationFn: ({ toUserId, amountMinor }: { toUserId: string; amountMinor: number }) =>
      api.checkout(groupId, toUserId, amountMinor),
    onSuccess: ({ checkoutUrl }) => window.location.assign(checkoutUrl),
  });
  const cash = useMutation({
    mutationFn: ({ fromUserId, amountMinor }: { fromUserId: string; amountMinor: number }) =>
      api.recordCash(groupId, fromUserId, amountMinor),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: (expenseId: string) => api.deleteExpense(groupId, expenseId), onSuccess: refresh });

  if (error) return <p className="error">{(error as Error).message}</p>;
  if (!group) return <p className="muted">Loading…</p>;

  const name = (id: string) => (id === me.id ? 'You' : group.members.find((m) => m.id === id)?.name ?? 'Former member');
  const money = (minor: number) => formatMoney(minor, group.currency);
  const isOwner = group.members.find((m) => m.id === me.id)?.role === 'OWNER';

  async function invite() {
    const { token } = await api.createInvite(groupId);
    const link = `${window.location.origin}/invite/${token}`;
    setInviteLink(link);
    await navigator.clipboard?.writeText(link).catch(() => undefined);
  }

  return (
    <section>
      <h2>{group.name}</h2>
      {status === 'success' && <p className="notice">Payment received by Stripe. Balances update as soon as it is confirmed.</p>}
      {status === 'cancelled' && <p className="notice">Payment cancelled. Nothing was charged.</p>}

      <div className="columns">
        <div>
          <div className="card">
            <h3>Balances</h3>
            <ul className="balances">
              {group.balances.map((b) => (
                <li key={b.userId}>
                  <span>{name(b.userId)}</span>
                  <span className={b.amountMinor > 0 ? 'positive' : b.amountMinor < 0 ? 'negative' : 'muted'}>
                    {b.amountMinor === 0 ? 'settled' : b.amountMinor > 0 ? `gets back ${money(b.amountMinor)}` : `owes ${money(-b.amountMinor)}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h3>Settle up</h3>
            {group.suggestedTransfers.length === 0 && <p className="muted">Everyone is settled.</p>}
            <ul className="transfers">
              {group.suggestedTransfers.map((t) => (
                <li key={`${t.fromUserId}-${t.toUserId}`}>
                  <span>
                    {name(t.fromUserId)} → {name(t.toUserId)}: <strong>{money(t.amountMinor)}</strong>
                  </span>
                  {t.fromUserId === me.id && (
                    <button type="button" onClick={() => pay.mutate(t)} disabled={pay.isPending}>
                      Pay with card
                    </button>
                  )}
                  {t.toUserId === me.id && (
                    <button type="button" className="secondary" onClick={() => cash.mutate(t)} disabled={cash.isPending}>
                      Mark cash received
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {(pay.error || cash.error) && <p className="error">{((pay.error ?? cash.error) as Error).message}</p>}
            <p className="muted small">Card payments use Stripe test mode. Use card 4242 4242 4242 4242.</p>
          </div>

          <div className="card">
            <h3>Members</h3>
            <ul>
              {group.members.map((m) => (
                <li key={m.id}>
                  {m.name} <span className="muted small">{m.role === 'OWNER' ? 'owner' : ''}</span>
                </li>
              ))}
            </ul>
            <button type="button" className="secondary" onClick={invite}>
              Create invite link
            </button>
            {inviteLink && (
              <p className="small">
                Copied: <code>{inviteLink}</code>
              </p>
            )}
          </div>
        </div>

        <div>
          <ExpenseForm group={group} me={me} onAdded={refresh} />
          <div className="card">
            <h3>Expenses</h3>
            {expenses?.items.length === 0 && <p className="muted">No expenses yet.</p>}
            <ul className="expenses">
              {expenses?.items.map((e) => (
                <li key={e.id}>
                  <div>
                    <strong>{e.description}</strong>
                    <div className="muted small">
                      {name(e.paidById)} paid {money(e.amountMinor)} · {e.incurredOn.slice(0, 10)} · {e.splitMethod.toLowerCase()}
                    </div>
                  </div>
                  {(e.paidById === me.id || isOwner) && (
                    <button type="button" className="link" onClick={() => remove.mutate(e.id)}>
                      Delete
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <RecurringPanel group={group} me={me} />
          <div className="card">
            <h3>Activity</h3>
            <ul className="activity">
              {activity?.map((a) => (
                <li key={a.id}>
                  <span className="muted small">{new Date(a.at).toLocaleString()}</span> {a.actor.name}{' '}
                  {a.type.replace('.', ' ')}
                  {typeof a.payload.description === 'string' ? `: ${a.payload.description}` : ''}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
