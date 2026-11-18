import { useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { trpc, type System } from '../trpc';

export function DataTab({ system }: { system: System }) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const deleted = trpc.entity.listDeleted.useQuery({ systemId: system.id });
  const restore = trpc.entity.restore.useMutation({
    onSuccess: () => {
      void utils.entity.listDeleted.invalidate();
      void utils.entity.list.invalidate();
    },
  });
  const importer = trpc.system.import.useMutation({
    onSuccess: async ({ systemId }) => {
      await utils.system.list.invalidate();
      navigate(`/s/${systemId}`);
    },
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  const download = async () => {
    const data = await utils.system.export.fetch({ systemId: system.id }, { staleTime: 0 });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${system.name.replace(/[^\p{L}\p{N} _-]/gu, '')}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const upload = async (file: File) => {
    setMessage(null);
    try {
      importer.mutate({ data: JSON.parse(await file.text()) }, { onError: (e) => setMessage(e.message) });
    } catch {
      setMessage('This file is not valid JSON.');
    }
  };

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-2">
      <section className="card p-4">
        <h2 className="display mb-1 text-lg">Export</h2>
        <p className="muted mb-3">
          Downloads the whole system as one JSON file: members, campaigns, parties, every note with its hidden parts, links and the full
          change history. Keep it private.
        </p>
        <button className="btn btn-primary" onClick={download}>
          Download export
        </button>
      </section>

      <section className="card p-4">
        <h2 className="display mb-1 text-lg">Import</h2>
        <p className="muted mb-3">Creates a new system from an export file. The current system is not changed.</p>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = '';
          }}
        />
        <button className="btn" disabled={importer.isPending} onClick={() => fileInput.current?.click()}>
          Choose export file…
        </button>
        {message && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{message}</p>}
      </section>

      <section className="card p-4 lg:col-span-2">
        <h2 className="display mb-1 text-lg">Deleted items</h2>
        {deleted.data?.length === 0 && <p className="muted">Nothing deleted.</p>}
        <ul className="divide-y divide-line text-sm">
          {deleted.data?.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 py-2">
              <span>
                {e.name} <span className="muted text-xs">· deleted {e.deletedAt ? new Date(e.deletedAt).toLocaleString() : ''}</span>
              </span>
              <button className="btn px-2 py-0.5 text-xs" onClick={() => restore.mutate({ id: e.id })}>
                Restore
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
