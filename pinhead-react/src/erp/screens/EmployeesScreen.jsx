import { PageHead, Stub } from '../components/PageHead';

export default function EmployeesScreen() {
  return (
    <>
      <PageHead title="Сотрудники" sub="Управление сотрудниками (HR + Директор), вход по логину." />
      <Stub
        icon="👥"
        title="Модуль сотрудников в разработке"
        text="CRUD сотрудников, роли, закрепление за цехом, флаг бригадира, soft-delete."
        phase="Фаза 1"
      />
    </>
  );
}
