import { describe, it, expect } from 'vitest';
import { flat } from '../../design/fixtures.testutil';
import { sleevedFlat } from '../../design/fixtures5b.testutil';
import { summarizeRemoved } from '../../design/edit/newFlat';
import {
  areaFieldId, calibrateFlatView, exactCopy, flatConflictText, historyText, issueTarget, mirrorButtonLabel,
  mirrorConfirmText, neighbourView, removedSummary, removeViewConfirmText, saveButtonLabel, saveDoneText,
  saveProgressText, silhouetteWidth, spokenSaveText, tooBigText, typeOfCategory, viewFieldId, viewOrder, withViewsFrom,
} from './flatEditorView';
import { parseMm } from './flatParse';

describe('flatEditorView — кнопка и итоги (К6)', () => {
  it('кнопка называет результат', () => {
    expect(saveButtonLabel({ isNew: true, geometry: true, nextVersion: 1 })).toBe('Создать флэт');
    expect(saveButtonLabel({ isNew: false, geometry: false, nextVersion: 1 })).toBe('Сохранить флэт');
    expect(saveButtonLabel({ isNew: false, geometry: true, nextVersion: 3 })).toBe('Выпустить версию 3');
  });

  it('итог сохранения и прогресс', () => {
    expect(saveDoneText({ isNew: true, released: 1 })).toBe('Флэт создан');
    expect(saveDoneText({ isNew: false, released: null })).toBe('Флэт сохранён');
    expect(saveDoneText({ isNew: false, released: 4 })).toBe('Выпущена версия 4: новые нанесения пойдут по ней');
    expect(saveProgressText({ done: 2, total: 4, phase: 'files' })).toBe('Загружаю файлы флэта: 2 из 4…');
    expect(saveProgressText({ done: 4, total: 4, phase: 'catalog' })).toBe('Сохраняю справочник флэтов…');
    expect(saveProgressText(null)).toBe('');
  });

  it('диктору — фаза, а не каждый файл: строка не меняется по ходу загрузки', () => {
    const a = spokenSaveText({ done: 1, total: 4, phase: 'files' });
    expect(spokenSaveText({ done: 3, total: 4, phase: 'files' })).toBe(a);
    expect(a).toBe('Загружаю файлы флэта: 4 файла…');
    expect(spokenSaveText({ done: 4, total: 4, phase: 'catalog' })).toBe('Сохраняю справочник флэтов…');
  });
});

describe('flatEditorView — тексты плана', () => {
  it('конфликт, история, файл больше 1 МБ', () => {
    expect(flatConflictText('Поло')).toMatch(/^Флэт «Поло» уже изменил другой администратор\. Ваши правки не сохранены, но остаются на экране, выбранные SVG — тоже\./);
    expect(historyText({ version: 1, views: flat().views })).toBe('Версия 1 · 2 вида · 3 зоны — по ней рисуются нанесения, размещённые на версии 1');
    expect(tooBigText(1468006)).toBe('Файл весит 1,4 МБ — силуэт должен быть не больше 1 МБ. Упростите контур или уберите вложенные картинки');
  });

  it('подтверждения зеркала и удаления вида называют последствия', () => {
    expect(mirrorConfirmText('sleeve_left', 2, 3)).toBe('Заменить правый рукав зеркальной копией левого? Текущий правый рукав (зон: 2) уйдёт в версию 3, заказы на ней не изменятся');
    expect(removeViewConfirmText('back', 2)).toBe('Удалить вид «Спина»? Сохранится новой версией; заказы на версии 2 сохранят спину');
    expect(mirrorButtonLabel('sleeve_left')).toBe('Сделать правый рукав зеркально');
    expect(mirrorButtonLabel('sleeve_right')).toBe('Сделать левый рукав зеркально');
  });

  it('«Из файла убрано»: итог одной строкой, список не длиннее 20 строк', () => {
    const many = Array.from({ length: 5000 }, (_, i) => `path@on${i} (event)`).concat('<script>', '<script>', 'a@href (href)');
    const items = summarizeRemoved(many);
    expect(items.length).toBeLessThanOrEqual(20);
    expect(removedSummary(items)).toBe('Файл очищен: убрано 5003 элемента, список ниже');
    expect(removedSummary([])).toBe('');
  });
});

describe('flatEditorView — адреса замечаний («Перейти»)', () => {
  it('зона → вкладка «Зоны», вид, зона и поле', () => {
    expect(issueTarget({ text: 'x', view: 'back', areaId: 'label', field: 'zone_id' }))
      .toEqual({ panel: 'zones', view: 'back', areaId: 'label', fieldId: areaFieldId('back', 'label', 'zone_id') });
    expect(issueTarget({ text: 'x', view: 'front', areaId: 'chest', field: 'nope' }).fieldId).toBe(areaFieldId('front', 'chest', 'name'));
  });

  it('вид → «Вид», флэт → «Модель и подбор», размер справочника → «История»', () => {
    expect(issueTarget({ text: 'x', view: 'front', field: 'anchors' })).toEqual({ panel: 'view', view: 'front', fieldId: viewFieldId('front', 'anchors') });
    expect(issueTarget({ text: 'x', field: 'sku_codes' })).toEqual({ panel: 'model', fieldId: 'ff-sku_codes' });
    expect(issueTarget({ text: 'x', field: 'history' })).toEqual({ panel: 'history', fieldId: 'flat-history' });
    expect(issueTarget({ text: 'x' })).toEqual({ panel: 'model', fieldId: 'ff-name' });
  });
});

describe('flatEditorView — виды и правка', () => {
  it('порядок видов и сосед после удаления: предыдущий, иначе следующий', () => {
    const f = sleevedFlat();
    expect(viewOrder(f)).toEqual(['front', 'back', 'sleeve_left', 'sleeve_right']);
    expect(neighbourView(viewOrder(f), 'back')).toBe('front');
    expect(neighbourView(viewOrder(f), 'front')).toBe('back');
    expect(neighbourView(['front'], 'front')).toBeNull();
  });

  it('калибровка вида умножает позиции; ширина силуэта до десятых', () => {
    const src = flat();
    const f = calibrateFlatView(src, 'front', 2);
    expect(f.views[0].scale_mm_per_unit).toBe(2);
    expect(f.views[0].print_areas[0].polygon_mm[0]).toEqual([300, 280]);
    expect(f.views[1]).toBe(src.views[1]);
    expect(calibrateFlatView(f, 'front', 1)).toBe(f);
    expect(silhouetteWidth(600, 0.5)).toBe(300);
  });

  it('тип изделия по категории модели', () => {
    expect(typeOfCategory('hoodies')).toBe('hoodie');
    expect(typeOfCategory('nope')).toBeNull();
    expect(typeOfCategory(undefined)).toBeNull();
  });

  it('точный силуэт: новые id и имя, v1, не типовой, без моделей и истории, пути v1', () => {
    const src = { ...flat({ version: 3, sku_codes: ['T-001'] }), history: [{ version: 1, views: flat().views }] };
    const c = exactCopy(src, 'polo-exact', 'Поло точное');
    expect(c).toMatchObject({ id: 'polo-exact', name: 'Поло точное', version: 1, typical: false, active: false, sku_codes: [] });
    expect(c.history).toBeUndefined();
    expect(c.views.map((v) => v.svg_path)).toEqual(['flats/polo-exact/v1/front.svg', 'flats/polo-exact/v1/back.svg']);
    expect(src.views[0].svg_path).toBe('flats/tshirt-test/v3/front.svg');
  });

  it('«Применить выбранные файлы»: виды с файлами — из прежнего черновика, прочее — свежее', () => {
    const fresh = flat({ name: 'Свежая' });
    const prev = sleevedFlat('tshirt-test', 1, ['sleeve_left']);
    const out = withViewsFrom(fresh, prev, ['sleeve_left', 'front']);
    expect(out.name).toBe('Свежая');
    expect(viewOrder(out)).toEqual(['front', 'back', 'sleeve_left']);
    expect(out.views.find((v) => v.kind === 'sleeve_left')).toBe(prev.views[2]);
  });
});

describe('flatParse — числа полей', () => {
  it('запятая как точка, границы, «ещё набирают»', () => {
    expect(parseMm('12,5', 0, 100)).toBe(12.5);
    expect(parseMm('12,', 0, 100)).toBe(12);
    expect(parseMm('abc', 0, 100)).toBeUndefined();
    expect(parseMm('500', 0, 100)).toBeUndefined();
    expect(parseMm('', 0, 100)).toBeUndefined();
    expect(parseMm('', 0, 100, true)).toBeNull();
  });
});
