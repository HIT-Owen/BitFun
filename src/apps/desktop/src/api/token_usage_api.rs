//! Local model-call usage statistics API.
//!
//! Aggregates the device-local token usage records (see
//! `bitfun_core::service::token_usage`) into day-level buckets. The data is
//! read-only and device-local: it is never merged or synced across devices.

use crate::api::app_state::AppState;
use bitfun_core::service::token_usage::{TimeRange, TokenUsageQuery};
use chrono::{DateTime, Datelike, Duration, Months, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::State;

/// Preset time ranges supported by the statistics view.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UsageStatsRange {
    Last7d,
    Last30d,
    ThisMonth,
    LastMonth,
    Last90d,
    All,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ModelUsageStatsRequest {
    pub range: UsageStatsRange,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelUsageStatsResponse {
    pub total_requests: u64,
    pub total_input: u64,
    pub total_output: u64,
    pub total_cached: u64,
    pub total_cache_write: u64,
    pub cache_reported_input: u64,
    pub days: Vec<UsageStatsDay>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UsageStatsDay {
    pub date: String,
    pub requests: u64,
    pub input: u64,
    pub output: u64,
    pub cached: u64,
    pub cache_write: u64,
    pub cache_reported_input: u64,
    pub models: Vec<UsageStatsDayModel>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UsageStatsDayModel {
    pub model_config_id: String,
    pub model_name: String,
    pub requests: u64,
    pub input: u64,
    pub output: u64,
    pub cached: u64,
    pub cache_write: u64,
    pub cache_reported_input: u64,
}

#[derive(Default)]
struct DayAgg {
    requests: u64,
    input: u64,
    output: u64,
    cached: u64,
    cache_write: u64,
    cache_reported_input: u64,
    models: BTreeMap<String, ModelAgg>,
}

#[derive(Default)]
struct ModelAgg {
    model_name: String,
    requests: u64,
    input: u64,
    output: u64,
    cached: u64,
    cache_write: u64,
    cache_reported_input: u64,
}

#[tauri::command]
pub async fn get_model_usage_stats(
    state: State<'_, AppState>,
    request: ModelUsageStatsRequest,
) -> Result<ModelUsageStatsResponse, String> {
    let (start, end) = resolve_range(&request.range);

    let records = state
        .token_usage_service
        .query_records(TokenUsageQuery {
            model_id: None,
            session_id: None,
            time_range: TimeRange::Custom { start, end },
            limit: None,
            offset: None,
            include_subagent: false,
        })
        .await
        .map_err(|e| format!("Failed to query token usage records: {}", e))?;

    let mut total_requests = 0u64;
    let mut total_input = 0u64;
    let mut total_output = 0u64;
    let mut total_cached = 0u64;
    let mut total_cache_write = 0u64;
    let mut cache_reported_input = 0u64;

    let mut days: BTreeMap<String, DayAgg> = BTreeMap::new();

    for record in records {
        // `query_records` scopes reads to whole day files; tighten to the exact
        // range here so partial first/last days are excluded.
        if record.timestamp < start || record.timestamp > end {
            continue;
        }

        total_requests += 1;
        total_input += record.input_tokens as u64;
        total_output += record.output_tokens as u64;
        total_cached += record.cached_tokens as u64;
        total_cache_write += record.cache_write_tokens as u64;
        if record.cached_tokens_available {
            cache_reported_input += record.input_tokens as u64;
        }

        let date = record.timestamp.format("%Y-%m-%d").to_string();
        let day = days.entry(date).or_default();
        day.requests += 1;
        day.input += record.input_tokens as u64;
        day.output += record.output_tokens as u64;
        day.cached += record.cached_tokens as u64;
        day.cache_write += record.cache_write_tokens as u64;
        if record.cached_tokens_available {
            day.cache_reported_input += record.input_tokens as u64;
        }

        let model = day
            .models
            .entry(record.model_config_id.clone())
            .or_insert_with(|| ModelAgg {
                model_name: record.effective_model_name.clone(),
                ..Default::default()
            });
        model.requests += 1;
        model.input += record.input_tokens as u64;
        model.output += record.output_tokens as u64;
        model.cached += record.cached_tokens as u64;
        model.cache_write += record.cache_write_tokens as u64;
        if record.cached_tokens_available {
            model.cache_reported_input += record.input_tokens as u64;
        }
    }

    let days_out = days
        .into_iter()
        .map(|(date, day)| UsageStatsDay {
            date,
            requests: day.requests,
            input: day.input,
            output: day.output,
            cached: day.cached,
            cache_write: day.cache_write,
            cache_reported_input: day.cache_reported_input,
            models: day
                .models
                .into_iter()
                .map(|(model_config_id, m)| UsageStatsDayModel {
                    model_config_id,
                    model_name: m.model_name,
                    requests: m.requests,
                    input: m.input,
                    output: m.output,
                    cached: m.cached,
                    cache_write: m.cache_write,
                    cache_reported_input: m.cache_reported_input,
                })
                .collect(),
        })
        .collect();

    Ok(ModelUsageStatsResponse {
        total_requests,
        total_input,
        total_output,
        total_cached,
        total_cache_write,
        cache_reported_input,
        days: days_out,
    })
}

fn resolve_range(range: &UsageStatsRange) -> (DateTime<Utc>, DateTime<Utc>) {
    let now = Utc::now();
    match range {
        UsageStatsRange::Last7d => (now - Duration::days(7), now),
        UsageStatsRange::Last30d => (now - Duration::days(30), now),
        UsageStatsRange::Last90d => (now - Duration::days(90), now),
        UsageStatsRange::ThisMonth => (start_of_month(now), now),
        UsageStatsRange::LastMonth => {
            let this_month_start = now
                .date_naive()
                .with_day(1)
                .unwrap_or_else(|| now.date_naive());
            let last_month_start = this_month_start - Months::new(1);
            (
                to_utc_midnight(last_month_start),
                to_utc_midnight(this_month_start),
            )
        }
        UsageStatsRange::All => (DateTime::UNIX_EPOCH, now),
    }
}

fn start_of_month(now: DateTime<Utc>) -> DateTime<Utc> {
    let first = now
        .date_naive()
        .with_day(1)
        .unwrap_or_else(|| now.date_naive());
    to_utc_midnight(first)
}

fn to_utc_midnight(date: chrono::NaiveDate) -> DateTime<Utc> {
    date.and_hms_opt(0, 0, 0)
        .map(|t| t.and_utc())
        .unwrap_or(DateTime::UNIX_EPOCH)
}
