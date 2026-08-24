import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, Search } from 'lucide-react';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import {
  usageStatsApi,
  type ModelUsageStatsResponse,
  type UsageStatsRange,
} from '@/infrastructure/api/usageStatsApi';
import { Select, type SelectOption } from '@/component-library';
import { configManager } from '@/infrastructure/config/services/ConfigManager';
import { getProviderDisplayName } from '@/infrastructure/config/services/modelConfigs';
import type { AIModelConfig } from '@/infrastructure/config/types';
import { createLogger } from '@/shared/utils/logger';
import './UsageStatsScene.scss';

const log = createLogger('UsageStatsScene');

// Categorical palette for distribution charts. Reuses existing appearance
// tokens so the view stays in sync with the active skin. Ordered so that
// consecutive entries are maximally distinct for many-item breakdowns.
const PALETTE = [
  'var(--bf-appearance-token-color-accent-500)',
  'var(--bf-appearance-token-color-success)',
  'var(--bf-appearance-token-color-warning)',
  'var(--bf-appearance-token-color-cyan-500)',
  'var(--bf-appearance-token-color-purple-500)',
  'var(--bf-appearance-token-color-error)',
  'var(--bf-appearance-token-color-indigo-500)',
  'var(--bf-appearance-token-color-info)',
];

const TREND_COLORS = {
  input: 'var(--bf-appearance-token-color-info)',
  output: 'var(--bf-appearance-token-color-success)',
  cacheHitRate: 'var(--bf-appearance-token-color-error)',
};

const RANGES: { value: UsageStatsRange; labelKey: string }[] = [
  { value: 'today', labelKey: 'usageStats.rangeToday' },
  { value: 'yesterday', labelKey: 'usageStats.rangeYesterday' },
  { value: 'last7d', labelKey: 'usageStats.rangeLast7d' },
  { value: 'last30d', labelKey: 'usageStats.rangeLast30d' },
  { value: 'this_month', labelKey: 'usageStats.rangeThisMonth' },
  { value: 'last_month', labelKey: 'usageStats.rangeLastMonth' },
  { value: 'last90d', labelKey: 'usageStats.rangeLast90d' },
  { value: 'all', labelKey: 'usageStats.rangeAll' },
];

interface ModelAgg {
  key: string;
  modelName: string;
  color: string;
  provider: string;
  endpoint: string;
  configDeleted: boolean;
  requests: number;
  input: number;
  output: number;
  cached: number;
  cacheWrite: number;
  cacheReportedInput: number;
}

interface GroupAgg {
  key: string;
  label: string;
  requests: number;
  tokens: number;
  cached: number;
  cacheReportedInput: number;
}

const compactTokens = (n: number, formatNumber: (v: number, o?: Intl.NumberFormatOptions) => string): string =>
  formatNumber(n, { notation: 'compact', maximumFractionDigits: 2 });

const formatCount = (n: number, formatNumber: (v: number, o?: Intl.NumberFormatOptions) => string): string =>
  formatNumber(n, { maximumFractionDigits: 0 });

const endpointHost = (url?: string): string => {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

const UsageStatsScene: React.FC = () => {
  const { t, formatNumber } = useI18n('common');
  const [range, setRange] = useState<UsageStatsRange>('last30d');
  const [data, setData] = useState<ModelUsageStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [modelConfigs, setModelConfigs] = useState<AIModelConfig[]>([]);

  useEffect(() => {
    let active = true;
    void configManager.getConfig<AIModelConfig[]>('ai.models').then((models) => {
      if (active) setModelConfigs(models || []);
    }).catch((err) => {
      log.warn('Failed to load model configs for usage stats', err);
    });
    return () => {
      active = false;
    };
  }, []);

  const fetchStats = useCallback(async (selectedRange: UsageStatsRange) => {
    setLoading(true);
    setError('');
    try {
      const result = await usageStatsApi.getModelUsageStats(selectedRange);
      setData(result);
    } catch (err) {
      log.error('Failed to load usage stats', err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStats(range);
  }, [fetchStats, range]);

  const modelMap = useMemo(() => {
    const map = new Map<string, AIModelConfig>();
    for (const model of modelConfigs) {
      if (model.id) map.set(model.id, model);
    }
    return map;
  }, [modelConfigs]);

  const models = useMemo<ModelAgg[]>(() => {
    if (!data) return [];
    const byKey = new Map<string, ModelAgg>();
    for (const day of data.days) {
      for (const m of day.models) {
        const cfg = m.model_config_id ? modelMap.get(m.model_config_id) : undefined;
        let agg = byKey.get(m.model_key);
        if (!agg) {
          agg = {
            key: m.model_key,
            modelName: m.model_name || m.model_key,
            color: '',
            provider: cfg
              ? getProviderDisplayName(cfg)
              : m.model_config_id
                ? t('usageStats.deletedConfig')
                : t('usageStats.unknownProvider'),
            configDeleted: !cfg && !!m.model_config_id,
            endpoint: cfg ? endpointHost(cfg.request_url || cfg.base_url) : '',
            requests: 0,
            input: 0,
            output: 0,
            cached: 0,
            cacheWrite: 0,
            cacheReportedInput: 0,
          };
          byKey.set(m.model_key, agg);
        }
        agg.requests += m.requests;
        agg.input += m.input;
        agg.output += m.output;
        agg.cached += m.cached;
        agg.cacheWrite += m.cache_write;
        agg.cacheReportedInput += m.cache_reported_input;
      }
    }
    return Array.from(byKey.values())
      .sort((a, b) => b.requests - a.requests)
      .map((m, i) => ({ ...m, color: PALETTE[i % PALETTE.length] }));
  }, [data, modelMap, t]);

  const filteredModels = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) => m.modelName.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q),
    );
  }, [models, search]);

  const providers = useMemo<GroupAgg[]>(() => {
    const byKey = new Map<string, GroupAgg>();
    for (const m of models) {
      let agg = byKey.get(m.provider);
      if (!agg) {
        agg = { key: m.provider, label: m.provider, requests: 0, tokens: 0, cached: 0, cacheReportedInput: 0 };
        byKey.set(m.provider, agg);
      }
      agg.requests += m.requests;
      agg.tokens += m.input + m.output;
      agg.cached += m.cached;
      agg.cacheReportedInput += m.cacheReportedInput;
    }
    return Array.from(byKey.values()).sort((a, b) => b.tokens - a.tokens);
  }, [models]);

  const endpoints = useMemo<GroupAgg[]>(() => {
    const byKey = new Map<string, GroupAgg>();
    for (const m of models) {
      const key =
        m.endpoint ||
        (m.configDeleted ? t('usageStats.deletedEndpoint') : t('usageStats.unknownEndpoint'));
      let agg = byKey.get(key);
      if (!agg) {
        agg = { key, label: key, requests: 0, tokens: 0, cached: 0, cacheReportedInput: 0 };
        byKey.set(key, agg);
      }
      agg.requests += m.requests;
      agg.tokens += m.input + m.output;
      agg.cached += m.cached;
      agg.cacheReportedInput += m.cacheReportedInput;
    }
    return Array.from(byKey.values()).sort((a, b) => b.tokens - a.tokens);
  }, [models, t]);

  const totals = useMemo(() => {
    if (!data) return null;
    return {
      requests: data.total_requests,
      input: data.total_input,
      output: data.total_output,
      tokens: data.total_input + data.total_output,
      cached: data.total_cached,
      cacheWrite: data.total_cache_write,
      cacheReportedInput: data.cache_reported_input,
    };
  }, [data]);

  const cacheHitRate = useMemo(() => {
    if (!totals || totals.cacheReportedInput <= 0) return null;
    return totals.cached / totals.cacheReportedInput;
  }, [totals]);

  const rangeOptions = useMemo<SelectOption[]>(
    () => RANGES.map((r) => ({ value: r.value, label: t(r.labelKey) })),
    [t],
  );

  const refresh = useCallback(() => {
    void fetchStats(range);
  }, [fetchStats, range]);

  return (
    <div className="usage-stats" data-bf-scene="insights" data-bf-part="root" data-bf-view="stats">
      <div className="usage-stats__header" data-bf-scene="insights" data-bf-part="header">
        <div className="usage-stats__header-identity">
          <h2 className="usage-stats__title">{t('usageStats.title')}</h2>
          <p className="usage-stats__subtitle">{t('usageStats.subtitle')}</p>
        </div>
        <div className="usage-stats__filters">
          <Select
            className="usage-stats__range-select"
            value={range}
            options={rangeOptions}
            onChange={(value) => setRange(String(Array.isArray(value) ? value[0] : value) as UsageStatsRange)}
            size="small"
            triggerTestId="usage-stats-range-select"
          />
          <div className="usage-stats__search">
            <Search size={14} />
            <input
              type="text"
              value={search}
              placeholder={t('usageStats.searchPlaceholder')}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="usage-stats__refresh-btn"
            onClick={refresh}
            disabled={loading}
            aria-label={t('usageStats.refresh')}
            title={t('usageStats.refresh')}
          >
            <RefreshCw size={14} className={loading ? 'usage-stats__spinner' : undefined} />
          </button>
        </div>
      </div>

      {error && (
        <div className="usage-stats__error" data-bf-scene="insights" data-bf-part="error">
          <AlertTriangle size={14} />
          <span>{t('usageStats.error')}: {error}</span>
        </div>
      )}

      {loading && !data ? (
        <div className="usage-stats__loading" data-bf-scene="insights" data-bf-part="loading">
          <Loader2 size={16} className="usage-stats__spinner" />
        </div>
      ) : !data || data.days.length === 0 ? (
        <div className="usage-stats__empty" data-bf-scene="insights" data-bf-part="empty">
          {t('usageStats.empty')}
        </div>
      ) : (
        <div className="usage-stats__content" data-bf-scene="insights" data-bf-part="content">
          <div className="usage-stats__summary">
            <SummaryCard
              label={t('usageStats.requests')}
              value={formatCount(totals!.requests, formatNumber)}
            />
            <SummaryCard
              label={t('usageStats.totalTokens')}
              value={compactTokens(totals!.tokens, formatNumber)}
            />
            <SummaryCard
              label={t('usageStats.cachedTokens')}
              value={compactTokens(totals!.cached, formatNumber)}
            />
            <SummaryCard
              label={t('usageStats.cacheHitRate')}
              value={cacheHitRate == null ? '--' : formatNumber(cacheHitRate * 100, { maximumFractionDigits: 2 }) + '%'}
              accent
            />
          </div>

          <div className="usage-stats__grid">
            <ModelHitRateCard models={filteredModels} />
            <DistributionCard
              title={t('usageStats.modelDistribution')}
              centerValue={compactTokens(totals!.tokens, formatNumber)}
              centerLabel={t('usageStats.tokens')}
              segments={filteredModels.map((m) => ({
                label: m.provider ? `${m.provider} · ${m.modelName}` : m.modelName,
                value: m.input + m.output,
                color: m.color,
                sub: m.provider,
                requests: m.requests,
              }))}
              columnLabel={t('usageStats.columnModel')}
            />
            <DistributionCard
              title={t('usageStats.providerDistribution')}
              centerValue={compactTokens(totals!.tokens, formatNumber)}
              centerLabel={t('usageStats.tokens')}
              segments={providers.map((p, i) => ({
                label: p.label,
                value: p.tokens,
                color: PALETTE[i % PALETTE.length],
                requests: p.requests,
              }))}
              columnLabel={t('usageStats.columnProvider')}
            />
            <DistributionCard
              title={t('usageStats.endpointDistribution')}
              centerValue={compactTokens(totals!.tokens, formatNumber)}
              centerLabel={t('usageStats.tokens')}
              segments={endpoints.map((p, i) => ({
                label: p.label,
                value: p.tokens,
                color: PALETTE[i % PALETTE.length],
                requests: p.requests,
              }))}
              columnLabel={t('usageStats.columnEndpoint')}
            />
          </div>

          <TrendChart days={data.days} />
        </div>
      )}
    </div>
  );
};

const SummaryCard: React.FC<{ label: string; value: string; accent?: boolean }> = ({ label, value, accent }) => (
  <div className="usage-stats-card">
    <div className="usage-stats-card__label">{label}</div>
    <div className={`usage-stats-card__value${accent ? ' usage-stats-card__value--accent' : ''}`}>{value}</div>
  </div>
);

const ModelHitRateCard: React.FC<{ models: ModelAgg[] }> = ({ models }) => {
  const { t, formatNumber } = useI18n('common');
  const rows = models
    .map((m) => ({ m, rate: m.cacheReportedInput > 0 ? m.cached / m.cacheReportedInput : null }))
    .filter((r) => r.rate != null)
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));

  return (
    <div className="usage-stats-chart-card">
      <div className="usage-stats-chart-card__title">{t('usageStats.modelCacheHitRate')}</div>
      {rows.length === 0 ? (
        <div className="usage-stats-chart-card__hint">--</div>
      ) : (
        <div className="usage-stats-bars">
          {rows.map(({ m, rate }) => (
            <div key={m.key} className="usage-stats-bar">
              <div className="usage-stats-bar__head">
                <span className="usage-stats-bar__label" title={`${m.modelName} · ${m.provider}`}>
                  <span className="usage-stats-bar__dot" style={{ background: m.color }} />
                  <span className="usage-stats-bar__name">{m.modelName}</span>
                  <span className="usage-stats-bar__provider">{m.provider}</span>
                </span>
                <span className="usage-stats-bar__value">
                  {formatNumber((rate ?? 0) * 100, { maximumFractionDigits: 2 })}%
                </span>
              </div>
              <div className="usage-stats-bar__track">
                <div
                  className="usage-stats-bar__fill"
                  style={{ width: `${Math.min(100, (rate ?? 0) * 100)}%`, background: m.color }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

interface DistributionSegment {
  label: string;
  sub?: string;
  value: number;
  color: string;
  requests: number;
}

const DistributionCard: React.FC<{
  title: string;
  centerValue: string;
  centerLabel: string;
  segments: DistributionSegment[];
  columnLabel: string;
}> = ({ title, centerValue, centerLabel, segments, columnLabel }) => {
  const { t, formatNumber } = useI18n('common');

  return (
    <div className="usage-stats-chart-card">
      <div className="usage-stats-chart-card__title">{title}</div>
      {segments.length === 0 ? (
        <div className="usage-stats-chart-card__hint">--</div>
      ) : (
        <div className="usage-stats-dist">
          <div className="usage-stats-dist__donut">
            <DonutChart segments={segments.map((s) => ({ value: s.value, color: s.color }))} />
            <div className="usage-stats-dist__center">
              <div className="usage-stats-dist__center-value">{centerValue}</div>
              <div className="usage-stats-dist__center-label">{centerLabel}</div>
            </div>
          </div>
          <div className="usage-stats-dist__table">
            <div className="usage-stats-dist__thead">
              <span>{columnLabel}</span>
              <span>{t('usageStats.columnRequests')}</span>
              <span>{t('usageStats.columnTokens')}</span>
            </div>
            {segments.map((s, i) => (
              <div key={`${s.label}-${i}`} className="usage-stats-dist__row" title={s.label}>
                <span className="usage-stats-dist__cell-label">
                  <span className="usage-stats-bar__dot" style={{ background: s.color }} />
                  <span className="usage-stats-dist__cell-name">{s.label}</span>
                </span>
                <span>{formatCount(s.requests, formatNumber)}</span>
                <span>{compactTokens(s.value, formatNumber)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const DonutChart: React.FC<{ segments: { value: number; color: string }[] }> = ({ segments }) => {
  const size = 120;
  const strokeWidth = 15;
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="usage-stats-donut__svg">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--bf-appearance-token-element-bg-medium)"
        strokeWidth={strokeWidth}
      />
      {segments.map((seg, i) => {
        const len = (seg.value / total) * c;
        const el = (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        );
        offset += len;
        return el;
      })}
    </svg>
  );
};

const MARKER_LIMIT = 31;

const starPoints = (cx: number, cy: number, outer: number, inner: number): string => {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const radius = i % 2 === 0 ? outer : inner;
    pts.push(
      `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`,
    );
  }
  return pts.join(' ');
};

const trianglePoints = (cx: number, cy: number, size: number): string =>
  [
    `${cx},${(cy - size).toFixed(2)}`,
    `${(cx - size * 0.87).toFixed(2)},${(cy + size * 0.5).toFixed(2)}`,
    `${(cx + size * 0.87).toFixed(2)},${(cy + size * 0.5).toFixed(2)}`,
  ].join(' ');

const TrendChart: React.FC<{ days: ModelUsageStatsResponse['days'] }> = ({ days }) => {
  const { t, formatNumber } = useI18n('common');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const width = 720;
  const height = 240;
  const padLeft = 46;
  const padRight = 46;
  const padTop = 14;
  const padBottom = 26;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const series = useMemo(() => {
    const input: number[] = days.map((d) => d.input);
    const output: number[] = days.map((d) => d.output);
    const hitRate: (number | null)[] = days.map((d) =>
      d.cache_reported_input > 0 ? d.cached / d.cache_reported_input : null,
    );
    return { input, output, hitRate };
  }, [days]);

  const maxToken = useMemo(() => Math.max(1, ...series.input, ...series.output), [series]);
  const logMax = Math.log10(maxToken + 1);

  const xFor = (i: number): number => {
    if (days.length <= 1) return padLeft + plotW / 2;
    return padLeft + (i / (days.length - 1)) * plotW;
  };
  // Token axis is log-scaled (base 10, with a +1 offset so 0 maps to the floor)
  // so input and output that differ by orders of magnitude both stay visible.
  const yForToken = (v: number): number => padTop + plotH - (Math.log10(v + 1) / logMax) * plotH;
  // Cache hit rate uses a separate linear axis on the right, pinned to a
  // 50-100% window since hit rates are typically well above 50%; a full
  // 0-100% axis would compress the meaningful variation.
  const yForRate = (v: number): number => {
    const clamped = Math.max(0.5, Math.min(1.0, v));
    return padTop + plotH - ((clamped - 0.5) / 0.5) * plotH;
  };

  const tokenGrid = useMemo(() => {
    const vals: number[] = [0];
    for (let g = 1; g <= maxToken; g *= 10) vals.push(g);
    return vals;
  }, [maxToken]);

  const polyline = (values: number[], yFor: (v: number) => number): string =>
    values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(' ');

  const hitRatePoints = series.hitRate
    .map((v, i) => (v == null ? null : `${xFor(i)},${yForRate(v)}`))
    .filter(Boolean)
    .join(' ');

  const xTicks = useMemo(() => {
    if (days.length <= 1) return [0];
    const step = Math.max(1, Math.ceil(days.length / 6));
    const idx: number[] = [];
    for (let i = 0; i < days.length; i += step) idx.push(i);
    if (idx[idx.length - 1] !== days.length - 1) idx.push(days.length - 1);
    return idx;
  }, [days]);

  const showMarkers = days.length <= MARKER_LIMIT;

  const legend = [
    { label: t('usageStats.legendInput'), color: TREND_COLORS.input },
    { label: t('usageStats.legendOutput'), color: TREND_COLORS.output },
    { label: t('usageStats.legendCacheHitRate'), color: TREND_COLORS.cacheHitRate, dashed: true },
  ];

  const formatShortDate = (date: string): string => {
    const parts = date.split('-');
    return parts.length === 3 ? `${parts[1]}/${parts[2]}` : date;
  };

  return (
    <div className="usage-stats-chart-card usage-stats-chart-card--wide">
      <div className="usage-stats-chart-card__title">{t('usageStats.tokenTrend')}</div>
      <div className="usage-stats-trend">
        <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
          {tokenGrid.map((g) => (
            <line
              key={`g-${g}`}
              x1={padLeft}
              y1={yForToken(g)}
              x2={width - padRight}
              y2={yForToken(g)}
              stroke="var(--bf-appearance-token-border-subtle)"
              strokeWidth="1"
            />
          ))}
          {tokenGrid.map((g) => (
            <text
              key={`lt-${g}`}
              x={padLeft - 6}
              y={yForToken(g) + 3}
              textAnchor="end"
              className="usage-stats-trend__axis"
            >
              {compactTokens(g, formatNumber)}
            </text>
          ))}
          {[0.5, 0.75, 1].map((f) => (
            <text
              key={`rt-${f}`}
              x={width - padRight + 6}
              y={yForRate(f) + 3}
              textAnchor="start"
              className="usage-stats-trend__axis"
            >
              {Math.round(f * 100)}%
            </text>
          ))}
          <polyline points={polyline(series.input, yForToken)} fill="none" stroke={TREND_COLORS.input} strokeWidth="1.5" />
          <polyline points={polyline(series.output, yForToken)} fill="none" stroke={TREND_COLORS.output} strokeWidth="1.5" />
          {hitRatePoints && (
            <polyline
              points={hitRatePoints}
              fill="none"
              stroke={TREND_COLORS.cacheHitRate}
              strokeWidth="1.5"
              strokeDasharray="5 4"
            />
          )}
          {showMarkers &&
            series.input.map((v, i) => (
              <polygon key={`si-${i}`} points={starPoints(xFor(i), yForToken(v), 5, 2)} fill={TREND_COLORS.input} />
            ))}
          {showMarkers &&
            series.output.map((v, i) => (
              <polygon key={`so-${i}`} points={trianglePoints(xFor(i), yForToken(v), 5)} fill={TREND_COLORS.output} />
            ))}
          {showMarkers &&
            series.hitRate.map((v, i) =>
              v == null ? null : (
                <circle key={`sr-${i}`} cx={xFor(i)} cy={yForRate(v)} r={3.5} fill={TREND_COLORS.cacheHitRate} />
              ),
            )}
          {xTicks.map((i) => (
            <text key={`x-${i}`} x={xFor(i)} y={height - 8} textAnchor="middle" className="usage-stats-trend__axis">
              {formatShortDate(days[i].date)}
            </text>
          ))}
          {hoverIndex != null && (
            <line
              x1={xFor(hoverIndex)}
              y1={padTop}
              x2={xFor(hoverIndex)}
              y2={height - padBottom}
              stroke="var(--bf-appearance-token-color-text-muted)"
              strokeWidth="1"
              strokeDasharray="2 2"
            />
          )}
          {days.map((_, i) => {
            const w = Math.max(2, plotW / Math.max(days.length, 1));
            const x = Math.max(padLeft, Math.min(width - padRight - w, xFor(i) - w / 2));
            return (
              <rect
                key={`hit-${i}`}
                x={x}
                y={padTop}
                width={w}
                height={plotH}
                fill="transparent"
                pointerEvents="all"
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex(null)}
              />
            );
          })}
          {hoverIndex != null &&
            (() => {
              const d = days[hoverIndex];
              const hit = d.cache_reported_input > 0 ? (d.cached / d.cache_reported_input) * 100 : null;
              const tipW = 150;
              const tipH = 96;
              const estRight = xFor(hoverIndex) + 12 + tipW;
              const tipX = estRight > width - padRight ? xFor(hoverIndex) - tipW - 12 : xFor(hoverIndex) + 12;
              const tipY = Math.max(4, padTop);
              const rows = [
                { label: t('usageStats.legendInput'), value: formatNumber(d.input), color: TREND_COLORS.input },
                { label: t('usageStats.legendOutput'), value: formatNumber(d.output), color: TREND_COLORS.output },
                {
                  label: t('usageStats.legendCacheHitRate'),
                  value: hit == null ? '--' : `${hit.toFixed(1)}%`,
                  color: TREND_COLORS.cacheHitRate,
                },
              ];
              return (
                <g pointerEvents="none">
                  <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={6} fill="var(--bf-appearance-token-element-bg-medium)" stroke="var(--bf-appearance-token-border-strong)" strokeWidth="1" />
                  <text x={tipX + 10} y={tipY + 16} className="usage-stats-trend__tooltip-title">
                    {d.date}
                  </text>
                  {rows.map((r, ri) => (
                    <g key={ri}>
                      <rect x={tipX + 10} y={tipY + 28 + ri * 20} width={8} height={8} rx={2} fill={r.color} />
                      <text x={tipX + 24} y={tipY + 35 + ri * 20} className="usage-stats-trend__tooltip-text">
                        {r.label}
                      </text>
                      <text x={tipX + tipW - 10} y={tipY + 35 + ri * 20} textAnchor="end" className="usage-stats-trend__tooltip-text">
                        {r.value}
                      </text>
                    </g>
                  ))}
                </g>
              );
            })()}
        </svg>
        <div className="usage-stats-trend__legend">
          {legend.map((l) => (
            <span key={l.label} className="usage-stats-trend__legend-item">
              <span
                className="usage-stats-trend__legend-swatch"
                style={{ background: 'transparent', borderColor: l.color, borderStyle: l.dashed ? 'dashed' : 'solid' }}
              />
              {l.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default UsageStatsScene;
