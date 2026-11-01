import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, formatMoney, type GroupDetail, type User } from '../api';

const SCHEDULES = [
  { label: 'Monthly on the 1st', cron: '0 9 1 * *' },
  { label: 'Weekly on Monday', cron: '0 9 * * 1' },
  { label: 'Every day', cron: '0 9 * * *' },
];

export function RecurringPanel({ group, me }: { group: GroupDetail; me: User }) {
  const queryClient = useQueryClient();
  const key = ['group', group.id, 'recurring'];
  const { data: rules } = useQuery({ queryKey: key, queryFn: () => api.recurring(group.id) });
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [cron, setCron] = useState(SCHEDULES[0].cron);

  const add = useMutation({
    mutationFn: () =>
      api.addRecurring(group.id, { description, amountMinor: Math.round(Number(amount) * 100), paidById: me.id, cron }),
    onSuccess: () => {
      setDescription('');
      setAmount('');
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteRecurring(group.id, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    add.mutate();
  }

  const scheduleLabel = (c: string) => SCHEDULES.find((s) => s.cron === c)?.label ?? c;

  return (
    <div className="card">
      <h3>Recurring expenses</h3>
      <p className="muted small">Added automatically and split equally between current members.</p>
      <ul className="expenses">
        {rules?.map((r) => (
          <li key={r.id}>
            <span>
              {r.description} · {formatMoney(r.amountMinor, group.currency)} · {scheduleLabel(r.cron)}
            </span>
            <button type="button" className="link" onClick={() => remove.mutate(r.id)}>
              Stop
            </button>
          </li>
        ))}
      </ul>
      <form className="row" onSubmit={submit}>
        <input placeholder="Rent, internet…" value={description} onChange={(e) => setDescription(e.target.value)} required />
        <input placeholder="Amount" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        <select value={cron} onChange={(e) => setCron(e.target.value)}>
          {SCHEDULES.map((s) => (
            <option key={s.cron} value={s.cron}>
              {s.label}
            </option>
          ))}
        </select>
        <button type="submit" disabled={add.isPending}>
          Add
        </button>
      </form>
      {add.error && <p className="error">{(add.error as Error).message}</p>}
    </div>
  );
}
