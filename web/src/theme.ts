import { useState } from 'react';

// Light / dark mode chosen in the header and kept per device (not on the account).
// The script in index.html applies it before the app loads and follows the device while the choice is "system".
export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'anybrew-theme';

declare global {
  interface Window {
    __applyTheme?: () => void;
  }
}

function readChoice(): ThemeChoice {
  try {
    const c = localStorage.getItem(KEY);
    return c === 'light' || c === 'dark' ? c : 'system';
  } catch {
    return 'system';
  }
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice);
  const change = (next: ThemeChoice) => {
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
      window.__applyTheme?.();
    } catch {
      // Storage blocked: the choice lasts until the page is closed.
      const dark = next === 'dark' || (next === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    }
    setChoice(next);
  };
  return [choice, change] as const;
}
