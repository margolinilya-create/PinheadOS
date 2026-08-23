import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { useAuthStore } from '../../../store/useAuthStore';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { confirmWithInput } from '../../../store/useConfirmStore';
import { toast } from '../../../store/useToastStore';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { EMPLOYEE_ROLE_LABELS } from '../../types';
import { ROLE_LABELS, ALL_ROLES } from '../../../data/roles';
import { validatePassword } from '../../../utils/validate';
import styles from '../../styles';

/**
 * Карточка учётной записи: завести, переименовать, сменить пароль и адрес,
 * удалить.
 *
 * ЗАЧЕМ. В таблице сотрудников правились только роль, цех и цеховая роль —
 * всё, что живёт в обычных таблицах под RLS. Имя, адрес входа и пароль лежат
 * в `auth.users`, и до сих пор единственным способом их поправить был дашборд
 * Supabase. На этом проект уже стоял: человеку выписали приглашение на адрес
 * с забытым паролем, и вернуть его в систему было НЕЧЕМ — ни сменить пароль,
 * ни переименовать, ни удалить лишнюю запись.
 *
 * Каждое поле уходит на сервер СВОИМ действием, а не общей кнопкой
 * «Сохранить»: роль и цех правит PostgREST под RLS, пароль и адрес — Admin API
 * через функцию `admin-users`. Одна кнопка на пять разных запросов означала бы
 * «сохранено» там, где прошла половина.
 */

const EMPTY = {
  name: '',
  email: '',
  password: '',
  profile_role: 'production',
  employee_role: 'worker',
  department_id: '',
};

export function UserModal({ profile, onClose }) {
  const trapRef = useFocusTrap(true, onClose);
  const isNew = !profile;

  const {
    departments, employees,
    createUserAccount, setUserPassword, setUserEmail, deleteUserAccount,
    updateProfile, updateEmployee,
  } = useErpStore(useShallow((s) => ({
    departments: s.departments,
    employees: s.employees,
    createUserAccount: s.createUserAccount,
    setUserPassword: s.setUserPassword,
    setUserEmail: s.setUserEmail,
    deleteUserAccount: s.deleteUserAccount,
    updateProfile: s.updateProfile,
    updateEmployee: s.updateEmployee,
  })));
  const me = useAuthStore((s) => s.user);
  const isSelf = Boolean(profile && me && profile.id === me.id);

  const emp = useMemo(
    () => (profile ? employees.find((e) => e.profile_id === profile.id) : null),
    [employees, profile],
  );

  const [form, setForm] = useState(isNew ? EMPTY : { name: profile.name || '', email: profile.email || '' });
  const [busy, setBusy] = useState('');
  const [password, setPassword] = useState('');
  const [passError, setPassError] = useState('');
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  /* ─── Заведение ─── */

  const onCreate = async (e) => {
    e.preventDefault();
    if (busy) return;
    const pv = validatePassword(form.password);
    if (!pv.valid) { setPassError(pv.error); return; }
    setPassError('');
    setBusy('create');
    const ok = await createUserAccount({
      name: form.name.trim(),
      email: form.email.trim(),
      password: form.password,
      profile_role: form.profile_role,
      employee_role: form.employee_role,
      department_id: form.department_id || null,
    });
    setBusy('');
    if (ok) onClose();
  };

  /* ─── Правка существующего ─── */

  const onRename = async () => {
    const name = form.name.trim();
    if (!name || name === profile.name || busy) return;
    setBusy('name');
    /**
     * Имя живёт в двух местах: `profiles` (списки, авторство) и `erp_employees`
     * (исполнитель этапа, назначения в цехе). Поправить одно — значит получить
     * человека, который в заказе Иванов, а в очереди цеха всё ещё «ivan@…».
     */
    const ok = await updateProfile(profile.id, { name });
    if (ok && emp) await updateEmployee(emp.id, { full_name: name });
    setBusy('');
    if (ok) toast.success('Имя изменено');
  };

  const onEmail = async () => {
    const email = form.email.trim();
    if (!email || email === profile.email || busy) return;
    setBusy('email');
    await setUserEmail(profile.id, email);
    setBusy('');
  };

  const onPassword = async () => {
    const pv = validatePassword(password);
    if (!pv.valid) { setPassError(pv.error); return; }
    setPassError('');
    setBusy('password');
    const ok = await setUserPassword(profile.id, password);
    setBusy('');
    if (ok) setPassword('');
  };

  /**
   * Удаление требует ВПЕЧАТАТЬ адрес.
   *
   * Оно безвозвратно и стоит в одном окне с обычными правками, а «Да/Нет»
   * на такое нажимают не глядя. Сервер вдобавок откажет, если за человеком
   * числятся заказы, и скажет об этом текстом — но узнавать об ошибке
   * из ответа сервера поздно, когда клик уже сделан по ошибке.
   */
  const onDelete = async () => {
    const { ok, value } = await confirmWithInput({
      title: `Удалить ${profile.name || profile.email} навсегда?`,
      message: 'Учётная запись и профиль исчезнут, войти будет нельзя. В истории '
        + 'заказов останется имя, но ссылка на человека оборвётся. Отката нет — '
        + 'если нужно просто закрыть доступ, отключите пользователя.\n'
        + 'Впечатайте адрес, чтобы подтвердить.',
      confirmLabel: 'Удалить навсегда',
      variant: 'danger',
      prompt: { label: profile.email || 'Адрес', placeholder: profile.email || '', required: true },
    });
    if (!ok) return;
    if (value.trim().toLowerCase() !== (profile.email || '').toLowerCase()) {
      toast.error('Адрес не совпал — ничего не удалено');
      return;
    }
    setBusy('delete');
    const done = await deleteUserAccount(profile.id);
    setBusy('');
    if (done) onClose();
  };

  const deptOptions = departments.filter((d) => d.active || d.id === emp?.department_id);

  return (
    <div className={styles.modalOverlay} role="presentation" onClick={onClose}>
      <div
        ref={trapRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? 'Новый пользователь' : 'Карточка пользователя'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalTitle}>
          {isNew ? 'Новый пользователь' : (profile.name || profile.email)}
        </div>

        {isNew ? (
          <>
            <div className={styles.subText}>
              Пароль задаёте вы и передаёте человеку сами — писем в этом пути нет.
              Не хотите знать чужой пароль — выдайте приглашение ссылкой.
            </div>
            <form className={styles.formGrid} onSubmit={onCreate}>
              <Field
                label="Имя" value={form.name} required autoFocus
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Иван Петров"
              />
              <Field
                label="Email" type="email" value={form.email} required
                onChange={(e) => set({ email: e.target.value })}
                placeholder="ivan@example.com"
                hint="Он же логин"
              />
              <Field
                label="Пароль" type="text" value={form.password} required
                onChange={(e) => set({ password: e.target.value })}
                placeholder="мин. 6 символов"
                error={passError || undefined}
                hint={passError ? undefined : 'Виден вам — его нужно передать человеку'}
              />
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
                {deptOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Field>

              <div className={styles.modalActions}>
                <Button variant="secondary" type="button" onClick={onClose}>Отмена</Button>
                <Button variant="primary" type="submit" loading={busy === 'create'}>
                  Завести доступ
                </Button>
              </div>
            </form>
          </>
        ) : (
          <>
            <div className={styles.userRow}>
              <Field
                label="Имя" value={form.name} autoFocus
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Имя и фамилия"
              />
              <Button
                variant="secondary" onClick={onRename}
                loading={busy === 'name'}
                disabled={!form.name.trim() || form.name.trim() === profile.name}
              >
                Переименовать
              </Button>
            </div>

            <div className={styles.userRow}>
              <Field
                label="Email (логин)" type="email" value={form.email}
                onChange={(e) => set({ email: e.target.value })}
                hint="Смена адреса меняет логин — старым войти будет нельзя"
              />
              <Button
                variant="secondary" onClick={onEmail}
                loading={busy === 'email'}
                disabled={!form.email.trim() || form.email.trim() === profile.email}
              >
                Сменить
              </Button>
            </div>

            <div className={styles.userRow}>
              <Field
                label="Новый пароль" type="text" value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="мин. 6 символов"
                error={passError || undefined}
                hint={passError ? undefined : 'Человек сможет сменить его сам через «Забыли пароль?»'}
              />
              <Button
                variant="secondary" onClick={onPassword}
                loading={busy === 'password'}
                disabled={!password}
              >
                Задать пароль
              </Button>
            </div>

            <div className={styles.dangerZone}>
              <div className={styles.dangerZoneTitle}>Удаление</div>
              <div className={styles.subText}>
                {isSelf
                  ? 'Свою учётную запись удалить нельзя: администратор, оставшийся без администратора, — это правка руками в дашборде Supabase.'
                  : 'Обычно доступ достаточно отключить — история сохранится, человека можно вернуть. '
                    + 'Удаление нужно для записи, заведённой по ошибке; заказы его не пропустят.'}
              </div>
              {!isSelf && (
                <div className={styles.modalActions}>
                  <Button variant="danger" onClick={onDelete} loading={busy === 'delete'}>
                    Удалить навсегда
                  </Button>
                </div>
              )}
            </div>

            <div className={styles.modalActions}>
              <Button variant="secondary" onClick={onClose}>Закрыть</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
