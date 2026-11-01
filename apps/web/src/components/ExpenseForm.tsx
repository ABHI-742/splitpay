import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, type GroupDetail, type Split, type User } from '../api';

type Method = Split['method'];

const toMinor = (value: string) => Math.round(Number(value) * 100);

export function ExpenseForm({ group, me, onAdded }: { group: GroupDetail; me: User; onAdded: () => void }) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidById, setPaidById] = useState(me.id);
  const [method, setMethod] = useState<Method>('EQUAL');
  const [included, setIncluded] = useState<Set<string>>(new Set(group.members.map((m) => m.id)));
  const [values, setValues] = useState<Record<string, string>>({});
  // New key per form submission so a double click or network retry can't create two expenses.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const add = useMutation({
    mutationFn: () => {
      const members = group.members.filter((m) => included.has(m.id));
      const value = (id: string) => values[id] ?? '';
      let split: Split;
      if (method === 'EQUAL') split = { method, userIds: members.map((m) => m.id) };
      else if (method === 'EXACT') split = { method, amounts: members.map((m) => ({ userId: m.id, amountMinor: toMinor(value(m.id)) })) };
      else if (method === 'PERCENTAGE') split = { method, percents: members.map((m) => ({ userId: m.id, percent: Number(value(m.id)) })) };
      else split = { method, shares: members.map((m) => ({ userId: m.id, shares: Number(value(m.id)) || 1 })) };
      return api.addExpense(group.id, {
        description,
        amountMinor: toMinor(amount),
        paidById,
        incurredOn: new Date().toISOString().slice(0, 10),
        split,
        idempotencyKey,
      });
    },
    onSuccess: () => {
      setDescription('');
      setAmount('');
      setValues({});
      setIdempotencyKey(crypto.randomUUID());
      onAdded();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    add.mutate();
  }

  const placeholder = { EQUAL: '', EXACT: '0.00', PERCENTAGE: '%', SHARES: 'shares' }[method];

  return (
    <form className="card" onSubmit={submit}>
      <h3>Add an expense</h3>
      <div className="row">
        <input placeholder="What was it for?" value={description} onChange={(e) => setDescription(e.target.value)} required />
        <input
          placeholder="Amount"
          type="number"
          min="0.01"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </div>
      <div className="row">
        <label>
          Paid by
          <select value={paidById} onChange={(e) => setPaidById(e.target.value)}>
            {group.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === me.id ? 'You' : m.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Split
          <select value={method} onChange={(e) => setMethod(e.target.value as Method)}>
            <option value="EQUAL">Equally</option>
            <option value="EXACT">By exact amounts</option>
            <option value="PERCENTAGE">By percentage</option>
            <option value="SHARES">By shares</option>
          </select>
        </label>
      </div>
      <ul className="split-list">
        {group.members.map((m) => (
          <li key={m.id}>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={included.has(m.id)}
                onChange={(e) => {
                  const next = new Set(included);
                  if (e.target.checked) next.add(m.id);
                  else next.delete(m.id);
                  setIncluded(next);
                }}
              />
              {m.id === me.id ? 'You' : m.name}
            </label>
            {method !== 'EQUAL' && included.has(m.id) && (
              <input
                className="small-input"
                type="number"
                step="any"
                placeholder={placeholder}
                value={values[m.id] ?? ''}
                onChange={(e) => setValues({ ...values, [m.id]: e.target.value })}
              />
            )}
          </li>
        ))}
      </ul>
      {add.error && <p className="error">{(add.error as Error).message}</p>}
      <button type="submit" disabled={add.isPending || included.size === 0}>
        Add expense
      </button>
    </form>
  );
}
