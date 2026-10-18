import { HARDWARE_GROUPS } from '../../../data/extras';
import ScrollTable from './ScrollTable';
import { Button } from '../../../erp/components/Button';
import a11y from '../../../orderstudio/ui/a11y.module.css';
import t from './skuTable.module.css';

/** Вкладка «Фурнитура»: комплектующие по группам, цена за штуку */
export default function SkuHardwareTab({ hardwareCatalog, updateHardware, addHardware, deleteHardware, readOnly = false }) {
  return (
    <div className={t.body}>
      {HARDWARE_GROUPS.map((g) => {
        const items = hardwareCatalog.filter((h) => h.group === g.id);
        return (
          <section key={g.id} className={t.group} aria-labelledby={`sku-hw-${g.id}`}>
            <div className={t.toolbar}>
              <h2 id={`sku-hw-${g.id}`} className={t.groupHead}>
                {g.name}
                <span className={t.groupCount}>{items.length}</span>
              </h2>
              <span className={t.spacer} />
              {!readOnly && (
                <Button icon="plus" onClick={() => addHardware(g.id)} aria-label={`Добавить: ${g.name}`}>Добавить</Button>
              )}
            </div>
            <ScrollTable label={`Фурнитура: ${g.name}`} readOnly={readOnly}>
              <table className={t.table}>
                <thead>
                  <tr>
                    <th scope="col">№</th>
                    <th scope="col">Код</th>
                    <th scope="col">Название</th>
                    <th scope="col">Цена, ₽</th>
                    <th scope="col"><span className={a11y.srOnly}>Удалить</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((h) => {
                    const realIdx = hardwareCatalog.indexOf(h);
                    return (
                      <tr key={h.code + realIdx}>
                        <td className={`${t.num} ${t.dim}`}>{realIdx + 1}</td>
                        <td className={t.code}>{h.code}</td>
                        <td>
                          <input type="text" className={`${t.input} ${t.name}`} value={h.name} aria-label={`Название: ${h.code}`}
                            onChange={(e) => updateHardware(realIdx, 'name', e.target.value)} />
                        </td>
                        <td>
                          <input className={`${t.input} ${t.numInput}`} type="number" value={h.price} aria-label={`Цена, ₽: ${h.name}`}
                            onChange={(e) => updateHardware(realIdx, 'price', Number(e.target.value) || 0)} />
                        </td>
                        <td>
                          <Button variant="ghost" icon="trash" iconOnly aria-label={`Удалить: ${h.name}`}
                            onClick={() => deleteHardware(realIdx)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollTable>
          </section>
        );
      })}
    </div>
  );
}
