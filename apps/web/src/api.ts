export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Balance {
  userId: string;
  amountMinor: number;
}

export interface Transfer {
  fromUserId: string;
  toUserId: string;
  amountMinor: number;
}

export interface GroupSummary {
  id: string;
  name: string;
  currency: string;
  memberCount: number;
}

export interface GroupDetail {
  id: string;
  name: string;
  currency: string;
  members: (User & { role: 'OWNER' | 'MEMBER' })[];
  balances: Balance[];
  suggestedTransfers: Transfer[];
}

export interface Expense {
  id: string;
  description: string;
  amountMinor: number;
  paidById: string;
  incurredOn: string;
  splitMethod: string;
  splits: { userId: string; amountMinor: number }[];
}

export interface RecurringExpense {
  id: string;
  description: string;
  amountMinor: number;
  paidById: string;
  cron: string;
}

export interface Activity {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  at: string;
  actor: { id: string; name: string };
}

export type Split =
  | { method: 'EQUAL'; userIds: string[] }
  | { method: 'EXACT'; amounts: { userId: string; amountMinor: number }[] }
  | { method: 'PERCENTAGE'; percents: { userId: string; percent: number }[] }
  | { method: 'SHARES'; shares: { userId: string; shares: number }[] };

const BASE = '/api';
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const getAccessToken = () => accessToken;

/** Uses the httpOnly refresh cookie to get a new access token. One refresh at a time. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (res) => {
      if (!res.ok) return false;
      accessToken = (await res.json()).accessToken;
      return true;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refreshSession()) return request<T>(path, init, false);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.message ?? res.statusText);
  }
  return (res.status === 204 ? undefined : res.json()) as Promise<T>;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

async function startSession(path: string, body: unknown): Promise<User> {
  const result = await post<{ accessToken: string; user: User }>(path, body);
  accessToken = result.accessToken;
  return result.user;
}

export const api = {
  register: (name: string, email: string, password: string) => startSession('/auth/register', { name, email, password }),
  login: (email: string, password: string) => startSession('/auth/login', { email, password }),
  async logout() {
    await post('/auth/logout');
    accessToken = null;
  },
  me: () => request<User>('/auth/me'),

  groups: () => request<GroupSummary[]>('/groups'),
  createGroup: (name: string, currency: string) => post<GroupSummary>('/groups', { name, currency }),
  group: (id: string) => request<GroupDetail>(`/groups/${id}`),
  activity: (id: string) => request<Activity[]>(`/groups/${id}/activity`),
  createInvite: (id: string) => post<{ token: string; expiresAt: string }>(`/groups/${id}/invites`),
  acceptInvite: (token: string) => post<{ groupId: string }>(`/invites/${token}/accept`),

  expenses: (groupId: string) => request<{ items: Expense[]; nextCursor: string | null }>(`/groups/${groupId}/expenses?limit=50`),
  addExpense: (groupId: string, body: { description: string; amountMinor: number; paidById: string; incurredOn: string; split: Split; idempotencyKey: string }) =>
    post<Expense>(`/groups/${groupId}/expenses`, body),
  deleteExpense: (groupId: string, expenseId: string) =>
    request<void>(`/groups/${groupId}/expenses/${expenseId}`, { method: 'DELETE' }),

  checkout: (groupId: string, toUserId: string, amountMinor: number) =>
    post<{ settlementId: string; checkoutUrl: string }>(`/groups/${groupId}/settlements/checkout`, { toUserId, amountMinor }),
  recordCash: (groupId: string, fromUserId: string, amountMinor: number) =>
    post(`/groups/${groupId}/settlements/cash`, { fromUserId, amountMinor }),

  recurring: (groupId: string) => request<RecurringExpense[]>(`/groups/${groupId}/recurring`),
  addRecurring: (groupId: string, body: Omit<RecurringExpense, 'id'>) => post<RecurringExpense>(`/groups/${groupId}/recurring`, body),
  deleteRecurring: (groupId: string, id: string) => request<void>(`/groups/${groupId}/recurring/${id}`, { method: 'DELETE' }),
};

export function formatMoney(amountMinor: number, currency: string): string {
  return (amountMinor / 100).toLocaleString(undefined, { style: 'currency', currency });
}
