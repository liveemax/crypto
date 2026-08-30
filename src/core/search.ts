/**
 * Регистронезависимая подстрока хотя бы в одном поле. needle приходит уже
 * trim+lowerCase от вызывающего DTO; здесь дополнительно не нормализуется,
 * чтобы пустая строка не превращалась в «совпадает всегда».
 */
export function matchesSearch(needle: string, ...fields: (string | null | undefined)[]): boolean {
  return fields.some((field) => field != null && field.toLowerCase().includes(needle));
}
