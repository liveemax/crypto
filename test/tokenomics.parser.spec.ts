import {
  calendarNodes,
  completenessOf,
  parseCalendar,
  scheduledTotal,
  unlockedIn,
} from '../src/core/tokenomics/emissions.parser';

const DAY = 86_400;
const NOW = 1_800_000_000;

function document(events: unknown[], supply: Record<string, number> = {}): unknown {
  return { metadata: { unlockEvents: events }, supplyMetrics: { maxSupply: 1_000, ...supply } };
}

describe('Парсер календаря DeFiLlama', () => {
  it('не превращает четырёхлетний вестинг в один день', () => {
    const start = NOW + DAY;
    const nodes = [
      {
        timestamp: start,
        linearAllocations: [
          {
            recipient: 'Investors',
            category: 'investors',
            unlockType: 'linear_start',
            newRatePerWeek: 700,
            endTimestamp: start + 4 * 365 * DAY,
          },
        ],
      },
    ];
    const calendar = parseCalendar(nodes);

    // Год потока по 700 в неделю — это 36 500, а не 700 и не 1 022 000.
    expect(unlockedIn(calendar, NOW, NOW + 365 * DAY)).toBeCloseTo(36_400, 0);
  });

  it('следующая смена ставки обрывает предыдущую, а не складывается с ней', () => {
    const nodes = [
      {
        timestamp: NOW,
        linearAllocations: [
          { recipient: 'Team', newRatePerWeek: 700, endTimestamp: NOW + 365 * DAY },
        ],
      },
      {
        timestamp: NOW + 100 * DAY,
        linearAllocations: [
          { recipient: 'Team', newRatePerWeek: 0, endTimestamp: NOW + 365 * DAY },
        ],
      },
    ];
    const calendar = parseCalendar(nodes);

    // Сто дней по 100 в день, а не год: сложенные потоки удваивают разводнение.
    expect(unlockedIn(calendar, NOW, NOW + 365 * DAY)).toBeCloseTo(10_000, 0);
  });

  it('расхождение с итогом источника больше 0.5% — отказ, а не своя цифра', () => {
    const nodes = [
      {
        timestamp: NOW + DAY,
        cliffAllocations: [{ recipient: 'Team', amount: 100 }],
        summary: { totalTokensCliff: 200 },
      },
    ];
    expect(unlockedIn(parseCalendar(nodes), NOW, NOW + 365 * DAY)).toBeNull();
  });

  it('нераспознанная сумма обнуляет весь документ, а не одно событие', () => {
    const nodes = [
      { timestamp: NOW + DAY, cliffAllocations: [{ recipient: 'Team', amount: 'много' }] },
    ];
    expect(unlockedIn(parseCalendar(nodes), NOW, NOW + 365 * DAY)).toBeNull();
  });

  it('знаменатель полноты — maxSupply, а не описанная расписанием часть', () => {
    const nodes = [{ timestamp: NOW + DAY, cliffAllocations: [{ recipient: 'Team', amount: 650 }] }];
    const calendar = parseCalendar(nodes);
    const complete = completenessOf(document(nodes, { adjustedSupply: 650, tbdAmount: 350 }), scheduledTotal(calendar));

    // 65%, а не 100%: деление на adjustedSupply завышало ровно на долю пробела.
    expect(complete.schedulePct).toBe(65);
    expect(complete.tbdPct).toBe(35);
  });

  it('календаря в документе нет — это null, а не пустой календарь', () => {
    expect(calendarNodes({ documentedData: { data: [] } })).toBeNull();
  });
});