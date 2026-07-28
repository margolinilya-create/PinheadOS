import { useShallow } from 'zustand/react/shallow';
import { useConfirmStore } from '../../store/useConfirmStore';
import ConfirmDialog from './ConfirmDialog';

/**
 * Host for imperative confirm() — mount once at app root.
 */
export default function ConfirmDialogHost() {
  const {
    open, title, message, confirmLabel, cancelLabel, variant, prompt, nonce, _close,
  } = useConfirmStore(
    useShallow((s) => ({
      open: s.open,
      title: s.title,
      message: s.message,
      confirmLabel: s.confirmLabel,
      cancelLabel: s.cancelLabel,
      variant: s.variant,
      prompt: s.prompt,
      nonce: s.nonce,
      _close: s._close,
    }))
  );

  return (
    <ConfirmDialog
      key={nonce}
      open={open}
      title={title}
      message={message}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      variant={variant}
      prompt={prompt}
      onConfirm={(value) => _close(true, value)}
      onCancel={() => _close(false)}
    />
  );
}
