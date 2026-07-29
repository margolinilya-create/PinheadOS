-- Выгружено дословно из истории прода (pinhead-os-v2),
-- версия 20260415202746 `20260530_hr_role_and_payroll_close`.
--
-- Исторически файл вводил роль `hr`: предикат auth_is_hr() и права этой роли на
-- сдельную оплату — workers, piecework_batches, piecework_entries.
-- ВСЕ объекты, которых он касается (сами таблицы и предикаты auth_is_*), снесены
-- ниже по порядку миграцией 20260716120000_drop_legacy_erp_redesign_v2, поэтому
-- в baseline репозитория их нет и на чистой базе быть не может.
-- Отсюда guard: операции над легаси-таблицами идут под проверкой to_regclass и на
-- свежем окружении молча пропускаются. Создание auth_is_hr() оставлено безусловным —
-- оно зависит только от public.profiles из baseline и упасть не может.

CREATE OR REPLACE FUNCTION auth_is_hr() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = 'hr'
        AND COALESCE(active, true) = true
    );
  $$;

COMMENT ON FUNCTION auth_is_hr() IS
  'RLS predicate: is current user in the hr role (manages workers + payroll close).';

-- ── Легаси-таблицы сдельной оплаты ─────────────────────────────────────────
-- Выполняется только там, где эти таблицы реально есть (прод до drop_legacy).
-- Предикаты auth_is_admin_or_director() / auth_is_senior_foreman() — из той же
-- легаси-эпохи: где живы таблицы, живы и они.
DO $$
BEGIN
  IF to_regclass('public.workers') IS NOT NULL THEN
    DROP POLICY IF EXISTS workers_write_admin_senior_foreman ON workers;

    CREATE POLICY workers_write_admin_senior_foreman_hr ON workers
      FOR ALL
      USING (auth_is_admin_or_director() OR auth_is_senior_foreman() OR auth_is_hr())
      WITH CHECK (auth_is_admin_or_director() OR auth_is_senior_foreman() OR auth_is_hr());
  ELSE
    RAISE NOTICE 'skip workers: таблицы нет (легаси-схема erp_redesign_v2 не создавалась)';
  END IF;

  IF to_regclass('public.piecework_batches') IS NOT NULL THEN
    DROP POLICY IF EXISTS piecework_batches_write_admin ON piecework_batches;

    CREATE POLICY piecework_batches_write_admin_senior_hr ON piecework_batches
      FOR ALL
      USING (
        auth_is_admin_or_director()
        OR auth_is_senior_foreman()
        OR auth_is_hr()
      )
      WITH CHECK (
        auth_is_admin_or_director()
        OR auth_is_senior_foreman()
        OR auth_is_hr()
      );
  ELSE
    RAISE NOTICE 'skip piecework_batches: таблицы нет (легаси-схема erp_redesign_v2 не создавалась)';
  END IF;

  IF to_regclass('public.piecework_entries') IS NOT NULL THEN
    DROP POLICY IF EXISTS piecework_entries_update_admin_unpaid ON piecework_entries;

    CREATE POLICY piecework_entries_update_admin_senior_hr_unpaid ON piecework_entries
      FOR UPDATE
      USING (
        (auth_is_admin_or_director() OR auth_is_senior_foreman() OR auth_is_hr())
        AND paid_at IS NULL
      )
      WITH CHECK (
        auth_is_admin_or_director() OR auth_is_senior_foreman() OR auth_is_hr()
      );
  ELSE
    RAISE NOTICE 'skip piecework_entries: таблицы нет (легаси-схема erp_redesign_v2 не создавалась)';
  END IF;
END $$;
