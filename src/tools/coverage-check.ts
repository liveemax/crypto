import { StoreService } from '../core/store/store.service';
import { UniverseFilter } from '../core/universe/universe.filter';
import { buildCoverage } from '../core/universe/coverage';
import { emptyFilterState } from '../core/universe/filter-state.service';
import type { ActiveFilterState } from '../core/universe/filter-state.types';
import type { UniverseSnapshot } from '../core/universe/universe.types';

async function main(): Promise<number> {
  const store = new StoreService();
  const snapshot = await store.loadSnapshot<UniverseSnapshot>('universe-source');
  if (!snapshot) {
    console.error('Вселенная не собрана: нет снимка в data/snapshots');
    return 2;
  }

  const stored = await store.loadState<ActiveFilterState>('active-filters');
  const state: ActiveFilterState = stored ?? emptyFilterState();
  const profile = state.screen.enabled ? state.screen.profile : null;

  const candidates = snapshot.candidates.map((item) => ({ ...item }));
  const filter = new UniverseFilter();
  if (profile) filter.apply(candidates, new Set(snapshot.excludedIds), profile);
  else filter.passAll(candidates);

  const report = buildCoverage(
    candidates.filter((item) => item.passed),
    {
      universeVersion: snapshot.version,
      builtAt: snapshot.builtAt,
      activeFilters: state,
    },
  );

  const { sector } = report;
  console.log(`Вселенная ${report.universeVersion} · отбор ` +
    `${profile ? profile.id : 'выключен'} · база ${report.total}`);
  console.log(`Без группы сравнения: ${sector.withoutGroup} — ` +
    `${sector.gapPct}% при пороге ${sector.maxGapPct}%, ` +
    `${sector.gapMcapPct}% капитализации при пороге ${sector.maxGapMcapPct}%`);
  console.log('Состояния выручки: ' +
    report.revenue.byState.map((b) => `${b.key} ${b.count}`).join(', '));

  if (!sector.passed) {
    console.error('\nГЕЙТ КРАСНЫЙ. Крупнейшие пробелы:');
    for (const gap of sector.worst.slice(0, 10)) {
      console.error(`  ${gap.ticker.padEnd(10)} ` +
        `${Math.round((gap.mcapCalcUsd ?? 0) / 1e6)} млн · ${gap.matchedBy}`);
    }
    console.error('\nПорог опускается только вниз: добавьте категорию в SECTOR_MAP ' +
      'либо зафиксируйте достигнутое значение в COVERAGE как новую отправную точку.');
    return 1;
  }
  console.log('\nГейт зелёный.');
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error('Проверка покрытия упала:', error);
    process.exit(2);
  });