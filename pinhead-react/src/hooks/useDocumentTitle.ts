// Updates document.title on mount, restores previous title on unmount.
// Used by v2 production screens so browser tabs reflect the current view.

import { useEffect } from 'react';

const APP_PREFIX = 'Pinhead';

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} · ${APP_PREFIX}` : APP_PREFIX;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
