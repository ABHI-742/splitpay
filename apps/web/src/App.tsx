import { useEffect, useState } from 'react';
import { api, refreshSession, type User } from './api';
import { AuthForm } from './components/AuthForm';
import { GroupList } from './components/GroupList';
import { GroupPage } from './components/GroupPage';
import { InvitePage } from './components/InvitePage';
import { useLiveUpdates } from './realtime';
import { navigate, usePath } from './router';
import './styles.css';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const path = usePath();
  useLiveUpdates(user !== null);

  // Restore the session from the refresh cookie on page load.
  useEffect(() => {
    refreshSession()
      .then((ok) => (ok ? api.me().then(setUser) : null))
      .finally(() => setChecking(false));
  }, []);

  if (checking) return null;
  if (!user) return <AuthForm onAuthenticated={setUser} />;

  const groupMatch = path.match(/^\/groups\/([^/]+)$/);
  const inviteMatch = path.match(/^\/invite\/([^/]+)$/);

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="brand" onClick={() => navigate('/')}>
          SplitPay
        </button>
        <div className="spacer" />
        <span className="muted">{user.name}</span>
        <button
          type="button"
          className="secondary"
          onClick={async () => {
            await api.logout();
            setUser(null);
            navigate('/');
          }}
        >
          Log out
        </button>
      </header>
      <main>
        {groupMatch && <GroupPage groupId={groupMatch[1]} me={user} />}
        {inviteMatch && <InvitePage token={inviteMatch[1]} />}
        {!groupMatch && !inviteMatch && <GroupList />}
      </main>
    </div>
  );
}
