import { useShallow } from 'zustand/react/shallow';
import { useConfirmStore } from '../../store/useConfirmStore';
import ConfirmDialog from './ConfirmDialog';

/**
 * Host for imperative confirm() — mount once at app root.
 */
export default function ConfirmDialogHost() {
  const { open, title, message, confirmLabel, cancelLabel, variant, _close } = useConfirmStore(
    useShallow((s) => ({
      open: s.open,
      title: s.title,
      message: s.message,
      confirmLabel: s.confirmLabel,
      cancelLabel: s.cancelLabel,
      variant: s.variant,
      _close: s._close,
    }))
  );

  return (
    <ConfirmDialog
      open={open}
      title={title}
      message={message}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      variant={variant}
      onConfirm={() => _close(true)}
      onCancel={() => _close(false)}
    />
  );
}
