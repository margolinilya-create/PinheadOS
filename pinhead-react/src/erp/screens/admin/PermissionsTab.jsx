import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { isAllowed } from '../../utils/permissions';
import { Icon } from '../../components/Icon';
import {
  EMPLOYEE_ROLE_LABELS,
  ERP_PERMISSIONS,
  ERP_PERMISSION_LABELS,
} from '../../types';
import { Button } from '../../components/Button';
import { formatDateTimeShort } from '../../utils/format';
import styles from '../../styles';
import { ScrollHintBox } from '../../components/ScrollHintBox';
import { LoadFailed } from '../../components/ErpStates';
import { TableSkeleton } from '../../components/ErpSkeletons';

/**
 * Матрица прав «право × роль» (правка 11) — редактируется руководством,
 * сохраняется в erp_role_permissions и сразу действует у всех (realtime).
 *
 * Роли — единый словарь цеховых ролей; роль профиля Order Studio приводится
 * к нему на клиенте (utils/permissions.resolveErpRole), поэтому матрицу
 * не приходится вести дважды.
 */

/** Порядок ролей — от руководства к исполнителям, участки нанесения рядом */
const ROLES = [
  'director', 'production_head', 'dispatcher', 'manager', 'technologist', 'foreman',
  'worker', 'dtf', 'dtg', 'silkscreen', 'embroidery', 'purchaser', 'storekeeper', 'hr',
  // Новичок до назначения должности — последним: это не должность, а состояние
  'pending',
];

/**
 * Колонки, которые правятся только чтением, и причина у каждой своя.
 *
 * `director` — профили `admin` и `director` приводятся к этой цеховой роли
 * (utils/permissions.resolveErpRole), обхода матрицы для них нет. Админ,
 * снявший здесь галочку, отключал право самому себе и вернуть его через
 * интерфейс уже не мог.
 *
 * `pending` — под неё попадает КАЖДЫЙ, кто только что зарегистрировался и ещё
 * не получил должность. Смысл роли в том, что прав у неё нет; одна галочка
 * здесь раздала бы право всем неназначенным разом, и заметить это было бы
 * нечем. Права выдаются назначением должности, а не правкой этой колонки.
 */
/**
 * ГРУППЫ ПРАВ (§5 обхода 04.09). Семнадцать строк шли сплошным списком
 * в порядке объявления перечисления, и найти в нём «кто ведёт склад» можно
 * было только вычитыванием всех семнадцати. Группировка — единственное,
 * что здесь помогает: ширину таблице не уменьшить, колонок пятнадцать
 * по числу ролей, и это данные, а не оформление.
 *
 * Порядок групп повторяет путь заказа по фабрике: цех → заказ → снабжение
 * и склад → план → администрирование. Право, не попавшее ни в одну группу,
 * не теряется — оно уезжает в «Прочее» (сторож на это есть).
 */
const PERMISSION_GROUPS = [
  { title: 'Работа цеха', keys: [
    'stage.take', 'stage.progress', 'stage.complete', 'stage.block', 'stage.defect'] },
  { title: 'Управление очередью и маршрутом', keys: [
    'stage.priority', 'stage.move_department', 'order.manage', 'tz.manage'] },
  { title: 'Снабжение и склад', keys: ['material.receive', 'warehouse.manage'] },
  { title: 'Планирование', keys: ['plan.manage', 'plan.fact'] },
  { title: 'Настройка системы', keys: [
    'catalog.edit', 'experimental.manage', 'bypass.manage', 'staff.invite'] },
];

const LOCKED_ROLES = {
  director: 'Колонка руководства — не редактируется',
  pending: 'Роль без прав по определению — назначьте человеку должность',
};

export function PermissionsTab() {
  const {
    permissionMatrix, permissionTrail, permissionsLoaded, permissionsError,
    loadPermissions, setRolePermission, employees,
  } = useErpStore(
    useShallow((s) => ({
      permissionMatrix: s.permissionMatrix,
      permissionTrail: s.permissionTrail,
      permissionsLoaded: s.permissionsLoaded,
      permissionsError: s.permissionsError,
      loadPermissions: s.loadPermissions,
      setRolePermission: s.setRolePermission,
      employees: s.employees,
    })),
  );

  /**
   * ОТМЕНА ПОСЛЕДНЕЙ ПРАВКИ (§5 обхода 04.09). Клик по галочке записывался
   * мгновенно и отката не имел вовсе: промахнулся в таблице 15×17 — ищи,
   * где именно. Подтверждение на КАЖДУЮ галочку сделало бы экран
   * неработоспособным, поэтому отмена, а не вопрос: она называет, что именно
   * вернёт, и живёт ровно до следующей правки.
   */
  const [lastChange, setLastChange] = useState(null);

  const toggle = async (role, permission, allowed) => {
    const ok = await setRolePermission(role, permission, allowed);
    if (ok) setLastChange({ role, permission, was: !allowed });
  };

  const undo = async () => {
    if (!lastChange) return;
    const ok = await setRolePermission(lastChange.role, lastChange.permission, lastChange.was);
    if (ok) setLastChange(null);
  };

  /** Имя по uuid — из уже загруженного списка сотрудников, второго запроса не заводим */
  const nameById = useMemo(
    () => new Map((employees ?? []).filter((e) => e.profile_id).map((e) => [e.profile_id, e.full_name])),
    [employees],
  );

  /**
   * Группы прав + «Прочее»: право, забытое в `PERMISSION_GROUPS`, обязано
   * остаться видимым. Пропуск в перечислении не роняет ничего — он молча
   * прячет настройку, и заметить это можно только по жалобе.
   */
  const groups = useMemo(() => {
    const placed = new Set(PERMISSION_GROUPS.flatMap((g) => g.keys));
    const rest = ERP_PERMISSIONS.filter((p) => !placed.has(p));
    const known = PERMISSION_GROUPS
      .map((g) => ({ ...g, keys: g.keys.filter((k) => ERP_PERMISSIONS.includes(k)) }))
      .filter((g) => g.keys.length > 0);
    return rest.length > 0 ? [...known, { title: 'Прочее', keys: rest }] : known;
  }, []);

  useEffect(() => {
    if (!permissionsLoaded) loadPermissions();
  }, [permissionsLoaded, loadPermissions]);

  /**
   * ОТКАЗ ЗАГРУЗКИ НЕ ПОКАЗЫВАЕТСЯ ДЕФОЛТАМИ (правка 03.09).
   *
   * `isAllowed` при пустой матрице по построению падает на
   * `DEFAULT_PERMISSIONS` — и это верно для ПРОВЕРКИ права (fail-safe:
   * пока матрица не приехала, цех работает по запасным значениям).
   * Но здесь РЕДАКТОР: та же подстановка рисовала правдоподобную матрицу,
   * которой нет в базе, ничего об этом не говорила, и переключение галочки
   * шло поверх вымысла. Админ видел право у роли, снятое на сервере,
   * а цех получал 42501 на кнопке, которая по матрице разрешена.
   *
   * Экран настроек — худшее место для правдоподобно неверных данных,
   * поэтому здесь отказ называется прямо, и матрица не рисуется вовсе.
   */
  if (permissionsError) {
    return <LoadFailed onRetry={loadPermissions} what="матрицу прав" />;
  }
  if (!permissionsLoaded) {
    return <TableSkeleton rows={8} label="Загрузка матрицы прав" />;
  }

  return (
    <>
      <div className={styles.queueReason} style={{ marginBottom: 12 }}>
        Матрица отвечает на вопрос «что этой роли вообще можно». Ограничение «только свой цех»
        проверяется отдельно — по привязке сотрудника к участку, и матрицей не отменяется.
        Колонка «{EMPLOYEE_ROLE_LABELS.director}» <Icon name="ban" size={13} /> не редактируется: под неё попадают
        и администраторы, снятая галочка отключила бы доступ им самим.
        Колонка «{EMPLOYEE_ROLE_LABELS.pending}» — тоже: с неё начинается каждая
        регистрация, и права там появляться не должны. Человеку назначают должность
        на вкладке «Пользователи», и права он получает вместе с ней.
      </div>

      <ScrollHintBox className={styles.tableWrap} label="Матрица прав по ролям">
        <table className={`${styles.table} ${styles.matrixTable}`}>
          <thead>
            <tr>
              <th>Право</th>
              {ROLES.map((r) => (
                <th key={r}>
                  {EMPLOYEE_ROLE_LABELS[r]}
                  {LOCKED_ROLES[r] && (
                    <span title={LOCKED_ROLES[r]}> <Icon name="ban" size={12} /></span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.title}>
              <tr>
                <th scope="colgroup" colSpan={ROLES.length + 1} className={styles.labelCaps}>
                  {g.title}
                </th>
              </tr>
              {g.keys.map((permission) => (
                <tr key={permission}>
                  <td>
                    <strong>{ERP_PERMISSION_LABELS[permission]}</strong>
                    <div className={styles.subText}>{permission}</div>
                  </td>
                  {ROLES.map((role) => {
                    const checked = isAllowed(permissionMatrix, role, permission);
                    const lockReason = LOCKED_ROLES[role];
                    const label = `${ERP_PERMISSION_LABELS[permission]} — ${EMPLOYEE_ROLE_LABELS[role]}`;
                    return (
                      <td key={role}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={Boolean(lockReason)}
                          aria-label={lockReason ? `${label} (не редактируется)` : label}
                          title={lockReason || label}
                          onChange={(e) => toggle(role, permission, e.target.checked)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </ScrollHintBox>

      {lastChange && (
        <div className={styles.matSectionHead} style={{ marginTop: 10 }}>
          <span className={styles.queueReason}>
            Изменено: «{ERP_PERMISSION_LABELS[lastChange.permission]}» у роли «
            {EMPLOYEE_ROLE_LABELS[lastChange.role]}».
          </span>
          <Button variant="secondary" onClick={undo}>
            <Icon name="undo" size={14} /> Отменить
          </Button>
        </div>
      )}

      {/*
        СЛЕД ПРАВОК. Не журнал и не выдаётся за него: строка в базе одна
        на пару «роль × право», поэтому видно ПОСЛЕДНЕГО писателя каждой пары.
        До 04.09 не было и этого — кто и когда снял право, узнать было негде.
      */}
      {permissionTrail.length > 0 && (
        <div className={styles.matSection}>
          <h3 className={styles.fieldLabel}>Кто менял права</h3>
          <p className={styles.subText}>
            Видно последнее изменение каждого права — полной истории система
            не ведёт.
          </p>
          {permissionTrail.map((r) => (
            <div key={`${r.role}:${r.permission}`} className={styles.queueReason}>
              {ERP_PERMISSION_LABELS[r.permission] || r.permission}
              {' · '}
              {EMPLOYEE_ROLE_LABELS[r.role] || r.role}
              {' — '}
              {r.allowed ? 'выдано' : 'снято'}
              {', '}
              {nameById.get(r.updated_by) || 'неизвестно'}
              {', '}
              {formatDateTimeShort(r.updated_at)}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
