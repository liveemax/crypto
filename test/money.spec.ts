import { add, div, mul, pctOf, round, sub } from '../src/core/money';

describe('money', () => {
  it('выполняет финансовые операции через Decimal', () => {
    expect(add(0.1, 0.2)).toBe(0.3);
    expect(sub(0.3, 0.1)).toBe(0.2);
    expect(mul('0.1', '0.2')).toBe(0.02);
    expect(div(1, 4)).toBe(0.25);
    expect(pctOf(1, 4)).toBe(25);
    expect(round('1.005', 2)).toBe(1.01);
  });
});
