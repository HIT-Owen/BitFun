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
import { APPEARANCE_DOMAIN_TOKENS } from '@/infrastructure/appearance/appearanceDomainTokens';
import { createLogger } from '@/shared/utils/logger';
import './UsageStatsScene.scss';

const log = createLogger('UsageStatsScene');

// Categorical palette for distribution charts. Reuses existing appearance
// tokens so the view stays in sync with the active skin.
const PALETTE = [
  'var(--bf-appearance-token-color-accent-500)',
  'var(--bf-appearance-token-color-purple-500)',
  APPEARANCE_DOMAIN_TOKENS.insights.positive,
  APPEARANCE_DOMAIN_TOKENS.insights.time,
  APPEARANCE_DOMAIN_TOKENS.insights.neutral,
  APPEARANCE_DOMAIN_TOKENS.insights.issue,
];

const TREND_COLORS = {
  input: 'var(--bf-appearance-token-color-accent-500)',
  output: APPEARANCE_DOMAIN_TOKENS.insights.positive,
  cacheCreation: APPEARANCE_DOMAIN_TOKENS.insights.neutral,
  cacheRead: 'var(--bf-appearance-token-color-purple-500)',
  cacheHitRate: APPEARANCE_DOMAIN_TOKENS.insights.issue,
};

const RANGES: { value: UsageStatsRange; labelKey: string }[] = [
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
  provider: string;
  endpoint: string;
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
        const cfg = modelMap.get(m.model_config_id);
        let agg = byKey.get(m.model_config_id);
        if (!agg) {
          agg = {
            key: m.model_config_id,
            modelName: m.model_name || m.model_config_id,
            provider: cfg ? getProviderDisplayName(cfg) : t('usageStats.deletedConfig'),
            endpoint: cfg ? endpointHost(cfg.request_url || cfg.base_url) : '',
            requests: 0,
            input: 0,
            output: 0,
            cached: 0,
            cacheWrite: 0,
            cacheReportedInput: 0,
          };
          byKey.set(m.model_config_id, agg);
        }
        agg.requests += m.requests;
        agg.input += m.input;
        agg.output += m.output;
        agg.cached += m.cached;
        agg.cacheWrite += m.cache_write;
        agg.cacheReportedInput += m.cache_reported_input;
      }
    }
    return Array.from(byKey.values()).sort((a, b) => b.requests - a.requests);
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
      const key = m.endpoint || t('usageStats.unknownEndpoint');
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
              segments={filteredModels.map((m, i) => ({
                label: m.modelName,
                value: m.input + m.output,
                color: PALETTE[i % PALETTE.length],
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
          {rows.map(({ m, rate }, i) => (
            <div key={m.key} className="usage-stats-bar">
              <div className="usage-stats-bar__head">
                <span className="usage-stats-bar__label" title={`${m.modelName} · ${m.provider}`}>
                  <span className="usage-stats-bar__dot" style={{ background: PALETTE[i % PALETTE.length] }} />
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
                  style={{ width: `${Math.min(100, (rate ?? 0) * 100)}%`, background: PALETTE[i % PALETTE.length] }}
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

const TrendChart: React.FC<{ days: ModelUsageStatsResponse['days'] }> = ({ days }) => {
  const { t, formatNumber } = useI18n('common');

  const width = 720;
  const height = 240;
  const padX = 8;
  const padTop = 12;
  const padBottom = 26;
  const padRight = 44;
  const plotW = width - padX - padRight;
  const plotH = height - padTop - padBottom;

  const series = useMemo(() => {
    const input: number[] = days.map((d) => d.input);
    const output: number[] = days.map((d) => d.output);
    const cacheCreation: number[] = days.map((d) => d.cache_write);
    const cacheRead: number[] = days.map((d) => d.cached);
    const hitRate: (number | null)[] = days.map((d) =>
      d.cache_reported_input > 0 ? d.cached / d.cache_reported_input : null,
    );
    return { input, output, cacheCreation, cacheRead, hitRate };
  }, [days]);

  const maxToken = useMemo(() => {
    const all = [...series.input, ...series.output, ...series.cacheCreation, ...series.cacheRead];
    return Math.max(1, ...all);
  }, [series]);

  const xFor = (i: number): number => {
    if (days.length <= 1) return padX + plotW / 2;
    return padX + (i / (days.length - 1)) * plotW;
  };
  const yForToken = (v: number): number => padTop + plotH - (v / maxToken) * plotH;
  const yForRate = (v: number): number => padTop + plotH - v * plotH;

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

  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  const legend = [
    { label: t('usageStats.legendInput'), color: TREND_COLORS.input },
    { label: t('usageStats.legendOutput'), color: TREND_COLORS.output },
    { label: t('usageStats.legendCacheCreation'), color: TREND_COLORS.cacheCreation },
    { label: t('usageStats.legendCacheRead'), color: TREND_COLORS.cacheRead },
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
          {yTicks.map((f) => {
            const y = yForToken(maxToken * f);
            return (
              <line
                key={f}
                x1={padX}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="var(--bf-appearance-token-border-subtle)"
                strokeWidth="1"
              />
            );
          })}
          <polyline points={polyline(series.input, yForToken)} fill="none" stroke={TREND_COLORS.input} strokeWidth="1.5" />
          <polyline points={polyline(series.output, yForToken)} fill="none" stroke={TREND_COLORS.output} strokeWidth="1.5" />
          <polyline points={polyline(series.cacheCreation, yForToken)} fill="none" stroke={TREND_COLORS.cacheCreation} strokeWidth="1.5" />
          <polyline points={polyline(series.cacheRead, yForToken)} fill="none" stroke={TREND_COLORS.cacheRead} strokeWidth="1.5" />
          {hitRatePoints && (
            <polyline
              points={hitRatePoints}
              fill="none"
              stroke={TREND_COLORS.cacheHitRate}
              strokeWidth="1.5"
              strokeDasharray="4 4"
            />
          )}
          {yTicks.map((f) => (
            <text key={`l-${f}`} x={width - padRight + 6} y={yForToken(maxToken * f) + 3} className="usage-stats-trend__axis">
              {compactTokens(maxToken * f, formatNumber)}
            </text>
          ))}
          {yTicks.map((f) => (
            <text key={`r-${f}`} x={width - padRight + 6} y={yForRate(f) + 3} className="usage-stats-trend__axis usage-stats-trend__axis--right">
              {f === 0 ? '0%' : f === 1 ? '100%' : ''}
            </text>
          ))}
          {xTicks.map((i) => (
            <text key={`x-${i}`} x={xFor(i)} y={height - 8} textAnchor="middle" className="usage-stats-trend__axis">
              {formatShortDate(days[i].date)}
            </text>
          ))}
        </svg>
        <div className="usage-stats-trend__legend">
          {legend.map((l) => (
            <span key={l.label} className="usage-stats-trend__legend-item">
              <span
                className="usage-stats-trend__legend-swatch"
                style={{
                  background: l.dashed ? 'transparent' : l.color,
                  borderColor: l.color,
                  borderStyle: l.dashed ? 'dashed' : 'solid',
                }}
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
