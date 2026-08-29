import { applyPenalty, composite, type CompositeComponent } from '../src/core/ranking/composite';

function component(overrides: Partial<CompositeComponent> = {}): CompositeComponent {
  return { component: 'tokenomics', score: 80, weight: 0.35, dataQuality: 1, ...overrides };
}

describe('composite(): гейт и взвешенное среднее шага 15.1', () => {
  it('один известный компонент — composite null, причина и метаданные названы', () => {
    const result = composite([component()]);

    expect(result.composite).toBeNull();
    expect(result.componentsUsed).toEqual(['tokenomics']);
    expect(result.weightSum).toBe(0.35);
    expect(result.reason).toMatch(/минимум 2/);
  });

  it('два компонента с достаточной суммой весов дают ожидаемое взвешенное среднее', () => {
    const result = composite([
      component({ component: 'tokenomics', score: 80, weight: 0.35, dataQuality: 1 }),
      component({ component: 'valuation', score: 60, weight: 0.35, dataQuality: 0.5 }),
    ]);

    expect(result.weightSum).toBe(0.7);
    expect(result.composite).toBe(70);
    expect(result.dataQuality).toBe(0.75);
    expect(result.componentsUsed).toEqual(['tokenomics', 'valuation']);
    expect(result.reason).toBeNull();
  });

  it('три компонента: отсутствующий не входит ни в числитель, ни в знаменатель', () => {
    const result = composite([
      component({ component: 'tokenomics', score: 80, weight: 0.35, dataQuality: 1 }),
      component({ component: 'valuation', score: null, weight: 0.35, dataQuality: 1 }),
      component({ component: 'sectorPosition', score: 40, weight: 0.3, dataQuality: 1 }),
    ]);

    // (80*0.35 + 40*0.3) / (0.35+0.3) = (28+12)/0.65 = 61.54
    expect(result.weightSum).toBe(0.65);
    expect(result.composite).toBeCloseTo(61.54, 2);
    expect(result.componentsUsed).toEqual(['tokenomics', 'sectorPosition']);
  });

  it('НЕГАТИВНЫЙ: два компонента, но их сумма весов ниже 0.55 — composite null', () => {
    const result = composite([
      component({ component: 'tokenomics', score: 90, weight: 0.2, dataQuality: 1 }),
      component({ component: 'sectorPosition', score: 90, weight: 0.1, dataQuality: 1 }),
    ]);

    expect(result.composite).toBeNull();
    expect(result.weightSum).toBe(0.3);
    expect(result.reason).toMatch(/ниже порога/);
  });

  it('НЕГАТИВНЫЙ: ни одного известного компонента — composite и dataQuality нулевые, без деления на ноль', () => {
    const result = composite([
      component({ score: null }),
      component({ component: 'valuation', score: null }),
    ]);

    expect(result.composite).toBeNull();
    expect(result.dataQuality).toBe(0);
    expect(result.weightSum).toBe(0);
    expect(result.componentsUsed).toEqual([]);
  });

  it('applyPenalty: штраф вычитается из готового композита', () => {
    expect(applyPenalty(70, 10)).toBe(60);
  });

  it('applyPenalty: композит не опускается ниже нуля даже при штрафе больше базы', () => {
    expect(applyPenalty(15, 20)).toBe(0);
  });

  it('applyPenalty: null остаётся null независимо от штрафа', () => {
    expect(applyPenalty(null, 20)).toBeNull();
  });
});
