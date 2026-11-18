import { useState } from 'react';
import { useLocation } from 'wouter';
import { Centered } from '../App';
import { D20 } from '../components/Icons';
import { trpc } from '../trpc';

type User = { id: string; displayName: string } | null;

// The pages before login: a dark stone texture in both modes with a brass-framed card on it (PLAN.md section 11.5).
function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="stone flex min-h-dvh items-center justify-center p-4" data-login-page>
      <div className="login-card w-full max-w-sm p-6">
        <div className="display mb-3 flex items-center justify-center gap-2 text-xl">
          <D20 className="size-6 text-accent" />
          AnyBrew
        </div>
        <h1 className="display mb-4 text-center text-2xl">{title}</h1>
        {children}
      </div>
    </div>
  );
}

function Field(props: { label: string; value: string; onChange: (v: string) => void; type?: string; hint?: string; autoFocus?: boolean }) {
  return (
    <label className="mb-3 block">
      <span className="label">{props.label}</span>
      <input
        className="input"
        type={props.type ?? 'text'}
        value={props.value}
        autoFocus={props.autoFocus}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.hint && <span className="mt-1 block text-xs text-muted">{props.hint}</span>}
    </label>
  );
}

function ErrorLine({ error }: { error: { message: string } | null }) {
  if (!error) return null;
  // Validation errors arrive as a JSON list; show the first message only.
  let message = error.message;
  try {
    const parsed = JSON.parse(message);
    if (Array.isArray(parsed) && parsed[0]?.message) message = parsed[0].message;
  } catch {
    /* plain text */
  }
  return <p className="mb-3 text-sm text-red-600 dark:text-red-400">{message}</p>;
}

export function SetupPage() {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const [form, setForm] = useState({ username: '', displayName: '', password: '', systemName: '' });
  const setup = trpc.auth.setup.useMutation({
    onSuccess: async ({ systemId }) => {
      await utils.invalidate();
      navigate(`/s/${systemId}`);
    },
  });
  const set = (key: keyof typeof form) => (v: string) => setForm({ ...form, [key]: v });
  return (
    <Shell title="Set up AnyBrew">
      <p className="muted mb-4">This creates the DM account and your first system. It is shown only once.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setup.mutate(form);
        }}
      >
        <Field label="Login name" value={form.username} onChange={set('username')} autoFocus />
        <Field label="Name shown to players" value={form.displayName} onChange={set('displayName')} />
        <Field label="Password" type="password" value={form.password} onChange={set('password')} hint="At least 8 characters" />
        <Field
          label="System name"
          value={form.systemName}
          onChange={set('systemName')}
          hint="The rule set, for example your D&D homebrew. Campaigns are added inside it later."
        />
        <ErrorLine error={setup.error} />
        <button className="btn btn-primary w-full" disabled={setup.isPending}>
          Create
        </button>
      </form>
    </Shell>
  );
}

export function LoginPage() {
  const utils = trpc.useUtils();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const login = trpc.auth.login.useMutation({ onSuccess: () => utils.invalidate() });
  return (
    <Shell title="Log in">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate({ username, password });
        }}
      >
        <Field label="Login name" value={username} onChange={setUsername} autoFocus />
        <Field label="Password" type="password" value={password} onChange={setPassword} />
        <ErrorLine error={login.error} />
        <button className="btn btn-primary w-full" disabled={login.isPending}>
          Log in
        </button>
      </form>
      <p className="muted mt-4">Forgot your password? Ask your DM to set a new one.</p>
    </Shell>
  );
}

export function InvitePage({ token, user }: { token: string; user: User }) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const info = trpc.auth.inviteInfo.useQuery({ token });
  const [form, setForm] = useState({ username: '', displayName: '', password: '' });
  const done = async ({ systemId }: { systemId: string }) => {
    await utils.invalidate();
    navigate(`/s/${systemId}`);
  };
  const accept = trpc.auth.acceptInvite.useMutation({ onSuccess: done });
  const join = trpc.auth.joinWithInvite.useMutation({ onSuccess: done });
  const set = (key: keyof typeof form) => (v: string) => setForm({ ...form, [key]: v });

  if (!info.data) return <Centered>Loading…</Centered>;
  if (!info.data.valid)
    return <Centered>This invite link has been used or has expired. Ask your DM for a new one.</Centered>;

  if (user)
    return (
      <Shell title={`Join ${info.data.systemName}`}>
        <p className="muted mb-4">
          You are logged in as {user.displayName}. Join {info.data.campaignName ? `the campaign ${info.data.campaignName}` : 'this system'} as a{' '}
          {info.data.role === 'dm' ? 'DM' : 'player'}?
        </p>
        <ErrorLine error={join.error} />
        <button className="btn btn-primary w-full" disabled={join.isPending} onClick={() => join.mutate({ token })}>
          Join
        </button>
      </Shell>
    );

  return (
    <Shell title={`Join ${info.data.systemName}`}>
      <p className="muted mb-4">
        Create your account to join as a {info.data.role === 'dm' ? 'DM' : 'player'}
        {info.data.campaignName ? ` in the campaign ${info.data.campaignName}` : ''}.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          accept.mutate({ token, ...form });
        }}
      >
        <Field label="Login name" value={form.username} onChange={set('username')} autoFocus />
        <Field label="Name shown to others" value={form.displayName} onChange={set('displayName')} />
        <Field label="Password" type="password" value={form.password} onChange={set('password')} hint="At least 8 characters" />
        <ErrorLine error={accept.error} />
        <button className="btn btn-primary w-full" disabled={accept.isPending}>
          Create account
        </button>
      </form>
    </Shell>
  );
}
