import { matchesSearch } from '../src/core/search';

describe('matchesSearch', () => {
  it('находит подстроку без учёта регистра в любом из полей', () => {
    expect(matchesSearch('aave', 'Aave', 'AAVE', 'aave')).toBe(true);
    expect(matchesSearch('ave', 'Aave', 'X', 'y')).toBe(true);
    expect(matchesSearch('ave', 'X', 'Aave', 'y')).toBe(true);
    expect(matchesSearch('ave', 'X', 'y', 'aave')).toBe(true);
  });

  it('не совпадает, если подстроки нет ни в одном поле', () => {
    expect(matchesSearch('uniswap', 'Aave', 'AAVE', 'aave')).toBe(false);
  });

  it('пропускает null/undefined поля, не бросая исключение', () => {
    expect(matchesSearch('aave', null, undefined, 'Aave Protocol')).toBe(true);
    expect(matchesSearch('missing', null, undefined)).toBe(false);
  });
});
