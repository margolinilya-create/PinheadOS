import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import InlineEdit from '../components/InlineEdit';
import { Icon } from '../components/Icon';
import { useErpStore } from '../store/useErpStore';
import { LoadFailed, EmptyState } from '../components/ErpStates';
import { TableSkeleton } from '../components/ErpSkeletons';
import { useAuthStore } from '../../store/useAuthStore';
import { confirm } from '../../store/useConfirmStore';
import { toast } from '../../store/useToastStore';
import { ROLE_LABELS, ALL_ROLES } from '../../data/roles';
import styles from '../styles';
import { ScrollHintBox } from '../components/ScrollHintBox';
import { EmployeeCard } from './admin/EmployeeCard';
import { LooseEmployeeCard } from './admin/LooseEmployeeCard';
import { DeptSelect, EmployeeRoleSelect, RoleSelect } from './admin/EmployeeFields';
import { useCompactLayout } from '../layout/useCompactLayout';
import { Button } from '../components/Button';
import { useErpAccess } from '../store/useErpAccess';
import { InviteModal } from './admin/InviteModal';
import { UserModal } from './admin/UserModal';
import { ReadOnlyFieldset } from '../components/ReadOnlyFieldset';

/**
 * Сотрудники — ЕДИНЫЙ источник с Order Studio (таблица profiles).
 * Формат и действия как в Админке (роль, Подтвердить/Отключить/Вернуть)
 * + цеховая надстройка ERP (цех, цеховая роль, заметка) в erp_employees.
 * Отдельно внизу — цеховые работники без логина.
 */

function statusChip(p) {
  if (p.active === false) return { cls: 'chipBlocked', label: 'Отключён' };
  if (!p.approved) return { cls: 'chipProgress', label: 'Ждёт подтверждения' };
  return { cls: 'chipReady', label: 'Активен' };
}

export default function EmployeesScreen({ embedded = false }) {
  const {
    employees, profilesList, employeesLoaded, employeesError, departments, loaded,
    loadAll, loadEmployees, createEmployee, updateEmployee,
    updateProfile, upsertProfileDept,
  } = useErpStore(
    useShallow((s) => ({
      employees: s.employees,
      profilesList: s.profilesList,
      employeesLoaded: s.employeesLoaded,
      employeesError: s.employeesError,
      departments: s.departments,
      loaded: s.loaded,
      loadAll: s.loadAll,
      loadEmployees: s.loadEmployees,
      createEmployee: s.createEmployee,
      updateEmployee: s.updateEmployee,
      updateProfile: s.updateProfile,
      upsertProfileDept: s.upsertProfileDept,
    })),
  );
  const me = useAuthStore((s) => s.user);
  const access = useErpAccess();
  const compact = useCompactLayout();
  const [showInactive, setShowInactive] = useState(false);
  const [newName, setNewName] = useState('');
  const [inviting, setInviting] = useState(false);
  /**
   * Карточка учётной записи: `null` — закрыта, `'new'` — заведение,
   * профиль — правка. Имя, адрес входа и пароль лежат в `auth.users`, и
   * в таблице их не поправить: там только то, что живёт под RLS.
   */
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    if (!loaded) loadAll();
    if (!employeesLoaded) loadEmployees();
  }, [loaded, loadAll, employeesLoaded, loadEmployees]);

  const empByProfile = useMemo(
    () => new Map(employees.filter((e) => e.profile_id).map((e) => [e.profile_id, e])),
    [employees],
  );

  /**
   * УЧЁТНЫЕ ЗАПИСИ ПОКАЗЫВАЕМ ТОЛЬКО АДМИНУ, И ЭТО НЕ ГЕЙТ, А ЧЕСТНОСТЬ.
   *
   * `profiles_select` на сервере — `auth.uid() = id OR is_admin()`, где
   * `is_admin()` требует роль профиля ровно `admin`. Раздел `/admin` при этом
   * пускает и директора, а у вкладки «Пользователи» гейта не было вовсе.
   * Директор получал СПИСОК ИЗ ОДНОЙ СТРОКИ — своей собственной, — и ни ошибки,
   * ни признака, что список урезан: RLS не сообщает о скрытых строках, он их
   * просто не отдаёт. «Пять сотрудников» превращались в «один», и это выглядело
   * как правда.
   *
   * Ровно тем же `is_admin()` закрыты `profiles_update` и
   * `erp_employees_update`, поэтому вместе со списком уходят и действия:
   * подтверждение доступа, отключение, смена роли и привязка к цеху. Показывать
   * их нельзя — это «кнопка есть, а действие падает», причём падает молча
   * (RLS запрещает через `USING`, то есть нулём строк).
   *
   * Права мы здесь НЕ расширяем: если заказчик решит, что учётные записи ведёт
   * и директор, правильная правка — перевести три политики с `is_admin()`
   * на `erp_is_manager()` одной миграцией вместе с этим гейтом.
   */
  const canManageAccounts = access.isAdmin;

  const profileRows = useMemo(
    () => (canManageAccounts
      ? profilesList.filter((p) => showInactive || p.active !== false)
      : []),
    [profilesList, showInactive, canManageAccounts],
  );
  const looseEmployees = useMemo(
    () => employees.filter((e) => !e.profile_id && (showInactive || e.active)),
    [employees, showInactive],
  );

  /**
   * Админ мог одним кликом сменить себе роль на «Дизайнер» — и мгновенно потерять
   * доступ к /admin, /purchasing, /warehouse, а вернуть роль было уже некому.
   * Своя строка помечена и защищена; чужого админа понижаем с подтверждением.
   */
  const onChangeRole = async (p, role) => {
    if (p.id === me?.id) return;
    if (p.role === 'admin' && role !== 'admin') {
      const ok = await confirm({
        title: `Понизить администратора ${p.name || p.email}?`,
        message: 'Человек потеряет доступ к админке, закупке, складу, подряду '
          + 'и эксперим. цеху. Вернуть роль сможет только другой администратор.',
        confirmLabel: 'Понизить',
        variant: 'danger',
      });
      if (!ok) return;
    }
    await updateProfile(p.id, { role });
  };

  const onDisable = async (p) => {
    const ok = await confirm({
      title: 'Отключить пользователя?',
      message: `${p.name || p.email} потеряет доступ. Это мягкое отключение — как в Админке.`,
      confirmLabel: 'Отключить',
      variant: 'danger',
    });
    if (ok) await updateProfile(p.id, { active: false, approved: false });
  };

  /**
   * Отключение сотрудника БЕЗ профиля шло без подтверждения, хотя соседняя
   * кнопка «Отключить» у пользователя с профилем его спрашивает. Действие
   * одинаково видимое (человек пропадает из очередей и назначений), значит
   * и спрашивать надо одинаково — иначе правило «деструктивное подтверждаем»
   * держится на том, какую из двух кнопок нажали.
   */
  const onDisableEmployee = async (emp) => {
    const ok = await confirm({
      title: `Отключить сотрудника «${emp.full_name}»?`,
      message: 'Он пропадёт из списков исполнителей и назначений. Запись не удаляется — сотрудника можно вернуть.',
      confirmLabel: 'Отключить',
      variant: 'danger',
    });
    if (ok) await updateEmployee(emp.id, { active: false });
  };

  /**
   * Набор действий строки считается ОДИН раз на обе раскладки.
   *
   * Их состав зависит от состояния профиля (отключён / ждёт подтверждения /
   * активен) и от прав смотрящего, и вторая реализация этого ветвления
   * разошлась бы молча: обе «работают», просто предлагают разное — например,
   * «Подтвердить» осталось бы только в таблице, и руководитель с планшета
   * не смог бы завести человека вовсе.
   */
  const rowActions = (p) => (
    <>
      {/* Имя, адрес входа и пароль лежат в `auth.users` — в таблице
          их не поправить, для них и открывается карточка */}
      {access.isAdmin && (
        <>
          <Button
            variant="ghost"
            aria-label={`Изменить ${p.name || p.email}`}
            title="Имя, email, пароль, удаление"
            onClick={() => setEditing(p)}
          ><Icon name="pencil" size={15} /></Button>{' '}
        </>
      )}
      {p.active === false ? (
        <Button variant="secondary" onClick={() => updateProfile(p.id, { active: true })}>
          Вернуть
        </Button>
      ) : !p.approved ? (
        <>
          <Button variant="primary" onClick={() => updateProfile(p.id, { approved: true })}>
            Подтвердить
          </Button>{' '}
          <Button
            variant="ghost"
            aria-label={`Отключить ${p.name || p.email}`}
            disabled={p.id === me?.id}
            onClick={() => onDisable(p)}><Icon name="x" size={15} /></Button>
        </>
      ) : (
        <Button
          variant="ghost"
          aria-label={`Отключить ${p.name || p.email}`}
          disabled={p.id === me?.id}
          title={p.id === me?.id ? 'Себя отключить нельзя' : undefined}
          onClick={() => onDisable(p)}><Icon name="x" size={15} /></Button>
      )}
    </>
  );

  /** Тот же приём, что у `rowActions`: одно ветвление на таблицу и карточку */
  const looseActions = (emp) => (
    emp.active ? (
      <Button
        variant="ghost"
        aria-label={`Отключить ${emp.full_name}`}
        onClick={() => onDisableEmployee(emp)}
      >
        <Icon name="x" size={15} />
      </Button>
    ) : (
      <Button
        variant="ghost"
        aria-label={`Вернуть ${emp.full_name}`}
        title={`Вернуть ${emp.full_name}`}
        onClick={() => updateEmployee(emp.id, { active: true })}><Icon name="undo" size={15} /></Button>
    )
  );

  return (
    <>
      {inviting && <InviteModal onClose={() => setInviting(false)} />}
      {editing && (
        <UserModal
          profile={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      {!embedded && (
        <PageHead
          title="Сотрудники"
          sub="Единый список с Order Studio: логины, роли и статусы общие. Здесь же — привязка к цеху."
        />
      )}

      <div className={styles.toolbar}>
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Показывать отключённых
        </label>
        <div className={styles.spacer} />
        <span className={styles.subText}>
          {canManageAccounts && `${profileRows.length} с логином · `}
          {looseEmployees.length} без логина
        </span>
        {/* Приглашение раздаёт права, поэтому гейтится правом матрицы,
            а не ролью учётной записи — сервер проверяет ровно это же */}
        {access.can('staff.invite') && (
          <Button variant="secondary" icon="externalLink" onClick={() => setInviting(true)}>
            Пригласить
          </Button>
        )}
        {/* Заведение с паролем идёт через Admin API, а он на сервере закрыт
            `is_admin()` — зеркалим ту же функцию, а не более широкий гейт */}
        {access.isAdmin && (
          <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
            Добавить
          </Button>
        )}
      </div>

      {/*
        Раньше здесь стояла одна серая строка «Пользователи не загрузились»
        с кнопкой повтора, и она отвечала на два разных вопроса сразу — причём
        в случае СБОЯ не показывалась вовсе: `employeesLoaded` при неудаче
        не поднимался, а эффект `if (!employeesLoaded) loadEmployees()` второй
        раз не срабатывает. Экран оставался пустым навсегда, и выходом была
        только перезагрузка страницы.
      */}
      {employeesError && !employeesLoaded && (
        <LoadFailed onRetry={loadEmployees} what="сотрудников" />
      )}
      {!employeesLoaded && !employeesError && (
        <TableSkeleton rows={5} label="Загрузка сотрудников" />
      )}
      {/*
        Отказ обязан назвать себя. Пустое место там, где человек ждёт список,
        читается как поломка, а список из одной строки — как правда.
      */}
      {!canManageAccounts && (
        <div className={styles.warnBox} role="status">
          Учётные записи ведёт администратор: список логинов, подтверждение доступа,
          роли и привязка к цеху закрыты и на сервере, поэтому здесь они не показаны.
          Вам доступны приглашения и цеховые работники без логина — на чтение.
        </div>
      )}

      {employeesLoaded && canManageAccounts
        && profileRows.length === 0 && looseEmployees.length === 0 && (
        <EmptyState
          icon="users"
          title="Сотрудников нет"
          text="Пригласите первого ссылкой — роль и участок задаются при выписке приглашения."
        />
      )}

      {/* Планшет и телефон: карточки вместо таблицы из семи колонок — колонка
          действий стоит последней и ниже 1024px уезжала за край экрана */}
      {profileRows.length > 0 && compact && (
        <div className={styles.dataCardList}>
          {profileRows.map((p) => (
            <EmployeeCard
              key={p.id}
              p={p}
              emp={empByProfile.get(p.id)}
              me={me}
              status={statusChip(p)}
              roles={ALL_ROLES}
              roleLabels={ROLE_LABELS}
              departments={departments}
              onChangeRole={onChangeRole}
              onUpsertDept={upsertProfileDept}
              actions={rowActions(p)}
            />
          ))}
        </div>
      )}

      {profileRows.length > 0 && !compact && (
        <ScrollHintBox className={styles.tableWrap} wrapClassName={styles.scrollHintGapBottom} label="Сотрудники">
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Имя</th><th>Email</th><th>Роль</th><th>Цех</th>
                <th>Цеховая роль</th><th>Статус</th><th aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {profileRows.map((p) => {
                const emp = empByProfile.get(p.id);
                const st = statusChip(p);
                return (
                  <tr key={p.id} className={p.active === false ? styles.rowDisabled : undefined}>
                    <td>
                      <strong>{p.name || '—'}</strong>
                      {p.id === me?.id && <span className={styles.subText}> · вы</span>}
                    </td>
                    <td className={styles.subText}>{p.email}</td>
                    <td>
                      <RoleSelect
                        p={p} me={me} roles={ALL_ROLES}
                        roleLabels={ROLE_LABELS} onChange={onChangeRole}
                      />
                    </td>
                    <td>
                      <DeptSelect
                        value={emp?.department_id}
                        label={p.name || p.email}
                        departments={departments}
                        onChange={(id) => upsertProfileDept(p, { department_id: id })}
                      />
                    </td>
                    <td>
                      <EmployeeRoleSelect
                        value={emp?.role}
                        label={p.name || p.email}
                        onChange={(role) => upsertProfileDept(p, { role })}
                      />
                    </td>
                    <td>
                      <span className={`${styles.chip} ${styles[st.cls]}`}>{st.label}</span>
                    </td>
                    <td className={styles.nowrap}>{rowActions(p)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollHintBox>
      )}

      <h2 className={styles.queueGroupTitle}>Без логина (цеховые)</h2>
      <p className={styles.subText} style={{ marginTop: -6, marginBottom: 10 }}>
        Работники, которые пока не заходят в систему сами. Появится логин — привяжутся к общему списку.
      </p>

      {/*
        `erp_employees` читают все участники, а правит только `is_admin()` —
        поэтому список остаётся видимым, а правка гасится целиком. Нативный
        `fieldset[disabled]` честен для клавиатуры и не забудет ни одного
        из двух десятков полей, в отличие от `disabled` на каждом.
      */}
      <ReadOnlyFieldset
        canManage={canManageAccounts}
        note="Правка цеховых работников доступна только администратору."
      >
      {looseEmployees.length > 0 && compact && (
        <div className={styles.dataCardList}>
          {looseEmployees.map((emp) => (
            <LooseEmployeeCard
              key={emp.id}
              emp={emp}
              departments={departments}
              onUpdate={updateEmployee}
              actions={looseActions(emp)}
            />
          ))}
        </div>
      )}

      {looseEmployees.length > 0 && !compact && (
        <ScrollHintBox className={styles.tableWrap} wrapClassName={styles.scrollHintGapBottom} label="Работники без логина">
          <table className={styles.table}>
            <thead>
              <tr><th>Имя</th><th>Цех</th><th>Цеховая роль</th><th>Заметка</th><th aria-label="Действия" /></tr>
            </thead>
            <tbody>
              {looseEmployees.map((emp) => {
                return (
                  <tr key={emp.id} className={emp.active ? undefined : styles.rowDisabled}>
                    <td><strong>{emp.full_name}</strong></td>
                    <td>
                      <DeptSelect
                        value={emp.department_id}
                        label={emp.full_name}
                        departments={departments}
                        onChange={(id) => updateEmployee(emp.id, { department_id: id })}
                      />
                    </td>
                    <td>
                      <EmployeeRoleSelect
                        value={emp.role}
                        label={emp.full_name}
                        onChange={(role) => updateEmployee(emp.id, { role })}
                      />
                    </td>
                    <td>
                      <InlineEdit
                        value={emp.notes}
                        placeholder="добавить…"
                        ariaLabel={`Заметка ${emp.full_name}`}
                        onSave={(v) => updateEmployee(emp.id, { notes: v })}
                      />
                    </td>
                    <td>{looseActions(emp)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollHintBox>
      )}

      <form
        className={styles.addMatRow}
        onSubmit={async (e) => {
          e.preventDefault();
          const name = newName.trim();
          if (!name) { toast.error('Укажите имя'); return; }
          const row = await createEmployee({ full_name: name, role: 'worker' });
          if (row) setNewName('');
        }}
      >
        <input
          className={styles.input}
          placeholder="Имя нового работника без логина"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          aria-label="Имя нового работника"
          style={{ minWidth: 240 }}
        />
        <Button variant="secondary" type="submit">+ Добавить без логина</Button>
      </form>
      </ReadOnlyFieldset>
    </>
  );
}
