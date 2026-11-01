import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '../api';
import { navigate } from '../router';

export function GroupList() {
  const queryClient = useQueryClient();
  const { data: groups } = useQuery({ queryKey: ['groups'], queryFn: api.groups });
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const create = useMutation({
    mutationFn: () => api.createGroup(name, currency),
    onSuccess: (group) => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      navigate(`/groups/${group.id}`);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <section>
      <h2>Your groups</h2>
      {groups?.length === 0 && <p className="muted">No groups yet. Create one or open an invite link.</p>}
      <div className="group-grid">
        {groups?.map((g) => (
          <button key={g.id} type="button" className="card group-card" onClick={() => navigate(`/groups/${g.id}`)}>
            <strong>{g.name}</strong>
            <span className="muted">
              {g.memberCount} member{g.memberCount === 1 ? '' : 's'} · {g.currency}
            </span>
          </button>
        ))}
      </div>
      <form className="card inline-form" onSubmit={submit}>
        <h3>New group</h3>
        <input placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} required />
        <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {['USD', 'EUR', 'GBP', 'INR', 'CAD'].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <button type="submit" disabled={create.isPending}>
          Create
        </button>
        {create.error && <p className="error">{(create.error as Error).message}</p>}
      </form>
    </section>
  );
}
