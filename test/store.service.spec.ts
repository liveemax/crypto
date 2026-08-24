import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StoreService } from '../src/core/store/store.service';

describe('StoreService', () => {
  let root: string;
  let store: StoreService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'crypto-store-'));
    store = new StoreService(root);
  });

  afterEach(async () => rm(root, { recursive: true, force: true }));

  it('обновляет кэш и возвращает последнее значение', async () => {
    await store.cachePut('prices', 'AAVE', { price: 1 });
    await store.cachePut('prices', 'AAVE', { price: 2 });
    await expect(store.cacheGet('prices', 'AAVE')).resolves.toEqual({ price: 2 });
  });

  it('не перезаписывает снапшоты и загружает последний', async () => {
    const first = await store.saveSnapshot('market', [{ ticker: 'AAVE' }]);
    const second = await store.saveSnapshot('market', [{ ticker: 'MORPHO' }]);

    expect(second).not.toBe(first);
    await expect(readFile(first, 'utf8')).resolves.toContain('AAVE');
    await expect(store.loadSnapshot('market')).resolves.toEqual([{ ticker: 'MORPHO' }]);
  });

  it('сохраняет и загружает результат агента', async () => {
    await store.saveResult('screener', 'AAVE', { score: 80 });
    await expect(store.loadResult('screener', 'AAVE')).resolves.toEqual({ score: 80 });
  });
});
