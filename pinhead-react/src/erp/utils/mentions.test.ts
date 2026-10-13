import { describe, expect, it } from 'vitest';
import {
  applyMention, matchPeople, mentionQuery, mentionToken, mentionsInText, splitMentions,
} from './mentions';

/**
 * УПОМИНАНИЯ (правка 14.09, п. 5).
 *
 * Ошибиться здесь можно ровно двумя способами, и оба тихие: позвать того,
 * кого не звали (уведомление о сообщении, где человека нет), и не позвать
 * того, кого звали (сообщение висит без ответа, автор уверен, что окликнул).
 */

const PEOPLE = [
  { user_id: 'u1', name: 'Мария', email: 'tehnolog@pnhd.ru', role: null, department_id: null },
  { user_id: 'u2', name: 'Мария Иванова', email: 'marika@gmail.com', role: null, department_id: null },
  { user_id: 'u3', name: 'Аркадий', email: null, role: null, department_id: null },
];

describe('кого действительно упомянули', () => {
  const chosen = [{ user_id: 'u1', name: 'Мария' }, { user_id: 'u3', name: 'Аркадий' }];

  it('выбранный, чей токен стоит в тексте', () => {
    expect(mentionsInText('@Мария посмотри', chosen)).toEqual(['u1']);
  });

  it('выбранный, чей токен СТЁРЛИ, не зовётся', () => {
    // Иначе человек получил бы уведомление о сообщении, в котором его нет
    expect(mentionsInText('посмотри, пожалуйста', chosen)).toEqual([]);
  });

  it('текст «@Имя» БЕЗ выбора из списка упоминанием не считается', () => {
    // Прямое требование документа: разбор текста обратно в людей дал бы
    // уведомление тёзке и превратил бы «@ткань» в адресата
    expect(mentionsInText('@Мария посмотри', [])).toEqual([]);
  });

  it('повтор токена не удваивает адресата', () => {
    expect(mentionsInText('@Мария и ещё раз @Мария', chosen)).toEqual(['u1']);
  });
});

describe('что человек набирает после @', () => {
  it('подсказка открывается на собаке в начале слова', () => {
    expect(mentionQuery('позови @Мар', 11)).toEqual({ query: 'Мар', from: 7 });
    expect(mentionQuery('@', 1)).toEqual({ query: '', from: 0 });
  });

  it('адрес почты в тексте подсказку НЕ открывает', () => {
    // `za@pnhd.ru` — не начало упоминания, а обычное слово
    expect(mentionQuery('пиши на za@pnhd.ru', 18)).toBeNull();
  });

  it('перевод строки закрывает набор', () => {
    expect(mentionQuery('@Мария\nвторая строка', 20)).toBeNull();
  });

  it('до собаки подсказки нет вовсе', () => {
    expect(mentionQuery('просто текст', 12)).toBeNull();
  });
});

describe('поиск сотрудника', () => {
  it('по имени И по email — требование документа', () => {
    expect(matchPeople(PEOPLE, 'арк').map((p) => p.user_id)).toEqual(['u3']);
    expect(matchPeople(PEOPLE, 'marika').map((p) => p.user_id)).toEqual(['u2']);
  });

  it('пустой запрос показывает начало списка, а не пустоту', () => {
    // Человек нажал `@` — ему нужен список, а не приглашение угадывать
    expect(matchPeople(PEOPLE, '').length).toBe(3);
  });
});

describe('подстановка выбранного', () => {
  it('заменяет набранное и ставит пробел', () => {
    const r = applyMention('позови @Мар', 7, 11, PEOPLE[0]);
    expect(r.text).toBe('позови @Мария ');
    expect(r.caret).toBe(r.text.length);
  });

  it('хвост сообщения сохраняется', () => {
    const r = applyMention('@Мар посмотри', 0, 4, PEOPLE[0]);
    expect(r.text).toBe('@Мария  посмотри');
  });
});

describe('подсветка в ленте', () => {
  it('подсвечиваются только настоящие адресаты сообщения', () => {
    const parts = splitMentions('@Мария и @Аркадий', ['u1'], PEOPLE);
    expect(parts.filter((p) => p.mention).map((p) => p.text)).toEqual([mentionToken('Мария')]);
    // Текст не теряется и не дублируется
    expect(parts.map((p) => p.text).join('')).toBe('@Мария и @Аркадий');
  });

  it('длинное имя не съедается коротким тёзкой', () => {
    // «Мария» — префикс «Марии Ивановой»: разбор в обратном порядке
    // подсветил бы половину имени и оставил «Иванова» простым текстом
    const parts = splitMentions('@Мария Иванова, привет', ['u2'], PEOPLE);
    expect(parts.find((p) => p.mention)?.text).toBe('@Мария Иванова');
  });

  it('без упоминаний текст остаётся одним куском', () => {
    expect(splitMentions('обычный текст', [], PEOPLE))
      .toEqual([{ text: 'обычный текст', mention: false }]);
  });

  it('упомянутый, которого нет в справочнике, не ломает разбор', () => {
    expect(splitMentions('@Кто-то', ['неизвестный'], PEOPLE))
      .toEqual([{ text: '@Кто-то', mention: false }]);
  });
});
