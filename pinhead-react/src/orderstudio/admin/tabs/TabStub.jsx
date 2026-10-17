import { EmptyState } from '../../../erp/components/ErpStates';

/**
 * Заглушка вкладки, пока её редактор не готов (веха 4: задачи 3–5 заменяют
 * вкладки по одной). Справочник при этом работает: заказы считают по нему
 * или по встроенным значениям.
 */
export default function TabStub({ name, readOnly }) {
  return (
    <div data-readonly={readOnly ? 'true' : undefined}>
      <EmptyState
        icon="settings"
        title={name}
        text={`Редактор справочника «${name}» появится в следующем обновлении.`}
      />
    </div>
  );
}
