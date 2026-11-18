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
  const importer = trpc.system.import.useMutation({ onSuccess: ({ systemId }) => opened(systemId) });
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [withPictures, setWithPictures] = useState(true);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);

  const save = (blob: Blob, extension: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${system.name.replace(/[^\p{L}\p{N} _-]/gu, '')}-${new Date().toISOString().slice(0, 10)}.${extension}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const download = async () => {
    setMessage(null);
    setBusy('export');
    try {
      if (withPictures) {
        const res = await fetch(`/api/export/${system.id}`);
        if (!res.ok) throw new Error();
        save(await res.blob(), 'zip');
      } else {
        const data = await utils.system.export.fetch({ systemId: system.id }, { staleTime: 0 });
        save(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'json');
      }
    } catch {
      setMessage('The export could not be made.');
    } finally {
      setBusy(null);
    }
  };

  const opened = async (systemId: string) => {
    await utils.system.list.invalidate();
    navigate(`/s/${systemId}`);
  };

  const upload = async (file: File) => {
    setMessage(null);
    if (/\.zip$/i.test(file.name)) {
      setBusy('import');
      try {
        const res = await fetch('/api/import', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: file });
        const answer = (await res.json().catch(() => ({}))) as { systemId?: string; error?: string };
        if (!res.ok || !answer.systemId) setMessage(answer.error ?? 'The file could not be imported.');
        else await opened(answer.systemId);
      } catch {
        setMessage('The file could not be imported.');
      } finally {
        setBusy(null);
      }
      return;
    }
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
          Downloads the whole system: members, campaigns, parties, every entry with its hidden parts, links and the full change history.
          With pictures it is a ZIP file that also holds every uploaded picture; without them it is one smaller JSON file. Keep it private.
        </p>
        <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={withPictures} onChange={(e) => setWithPictures(e.target.checked)} /> Include pictures
        </label>
        <button className="btn btn-primary" disabled={busy !== null} onClick={download}>
          {busy === 'export' ? 'Preparing…' : 'Download export'}
        </button>
      </section>

      <section className="card p-4">
        <h2 className="display mb-1 text-lg">Import</h2>
        <p className="muted mb-3">
          Creates a new system from an export file (.zip with pictures, or .json without). The current system is not changed.
        </p>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json,application/zip,.zip"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = '';
          }}
        />
        <button className="btn" disabled={importer.isPending || busy !== null} onClick={() => fileInput.current?.click()}>
          {busy === 'import' ? 'Importing…' : 'Choose export file…'}
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
