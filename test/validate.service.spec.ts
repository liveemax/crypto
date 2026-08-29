import { checkMetrics, metric } from '../src/core/validate/validate.service';

describe('checkMetrics', () => {
  it('обнуляет метрику без источника и снижает качество данных', () => {
    const validated = checkMetrics({
      mcap: metric(45_000_000, null, new Date().toISOString(), 'USD'),
      revenue: metric(1_000_000, 'https://example.com', new Date().toISOString(), 'USD'),
    });

    expect(validated.metrics.mcap).toMatchObject({ value: null, droppedReason: 'no_source' });
    expect(validated.missing).toContain('mcap');
    expect(validated.validator?.dropped).toContain('mcap');
    expect(validated.dataQuality).toBe(0.5);
  });

  it('сохраняет устаревшую метрику и применяет штраф к качеству данных', () => {
    const oldDate = new Date();
    oldDate.setUTCMonth(oldDate.getUTCMonth() - 8);
    const validated = checkMetrics({ mcap: metric(45_000_000, 'https://example.com', oldDate.toISOString(), 'USD') });

    expect(validated.metrics.mcap.value).toBe(45_000_000);
    expect(validated.metrics.mcap.staleDays).toBeGreaterThan(45);
    expect(validated.validator?.stale).toEqual(['mcap']);
    expect(validated.dataQuality).toBe(0.85);
  });

  it('оставляет качество равным единице для валидных метрик', () => {
    const now = new Date().toISOString();
    const validated = checkMetrics({
      mcap: metric(45_000_000, 'https://example.com/mcap', now, 'USD'),
      revenue: metric(1_000_000, 'https://example.com/revenue', now, 'USD'),
    });

    expect(validated.dataQuality).toBe(1);
    expect(validated.validator?.dropped).toEqual([]);
    expect(validated.missing).toEqual([]);
  });
});
