import Decimal from 'decimal.js';

type MoneyValue = Decimal.Value;

/** Складывает значения без использования арифметики с плавающей точкой. */
export function add(left: MoneyValue, right: MoneyValue): number {
  return new Decimal(left).plus(right).toNumber();
}

/** Вычитает значения без использования арифметики с плавающей точкой. */
export function sub(left: MoneyValue, right: MoneyValue): number {
  return new Decimal(left).minus(right).toNumber();
}

/** Умножает значения без использования арифметики с плавающей точкой. */
export function mul(left: MoneyValue, right: MoneyValue): number {
  return new Decimal(left).times(right).toNumber();
}

/** Делит значения без использования арифметики с плавающей точкой. */
export function div(left: MoneyValue, right: MoneyValue): number {
  return new Decimal(left).dividedBy(right).toNumber();
}

/** Возвращает долю части от целого в процентах. */
export function pctOf(part: MoneyValue, whole: MoneyValue): number {
  return new Decimal(part).dividedBy(whole).times(100).toNumber();
}

/** Округляет значение до заданного количества десятичных знаков. */
export function round(value: MoneyValue, digits: number): number {
  return new Decimal(value).toDecimalPlaces(digits).toNumber();
}
