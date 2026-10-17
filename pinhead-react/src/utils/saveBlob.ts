/**
 * Сохранить Blob файлом на компьютер (PDF макета, веха 5а, задача 7).
 *
 * Ссылка всегда с `download`: браузер СКАЧИВАЕТ файл, а не открывает его
 * у себя — object URL никуда не переходит и не живёт в разметке. Поэтому
 * помощник и лежит здесь, а не в `orderstudio/design/`: там ссылок с object
 * URL нет совсем (проверка безопасности H2 — логотипы показываются только `<img>`).
 *
 * URL освобождается не сразу: часть браузеров читает Blob уже после клика
 * (тот же приём и срок, что у FileSaver.js).
 */
export const SAVE_REVOKE_MS = 40_000;

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.hidden = true;
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), SAVE_REVOKE_MS);
  }
}
