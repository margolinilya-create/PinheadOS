import { HARDWARE_GROUPS } from '../../../data/extras';

export default function SkuHardwareTab({
  hardwareCatalog, updateHardware, addHardware, deleteHardware,
}) {
  return (
    <div className="sku-ed-body">
      {HARDWARE_GROUPS.map(g => {
        const items = hardwareCatalog.filter(h => h.group === g.id);
        return (
          <div key={g.id} className="sku-ed-group">
            <div className="sku-ed-group-header">
              <span>{g.name}</span>
              <span className="sku-ed-group-count">{items.length}</span>
              <button className="sku-ed-add-btn-sm" onClick={() => addHardware(g.id)}>+</button>
            </div>
            <table className="sku-ed-table">
              <thead>
                <tr>
                  <th className="sku-th-num">№</th>
                  <th className="sku-th-art">Код</th>
                  <th className="sku-th-name">Название</th>
                  <th className="sku-th-price">Цена ₽</th>
                  <th className="sku-th-del"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((h) => {
                  const realIdx = hardwareCatalog.indexOf(h);
                  return (
                    <tr key={h.code + realIdx}>
                      <td className="sku-td-num">{realIdx + 1}</td>
                      <td className="sku-td-art">{h.code}</td>
                      <td>
                        <input className="sku-edit-input sku-edit-name" value={h.name}
                          onChange={e => updateHardware(realIdx, 'name', e.target.value)} />
                      </td>
                      <td>
                        <input className="sku-edit-input sku-edit-num" type="number" value={h.price}
                          onChange={e => updateHardware(realIdx, 'price', Number(e.target.value) || 0)} />
                      </td>
                      <td><button className="sku-del-btn" onClick={() => deleteHardware(realIdx)} aria-label="Удалить комплектующее">✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
