import { useEffect, useRef } from 'react';

/**
 * Focus trap hook — confines keyboard focus to the returned ref element.
 * Use in modals/drawers. On open:
 *   - saves current focused element
 *   - focuses first focusable inside container
 *   - Tab/Shift+Tab cycles within container
 *   - Escape triggers onEscape callback (if provided)
 * On unmount: restores original focus.
 *
 * Usage:
 *   const ref = useFocusTrap(isOpen, onClose);
 *   return <div ref={ref}>...</div>
 */
export function useFocusTrap(active, onEscape) {
  const containerRef = useRef(null);
  const onEscapeRef = useRef(onEscape);
  useEffect(() => { onEscapeRef.current = onEscape; });

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement;

    const getFocusable = () => {
      return Array.from(
        container.querySelectorAll(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
    };

    const focusables = getFocusable();
    if (focusables.length > 0) {
      focusables[0].focus();
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && onEscapeRef.current) {
        e.preventDefault();
        onEscapeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;

      const list = getFocusable();
      if (list.length === 0) return;

      const first = list[0];
      const last = list[list.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [active]);

  return containerRef;
}
