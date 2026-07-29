-- Выгружено дословно из истории прода (pinhead-os-v2),
-- версия 20260415202746 `20260530_hr_role_and_payroll_close`.
-- Легаси-схема «erp_redesign_v2»: роль hr (предикат auth_is_hr) и права на
-- workers / piecework_batches / piecework_entries.
-- ВНИМАНИЕ: все эти объекты позже удалены миграцией drop_legacy_erp_redesign_v2 —
-- при реплее с нуля файл упадёт (таблиц workers/piecework_* в baseline нет).
-- Хранится как исторический артефакт истории прода, не для чистого реплея.

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

DROP POLICY IF EXISTS workers_write_admin_senior_foreman ON workers;

CREATE POLICY workers_write_admin_senior_foreman_hr ON workers
  FOR ALL
  USING (auth_is_admin_or_director() OR auth_is_senior_foreman() OR auth_is_hr())
  WITH CHECK (auth_is_admin_or_director() OR auth_is_senior_foreman() OR auth_is_hr());

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
