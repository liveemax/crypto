import { DEFAULT_PROFILE } from '../src/config/profiles';
import { parseAnalysisProfile } from '../src/core/universe/profile.schema';

describe('Разовый профиль', () => {
  it('принимает профиль, прошедший через DTO с пустыми полями', () => {
    // class-transformer материализует необязательные поля как undefined —
    // именно на этом падал POST /universe/screen с телом из GET /config/profiles.
    const fromDto = {
      ...DEFAULT_PROFILE,
      screen: DEFAULT_PROFILE.screen.map((rule) => ({
        field: undefined, op: undefined, value: undefined, nullPolicy: undefined,
        ...rule,
      })),
    };

    expect(() => parseAnalysisProfile(fromDto)).not.toThrow();
    expect(parseAnalysisProfile(fromDto).screen).toHaveLength(DEFAULT_PROFILE.screen.length);
  });

  it('НЕГАТИВНЫЙ: настоящий лишний ключ по-прежнему отклоняется', () => {
    const tampered = { ...DEFAULT_PROFILE, secretWeight: 42 };
    expect(() => parseAnalysisProfile(tampered)).toThrow();

    const badRule = {
      ...DEFAULT_PROFILE,
      screen: [{ ...DEFAULT_PROFILE.screen[0], sneaky: 'да' }],
    };
    expect(() => parseAnalysisProfile(badRule)).toThrow();
  });
  it('valuation принимает любой порядок осей, но отклоняет неверную сумму весов', () => {
    const reordered = {
      ...DEFAULT_PROFILE,
      valuation: { ...DEFAULT_PROFILE.valuation, rankBy: [...DEFAULT_PROFILE.valuation.rankBy].reverse() },
    };
    expect(parseAnalysisProfile(reordered).valuation.rankBy[0]?.field).toBe('revenuePerTvlPct');

    const badWeights = {
      ...DEFAULT_PROFILE,
      valuation: {
        ...DEFAULT_PROFILE.valuation,
        rankBy: DEFAULT_PROFILE.valuation.rankBy.map((axis) =>
          axis.field === 'pRev' ? { ...axis, weight: 0.3 } : axis,
        ),
      },
    };
    expect(() => parseAnalysisProfile(badWeights)).toThrow('valuation');
  });

});