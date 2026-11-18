import { useEffect, useRef, useState } from 'react';
import { trpc } from '../trpc';

/** A gallery holds 30 pictures at most (the server enforces it too). */
const GALLERY_MAX = 30;
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

type Props = {
  entityId: string;
  fieldId: string;
  pictures: string[];
  /** The picture chosen as the main one: cards, the sheet header, Home and Preview show it. */
  main: string | undefined;
  /** Pictures cannot be added or removed (Read mode, or no right to change the field). */
  disabled: boolean;
  canSetMain: boolean;
  onChanged: () => void;
};

/**
 * The portrait gallery of a character: framed pictures in a grid, the main one marked. A picture
 * opens large, with the previous and next ones a click or an arrow key away. Several pictures can
 * be added at once, or dropped onto the gallery.
 */
export function Gallery({ entityId, fieldId, pictures, main, disabled, canSetMain, onChanged }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const setMain = trpc.entity.setMainPicture.useMutation({ onSuccess: onChanged });
  const remove = trpc.entity.removePicture.useMutation({
    onSuccess: () => {
      setOpen(null);
      onChanged();
    },
  });
  const room = GALLERY_MAX - pictures.length;

  // One file after another, so the order of the gallery is the order of the files.
  const upload = async (files: File[]) => {
    const images = files.filter((f) => ACCEPT.split(',').includes(f.type));
    if (!images.length) return setMessage('Not uploaded. Use PNG, JPEG, WebP or GIF pictures.');
    const taken = images.slice(0, Math.max(0, room));
    let failed = images.length - taken.length;
    let tooLarge = false;
    for (const [i, file] of taken.entries()) {
      setMessage(taken.length > 1 ? `Uploading ${i + 1} of ${taken.length}…` : 'Uploading…');
      const response = await fetch(`/api/upload?entityId=${encodeURIComponent(entityId)}&fieldId=${encodeURIComponent(fieldId)}`, {
        method: 'POST',
        headers: { 'content-type': file.type },
        body: file,
      });
      if (!response.ok) {
        failed++;
        if (response.status === 413) tooLarge = true;
      }
      onChanged();
    }
    setMessage(
      !failed
        ? null
        : images.length > room
          ? `The gallery is full: ${GALLERY_MAX} pictures at most. ${failed} not added.`
          : tooLarge
            ? `${failed} not added: a picture may be 8 MB at most.`
            : `${failed} not added. Use PNG, JPEG, WebP or GIF pictures.`,
    );
  };

  return (
    <div
      data-gallery
      className={`rounded-md ${dragging ? 'outline-2 outline-offset-4 outline-accent outline-dashed' : ''}`}
      onDragOver={(ev) => {
        if (disabled || !ev.dataTransfer.types.includes('Files')) return;
        ev.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(ev) => {
        if (disabled) return;
        ev.preventDefault();
        setDragging(false);
        void upload([...ev.dataTransfer.files]);
      }}
    >
      {!pictures.length && disabled && <span className="text-sm text-muted">no pictures</span>}
      {pictures.length > 0 && (
        <ul className="mb-2 grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3">
          {pictures.map((id, i) => (
            <li key={id} data-picture={i + 1} data-main={id === main ? '' : undefined}>
              <button
                type="button"
                className={`portrait-frame block aspect-square w-full cursor-zoom-in overflow-hidden rounded-sm bg-surface-2 ${id === main ? 'ring-2 ring-accent' : ''}`}
                onClick={() => setOpen(i)}
                aria-label={`Open picture ${i + 1}${id === main ? ' (main)' : ''}`}
              >
                <img
                  src={`/api/file/${id}`}
                  alt={id === main ? 'Main picture' : `Picture ${i + 1}`}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
              {id === main && <span className="mt-1 block text-center text-xs font-semibold text-accent">Main</span>}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(ev) => {
              void upload([...(ev.target.files ?? [])]);
              ev.target.value = '';
            }}
          />
          <button type="button" className="btn" disabled={room <= 0} onClick={() => fileInput.current?.click()}>
            Add pictures…
          </button>
          <span className="muted text-xs">
            {pictures.length} of {GALLERY_MAX} · or drop pictures here
          </span>
          {message && <span className="muted">{message}</span>}
        </div>
      )}
      {open !== null && pictures[open] && (
        <Viewer
          pictures={pictures}
          index={open}
          main={main}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          onMakeMain={canSetMain ? (id) => setMain.mutate({ id: entityId, fieldId, fileId: id }) : undefined}
          onRemove={disabled ? undefined : (id) => confirm('Remove this picture from the gallery?') && remove.mutate({ id: entityId, fieldId, fileId: id })}
        />
      )}
    </div>
  );
}

type ViewerProps = {
  pictures: string[];
  index: number;
  main: string | undefined;
  onIndex: (index: number) => void;
  onClose: () => void;
  onMakeMain?: (id: string) => void;
  onRemove?: (id: string) => void;
};

/** One picture large over the page. Arrow keys step through the gallery, Escape closes it. */
function Viewer({ pictures, index, main, onIndex, onClose, onMakeMain, onRemove }: ViewerProps) {
  const id = pictures[index]!;
  const step = (by: number) => onIndex((index + by + pictures.length) % pictures.length);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => closeButton.current?.focus(), []);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
      else if (ev.key === 'ArrowRight') step(1);
      else if (ev.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Picture ${index + 1} of ${pictures.length}`}
      className="fixed inset-0 z-50 flex flex-col bg-black/85 p-4 text-white"
      onClick={(ev) => ev.target === ev.currentTarget && onClose()}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span>
          {index + 1} of {pictures.length}
          {id === main && <span className="ml-2 font-semibold text-accent">Main</span>}
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          {onMakeMain && id !== main && (
            <button type="button" className="btn" onClick={() => onMakeMain(id)}>
              Make main
            </button>
          )}
          {onRemove && (
            <button type="button" className="btn btn-danger" onClick={() => onRemove(id)}>
              Remove
            </button>
          )}
          <button ref={closeButton} type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2" onClick={(ev) => ev.target === ev.currentTarget && onClose()}>
        {pictures.length > 1 && (
          <button type="button" className="btn shrink-0 px-3 text-lg" aria-label="Previous picture" onClick={() => step(-1)}>
            ‹
          </button>
        )}
        <img src={`/api/file/${id}`} alt={`Picture ${index + 1}`} className="max-h-full min-w-0 max-w-full object-contain" />
        {pictures.length > 1 && (
          <button type="button" className="btn shrink-0 px-3 text-lg" aria-label="Next picture" onClick={() => step(1)}>
            ›
          </button>
        )}
      </div>
    </div>
  );
}
