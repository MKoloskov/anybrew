import { Redirect, Route, Switch } from 'wouter';
import { InvitePage, LoginPage, SetupPage } from './pages/Auth';
import { SystemPage } from './pages/System';
import { trpc } from './trpc';

export function App() {
  const status = trpc.auth.status.useQuery();
  if (status.isLoading) return <Centered>Loading…</Centered>;
  if (status.error || !status.data)
    return <Centered>The server is not answering. Start it with “npm run dev” and reload this page.</Centered>;

  const { needsSetup, user } = status.data;
  return (
    <Switch>
      <Route path="/invite/:token">{(params) => <InvitePage token={params.token} user={user} />}</Route>
      <Route>
        {needsSetup ? (
          <SetupPage />
        ) : !user ? (
          <LoginPage />
        ) : (
          <Switch>
            <Route path="/s/:systemId/:tab?/:entityId?">
              {(raw) => {
                // wouter cannot infer types for a path with two optional parts.
                const params = raw as { systemId: string; tab?: string; entityId?: string };
                return <SystemPage systemId={params.systemId} tab={params.tab ?? 'characters'} entityId={params.entityId} user={user} />;
              }}
            </Route>
            <Route>
              <Home />
            </Route>
          </Switch>
        )}
      </Route>
    </Switch>
  );
}

function Home() {
  const systems = trpc.system.list.useQuery();
  if (!systems.data) return <Centered>Loading…</Centered>;
  const first = systems.data[0];
  if (!first) return <Centered>You are not in any system yet. Ask your DM for an invite link.</Centered>;
  return <Redirect to={`/s/${first.id}`} />;
}

export function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center p-6 text-center text-stone-500">{children}</div>;
}
