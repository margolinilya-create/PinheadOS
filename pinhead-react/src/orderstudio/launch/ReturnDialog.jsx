import { useEffect, useId, useRef, useState } from 'react';
import { Modal } from '../../erp/components/Modal';
import { Button } from '../../erp/components/Button';
import styles from './Launch.module.css';

/** Предел причины — как у `order_v4_transition` (`p_reason` ≤ 500) */
export const RETURN_MAX = 500;
/** С этого числа знаков счётчик объявляется скринридеру */
const ANNOUNCE_FROM = 450;

/**
 * «Вернуть менеджеру» (К17) — по образцу `ColorCopyDialog`: форма не
 * закрывается промахом мимо окна. Причина обязательна, её увидит менеджер.
 * Ошибка RPC — внутри окна (`role=alert`): окно не закрывается, набранная
 * причина не теряется.
 *
 * @param {{ onSubmit: (reason: string) => Promise<boolean>, onClose: () => void }} props
 */
export default function ReturnDialog({ onSubmit, onClose }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const errRef = useRef(null);
  const id = useId();
  const trimmed = reason.trim();

  useEffect(() => {
    if (error) errRef.current?.focus();
  }, [error]);

  const submit = async (e) => {
    e.preventDefault();
    if (!trimmed || busy) return;
    setBusy(true);
    setError('');
    const ok = await onSubmit(trimmed);
    setBusy(false);
    if (!ok) setError('Заказ не возвращён — причина в уведомлении выше. Причина возврата сохранена, повторите');
  };

  return (
    <Modal title="Вернуть менеджеру" onClose={busy ? () => {} : onClose} closeOnOverlay={false} className={styles.dialog}>
      <form className={styles.dialogForm} onSubmit={submit}>
        <label className={styles.label} htmlFor={`${id}-reason`}>Что исправить менеджеру</label>
        <textarea
          id={`${id}-reason`}
          className={styles.textarea}
          value={reason}
          maxLength={RETURN_MAX}
          rows={4}
          aria-describedby={`${id}-hint ${id}-count`}
          onChange={(e) => setReason(e.target.value)}
          // Первое поле формы получает фокус (правило проекта)
          autoFocus
        />
        <p id={`${id}-hint`} className={styles.hint}>Причину увидит менеджер в заказе</p>
        <p id={`${id}-count`} className={styles.hint} aria-live={reason.length >= ANNOUNCE_FROM ? 'polite' : 'off'}>
          {reason.length} / {RETURN_MAX}
        </p>
        {error && <p ref={errRef} tabIndex={-1} role="alert" className={styles.error}>{error}</p>}
        <div className={styles.dialogActions}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Отмена</Button>
          <Button variant="primary" type="submit" disabled={!trimmed || busy}>
            {busy ? 'Возвращаем…' : 'Вернуть с причиной'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
