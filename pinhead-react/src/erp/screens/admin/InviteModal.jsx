import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { confirm } from '../../../store/useConfirmStore';
import { toast } from '../../../store/useToastStore';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { EMPLOYEE_ROLE_LABELS } from '../../types';
import { ROLE_LABELS, ALL_ROLES } from '../../../data/roles';
import { inviteUrl } from '../../utils/invite';
import styles from '../../erp.module.css';

/**
 * Приглашение сотрудника ссылкой.
 *
 * ЗАЧЕМ. Прежде человек заводился в четыре шага: регистрировался сам,
 * подтверждал адрес письмом, ждал одобрения, ждал назначения роли и цеха.
 * Письма шлёт встроенный SMTP Supabase (лимит порядка двух в час, у gmail
 * уходит в спам) — из пяти учётных записей проекта самостоятельно
 * регистрировались двое, и застряли ОБА, одобренные и так и не вошедшие.
 *
 * Теперь роль и цех выбираются ЗДЕСЬ, один раз, и уезжают в код ссылки.
 * Ссылку админ отдаёт человеку сам — мессенджером, при встрече, как угодно.
 * Писем в этом пути нет вовсе, а значит нечему теряться.
 */

/** Сроки жизни ссылки. Больше недели — это уже не приглашение, а открытая дверь */
const LIFETIMES = [
  { hours: 24, label: 'Сутки' },
  { hours: 72, label: '3 дня' },
  { hours: 168, label: 'Неделя' },
];

/** Роль цеха по умолчанию — рабочий: самый частый случай найма */
const EMPTY = {
  profile_role: 'production',
  employee_role: 'worker',
  department_id: '',
  email: '',
  note: '',
  expiresInHours: 72,
};

export function InviteModal({ onClose }) {
  const trapRef = useFocusTrap(true, onClose);
  const {
    departments, invites, invitesLoaded, loadInvites, createInvite, revokeInvite,
  } = useErpStore(useShallow((s) => ({
    departments: s.departments,
    invites: s.invites,
    invitesLoaded: s.invitesLoaded,
    loadInvites: s.loadInvites,
    createInvite: s.createInvite,
    revokeInvite: s.revokeInvite,
  })));

  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  /** Свежесозданная ссылка — её показываем крупно, пока админ не закроет окно */
  const [fresh, setFresh] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => { if (!invitesLoaded) loadInvites(); }, [invitesLoaded, loadInvites]);

  const active = useMemo(
    () => invites.filter((i) => !i.used_at && !i.revoked_at && new Date(i.expires_at) > new Date()),
    [invites],
  );
  /** Использованные, отозванные и просроченные — это журнал, а не работа */
  const archived = useMemo(
    () => invites.filter((i) => i.used_at || i.revoked_at || new Date(i.expires_at) <= new Date()),
    [invites],
  );

  const copy = async (code) => {
    try {
      await navigator.clipboard.writeText(inviteUrl(code));
      toast.success('Ссылка скопирована');
    } catch {
      // Буфер закрыт политикой браузера — ссылка видна в поле, её можно выделить
      toast.error('Скопировать не удалось — выделите ссылку и скопируйте вручную');
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    const row = await createInvite({
      profile_role: form.profile_role,
      employee_role: form.employee_role,
      department_id: form.department_id || null,
      email: form.email,
      note: form.note,
      expiresInHours: form.expiresInHours,
    });
    setSaving(false);
    if (row) {
      setFresh(row);
      setForm(EMPTY);
    }
  };

  const onRevoke = async (invite) => {
    const ok = await confirm({
      title: 'Отозвать приглашение?',
      message: 'Ссылка перестанет работать. Выданные по ней доступы не затрагиваются.',
      confirmLabel: 'Отозвать',
      variant: 'danger',
    });
    if (ok) await revokeInvite(invite.code);
  };

  const roleLine = (i) => [
    EMPLOYEE_ROLE_LABELS[i.employee_role] || i.employee_role,
    departments.find((d) => d.id === i.department_id)?.name,
    i.email,
  ].filter(Boolean).join(' · ');

  return (
    <div className={styles.modalOverlay} role="presentation" onClick={onClose}>
      <div
        ref={trapRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Пригласить сотрудника"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalTitle}>Пригласить сотрудника</div>
        <div className={styles.subText}>
          Роль и цех уезжают в саму ссылку: человек перейдёт по ней, задаст пароль
          и сразу начнёт работать. Письма не отправляются — ссылку передайте сами.
        </div>

        {fresh && (
          <div className={styles.inviteReady}>
            <div className={styles.inviteReadyTitle}>
              <Icon name="check" size={14} /> Ссылка готова
            </div>
            <input
              className={styles.inviteLink}
              readOnly
              value={inviteUrl(fresh.code)}
              onFocus={(e) => e.target.select()}
              aria-label="Ссылка-приглашение"
            />
            <Button variant="primary" onClick={() => copy(fresh.code)}>Скопировать</Button>
          </div>
        )}

        <form className={styles.formGrid} onSubmit={onSubmit}>
          <Field
            as="select" label="Роль в системе" value={form.profile_role}
            onChange={(e) => set({ profile_role: e.target.value })}
          >
            {ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Field>

          <Field
            as="select" label="Цеховая роль" value={form.employee_role}
            onChange={(e) => set({ employee_role: e.target.value })}
            hint="Она определяет права по матрице"
          >
            {Object.entries(EMPLOYEE_ROLE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Field>

          <Field
            as="select" label="Цех" value={form.department_id}
            onChange={(e) => set({ department_id: e.target.value })}
            hint="Без цеха человек не ограничен участком"
          >
            <option value="">— не назначен —</option>
            {departments.filter((d) => d.active).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Field>

          <Field
            as="select" label="Срок действия" value={form.expiresInHours}
            onChange={(e) => set({ expiresInHours: Number(e.target.value) })}
          >
            {LIFETIMES.map((l) => <option key={l.hours} value={l.hours}>{l.label}</option>)}
          </Field>

          <Field
            label="Email (необязательно)" type="email" value={form.email}
            onChange={(e) => set({ email: e.target.value })}
            placeholder="ivan@example.com"
            hint="Указан — ссылкой сможет воспользоваться только этот адрес"
          />

          <Field
            label="Заметка" value={form.note}
            onChange={(e) => set({ note: e.target.value })}
            placeholder="Например: швея, вторая смена"
          />

          <div className={styles.modalActions}>
            <Button variant="secondary" type="button" onClick={onClose}>Закрыть</Button>
            <Button variant="primary" type="submit" loading={saving}>Создать ссылку</Button>
          </div>
        </form>

        <div className={styles.inviteListTitle}>
          Действующие приглашения ({active.length})
        </div>
        {invitesLoaded && active.length === 0 && (
          <div className={styles.subText}>Пока ни одного — создайте ссылку выше.</div>
        )}
        <ul className={styles.inviteList}>
          {active.map((i) => (
            <li key={i.code} className={styles.inviteRow}>
              <div>
                <div>{roleLine(i)}</div>
                <div className={styles.subText}>
                  до {new Date(i.expires_at).toLocaleString('ru-RU')}
                  {i.note ? ` · ${i.note}` : ''}
                </div>
              </div>
              <div className={styles.inviteRowActions}>
                <Button variant="secondary" size="sm" onClick={() => copy(i.code)}>Скопировать</Button>
                <Button variant="secondary" size="sm" onClick={() => onRevoke(i)}>Отозвать</Button>
              </div>
            </li>
          ))}
        </ul>

        {archived.length > 0 && (
          <details className={styles.inviteArchive}>
            <summary>Использованные и просроченные ({archived.length})</summary>
            <ul className={styles.inviteList}>
              {archived.map((i) => (
                <li key={i.code} className={styles.inviteRow}>
                  <div>
                    <div>{roleLine(i)}</div>
                    <div className={styles.subText}>
                      {i.used_at ? `использовано ${new Date(i.used_at).toLocaleDateString('ru-RU')}`
                        : i.revoked_at ? 'отозвано' : 'истекло'}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
