import { invoke } from '@tauri-apps/api/core';

// ============ Types (strict 1:1 mirror of Rust types) ============

export type UsageStatsRange =
  | 'last7d'
  | 'last30d'
  | 'this_month'
  | 'last_month'
  | 'last90d'
  | 'all';

export interface UsageStatsDayModel {
  model_config_id: string;
  model_name: string;
  requests: number;
  input: number;
  output: number;
  cached: number;
  cache_write: number;
  cache_reported_input: number;
}

export interface UsageStatsDay {
  date: string;
  requests: number;
  input: number;
  output: number;
  cached: number;
  cache_write: number;
  cache_reported_input: number;
  models: UsageStatsDayModel[];
}

export interface ModelUsageStatsResponse {
  total_requests: number;
  total_input: number;
  total_output: number;
  total_cached: number;
  total_cache_write: number;
  cache_reported_input: number;
  days: UsageStatsDay[];
}

// ============ API client ============

export const usageStatsApi = {
  async getModelUsageStats(range: UsageStatsRange): Promise<ModelUsageStatsResponse> {
    return invoke('get_model_usage_stats', {
      request: { range },
    });
  },
};
