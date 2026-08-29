import { Injectable } from '@nestjs/common';
import { conflict, NEXT } from '../errors';
import { EvaluationService } from '../evaluation/evaluation.service';
import { UniverseService } from '../universe/universe.service';
import type { CandidateView, UniverseSnapshot, UniverseView } from '../universe/universe.types';
import type { TokenFactGroup, TokenPresence, TokenReport } from './token.types';

const RESOLVED_TOKENOMICS = new Set(['available', 'known_zero']);

@Injectable()
export class TokenService {
  constructor(
    private readonly universe: UniverseService,
    private readonly evaluation: EvaluationService,
  ) {}

  /**
   * Один ответ вместо ручной сборки из funnel, rejected, coverage и dataGaps.
   * Известный тикер получает 200 всегда: для продукта, где сценарий начинается
   * с ввода тикера, 404 — худший из возможных ответов.
   */
  async report(token: string): Promise<TokenReport> {
    const { view, matches } = await this.universe.resolve(token);
    const context = this.universe.contextOf(view);

    if (matches.length > 1) {
      throw conflict(
        'ambiguous_ticker',
        `Тикер ${token.toUpperCase()} принадлежит нескольким активам: тикер не идентификатор.`,
        {
          requested: token,
          candidates: matches.map((item) => ({
            coingeckoId: item.coingeckoId,
            name: item.name,
            mcapCalcUsd: item.mcapCalcUsd,
          })),
        },
        { method: 'GET', path: `/universe/${matches[0].coingeckoId}`, body: {} },
      );
    }

    if (matches.length === 0) {
      const snapshot = await this.universe.latest();
      return {
        context,
        identity: null,
        presence: absent(await this.absenceReason(token, snapshot), view),
        facts: null,
        dataStates: { revenue: null, tokenomics: null, comparisonGroup: null },
        evaluationStatus: 'no_run',
        evaluation: null,
        whatWouldChangeThis: [
          `Расширить состав: POST /universe/refresh с topN больше ${snapshot?.topN ?? 1300}`,
        ],
      };
    }

    const candidate = matches[0];
    const evaluation = await this.evaluation.token(candidate.coingeckoId);

    return {
      context,
      identity: {
        coingeckoId: candidate.coingeckoId,
        ticker: candidate.ticker,
        name: candidate.name,
        rank: candidate.rank,
        sector: candidate.sector,
        comparisonGroup: candidate.comparisonGroup,
        assetArchetype: candidate.assetArchetype,
        matchedBy: candidate.matchedBy,
      },
      presence: presenceOf(candidate, view),
      facts: factsOf(candidate),
      dataStates: {
        revenue: candidate.revenueState,
        tokenomics: candidate.tokenomicsState,
        comparisonGroup: candidate.comparisonGroup === null ? 'source_missing' : 'available',
      },
      evaluationStatus: evaluation.runId === null ? 'no_run' : evaluation.status,
      evaluation: evaluation.evaluation,
      whatWouldChangeThis: advice(candidate, view, evaluation.runId !== null),
    };
  }

  /** Почему токена нет в снимке. Догадок не делаем: различаем только то, что видим. */
  private async absenceReason(token: string, snapshot: UniverseSnapshot | null): Promise<string> {
    const needle = token.trim().toLowerCase();
    if (snapshot !== null && snapshot.excludedIds.some((id) => id.toLowerCase() === needle)) {
      return 'Идентификатор в реестре исключений: мемкоины, обёртки и деривативы в состав не берутся';
    }
    return (
      `Не найден в снимке ${snapshot?.version ?? '—'}: либо не входит в топ-${snapshot?.topN ?? 1300} ` +
      'по капитализации, либо в реестре исключений, либо неизвестен CoinGecko под этим именем'
    );
  }
}

function absent(reason: string, view: UniverseView): TokenPresence {
  return {
    inSnapshot: false,
    absenceReason: reason,
    screen: { enabled: view.activeFilters.screen.enabled, passed: false, stage: null, reason: null },
    alpha: {
      enabled: view.activeFilters.alpha.enabled,
      applied: false,
      decision: null,
      reason: null,
      rankInSector: null,
      sectorSize: null,
    },
    inActiveSelection: false,
  };
}

/** Виновник отсева читается из строки: у screen это стадия воронки, у альфы — её решение. */
function presenceOf(candidate: CandidateView, view: UniverseView): TokenPresence {
  const byAlpha = candidate.alpha !== null && candidate.rejectedAt === candidate.alpha.decision;
  return {
    inSnapshot: true,
    absenceReason: null,
    screen: {
      enabled: view.activeFilters.screen.enabled,
      passed: candidate.passed || byAlpha,
      stage: byAlpha ? null : candidate.rejectedAt,
      reason: byAlpha ? null : candidate.rejectReason,
    },
    alpha: {
      enabled: view.activeFilters.alpha.enabled,
      applied: candidate.alpha !== null,
      decision: candidate.alpha?.decision ?? null,
      reason: candidate.alpha?.decisionReason ?? alphaSkipReason(candidate, view),
      rankInSector: candidate.alpha?.rankInSector ?? null,
      sectorSize: candidate.alpha?.sectorSize ?? null,
    },
    inActiveSelection: candidate.passed,
  };
}

/**
 * Почему альфа про строку ничего не сказала. Включённый фильтр без решения
 * читается как «сравнили и никак», хотя строку сняли до него — а отсев по
 * порогу и проигранная конкуренция это разные вещи.
 */
function alphaSkipReason(candidate: CandidateView, view: UniverseView): string {
  if (!view.activeFilters.alpha.enabled) {
    return 'Фильтр лидеров ниш выключен: сравнения в нише не было';
  }
  return (
    `До сравнения в нише строка не дошла: её снял screen на стадии ` +
    `${candidate.rejectedAt ?? '—'}. Это отсев по порогу, а не проигранная конкуренция`
  );
}

/**
 * Ссылка ведёт туда, откуда пришло число. У выручки и TVL своей даты источника
 * нет, поэтому рядом со ссылкой DeFiLlama едет marketAsOf того же прогона чисел.
 */
function factsOf(candidate: CandidateView): TokenReport['facts'] {
  const market: TokenFactGroup = {
    sourceUrl: candidate.marketSource,
    asOf: candidate.marketAsOf,
    values: {
      priceUsd: candidate.priceUsd,
      mcapCalcUsd: candidate.mcapCalcUsd,
      fdvUsd: candidate.fdvUsd,
      vol24hUsd: candidate.vol24hUsd,
      turnoverPct: candidate.turnoverPct,
      floatPct: candidate.floatPct,
      fdvToMcap: candidate.fdvToMcap,
    },
  };
  const revenue: TokenFactGroup = {
    sourceUrl: candidate.revenueSource ?? candidate.tvlSource,
    asOf: candidate.marketAsOf,
    values: {
      fees12mUsd: candidate.fees12mUsd,
      revenue12mUsd: candidate.revenue12mUsd,
      holdersRevenue12mUsd: candidate.holdersRevenue12mUsd,
      tvlUsd: candidate.tvlUsd,
      holderYieldPct: candidate.holderYieldPct,
      takeRatePct: candidate.takeRatePct,
      payoutRatioPct: candidate.payoutRatioPct,
      pRev: candidate.pRev,
      pFees: candidate.pFees,
      revenueBasis: candidate.revenueBasis,
    },
  };
  const tokenomics: TokenFactGroup = {
    sourceUrl: candidate.tokenomicsSource,
    asOf: candidate.asOfTokenomics,
    values: {
      overhangPct: candidate.overhangPct,
      unlock12mPct: candidate.unlock12mPct,
      netHolderYieldPct: candidate.netHolderYieldPct,
      nextUnlockAt: candidate.nextUnlockAt,
      nextUnlockCostInDailyVolumes: candidate.nextUnlockCostInDailyVolumes,
      tokenomicsTbdPct: candidate.tokenomicsTbdPct,
    },
  };
  return { market, revenue, tokenomics };
}

function advice(candidate: CandidateView, view: UniverseView, hasRun: boolean): string[] {
  const lines: string[] = [];

  if (!RESOLVED_TOKENOMICS.has(candidate.tokenomicsState)) {
    lines.push('Разлоки не покрыты источником: POST /manual/unlocks со ссылкой и датой вернёт NHY');
  }
  if (candidate.revenueState === 'mapping_failed') {
    lines.push('Монета не склеена с протоколом DeFiLlama: без склейки выручки не будет ни у одного числа');
  }
  if (candidate.revenueState === 'unsupported_business_model') {
    lines.push('Сеть платит валидаторам, а не держателю: сводок комиссий по ней нет и не должно быть');
  }
  if (candidate.comparisonGroup === null) {
    lines.push('Группа сравнения не определена: место в нише и перцентили не считаются');
  }
  if (!candidate.passed && candidate.alpha?.decision === 'alpha_outranked') {
    lines.push('Проиграл сравнение в нише: POST /universe/alpha {"enabled": false} вернёт его в выборку');
  } else if (!candidate.passed && candidate.rejectedAt !== null) {
    lines.push(
      `Отсеян фильтром шлака на стадии ${candidate.rejectedAt}: ` +
        'POST /universe/screen {"enabled": false} или другой профиль вернут его',
    );
  }
  if (!hasRun) lines.push('Кодовой оценки ещё не было: POST /evaluation/run посчитает все три компонента');
  if (view.activeFilters.screen.enabled && candidate.passed) {
    lines.push('В выборке при текущей композиции фильтров; выключение screen её только расширит');
  }
  return lines;
}