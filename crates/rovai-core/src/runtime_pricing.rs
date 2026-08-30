use chrono::{DateTime, NaiveDate, Utc};

const NANODOLLARS_PER_DOLLAR: u128 = 1_000_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CodexTokenBuckets {
    pub uncached_input: i64,
    pub cache_read: i64,
    pub cache_write: i64,
    pub output: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PriceEstimate {
    pub amount_decimal: String,
    pub catalog_version: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PricingTier {
    Standard,
    Fast,
}

#[derive(Debug, Clone, Copy)]
struct CatalogRate {
    model_keys: &'static [&'static str],
    effective_date: (i32, u32, u32),
    tier: PricingTier,
    uncached_input_nanos_per_token: u64,
    cache_read_nanos_per_token: u64,
    cache_write_nanos_per_token: u64,
    output_nanos_per_token: u64,
    version: &'static str,
}

// Rates are exact public API equivalents expressed as USD nanodollars per token.
// Keeping each effective revision explicit prevents a later price change from
// silently rewriting the meaning of already-finalized Run estimates.
const CODEX_PRICING_CATALOG: &[CatalogRate] = &[
    CatalogRate {
        model_keys: &["gpt-5.4", "gpt-5.4-2026-03-05"],
        effective_date: (2026, 3, 5),
        tier: PricingTier::Standard,
        uncached_input_nanos_per_token: 2_500,
        cache_read_nanos_per_token: 250,
        cache_write_nanos_per_token: 2_500,
        output_nanos_per_token: 15_000,
        version: "openai-api-standard-2026-03-05-gpt-5.4",
    },
    CatalogRate {
        model_keys: &["gpt-5.4-mini", "gpt-5.4-mini-2026-03-17"],
        effective_date: (2026, 3, 17),
        tier: PricingTier::Standard,
        uncached_input_nanos_per_token: 750,
        cache_read_nanos_per_token: 75,
        cache_write_nanos_per_token: 750,
        output_nanos_per_token: 4_500,
        version: "openai-api-standard-2026-03-17-gpt-5.4-mini",
    },
    CatalogRate {
        model_keys: &["gpt-5.5", "gpt-5.5-2026-04-23"],
        effective_date: (2026, 4, 23),
        tier: PricingTier::Standard,
        uncached_input_nanos_per_token: 5_000,
        cache_read_nanos_per_token: 500,
        cache_write_nanos_per_token: 5_000,
        output_nanos_per_token: 30_000,
        version: "openai-api-standard-2026-04-23-gpt-5.5",
    },
    CatalogRate {
        model_keys: &["gpt-5.6", "gpt-5.6-sol"],
        effective_date: (2026, 7, 9),
        tier: PricingTier::Standard,
        uncached_input_nanos_per_token: 5_000,
        cache_read_nanos_per_token: 500,
        cache_write_nanos_per_token: 6_250,
        output_nanos_per_token: 30_000,
        version: "openai-api-standard-2026-07-09-gpt-5.6-sol",
    },
    CatalogRate {
        model_keys: &["gpt-5.6-terra"],
        effective_date: (2026, 7, 9),
        tier: PricingTier::Standard,
        uncached_input_nanos_per_token: 2_500,
        cache_read_nanos_per_token: 250,
        cache_write_nanos_per_token: 3_125,
        output_nanos_per_token: 15_000,
        version: "openai-api-standard-2026-07-09-gpt-5.6-terra",
    },
    CatalogRate {
        model_keys: &["gpt-5.6-luna"],
        effective_date: (2026, 7, 9),
        tier: PricingTier::Standard,
        uncached_input_nanos_per_token: 1_000,
        cache_read_nanos_per_token: 100,
        cache_write_nanos_per_token: 1_250,
        output_nanos_per_token: 6_000,
        version: "openai-api-standard-2026-07-09-gpt-5.6-luna",
    },
    CatalogRate {
        model_keys: &["gpt-5.6-terra"],
        effective_date: (2026, 7, 30),
        tier: PricingTier::Standard,
        uncached_input_nanos_per_token: 2_000,
        cache_read_nanos_per_token: 200,
        cache_write_nanos_per_token: 2_500,
        output_nanos_per_token: 12_000,
        version: "openai-api-standard-2026-07-30-gpt-5.6-terra",
    },
    CatalogRate {
        model_keys: &["gpt-5.6-luna"],
        effective_date: (2026, 7, 30),
        tier: PricingTier::Standard,
        uncached_input_nanos_per_token: 200,
        cache_read_nanos_per_token: 20,
        cache_write_nanos_per_token: 250,
        output_nanos_per_token: 1_200,
        version: "openai-api-standard-2026-07-30-gpt-5.6-luna",
    },
    CatalogRate {
        model_keys: &["gpt-5.6", "gpt-5.6-sol"],
        effective_date: (2026, 7, 30),
        tier: PricingTier::Fast,
        uncached_input_nanos_per_token: 10_000,
        cache_read_nanos_per_token: 1_000,
        cache_write_nanos_per_token: 12_500,
        output_nanos_per_token: 60_000,
        version: "openai-api-fast-2026-07-30-gpt-5.6-sol",
    },
    CatalogRate {
        model_keys: &["gpt-5.6-terra"],
        effective_date: (2026, 7, 30),
        tier: PricingTier::Fast,
        uncached_input_nanos_per_token: 4_000,
        cache_read_nanos_per_token: 400,
        cache_write_nanos_per_token: 5_000,
        output_nanos_per_token: 24_000,
        version: "openai-api-fast-2026-07-30-gpt-5.6-terra",
    },
    CatalogRate {
        model_keys: &["gpt-5.6-luna"],
        effective_date: (2026, 7, 30),
        tier: PricingTier::Fast,
        uncached_input_nanos_per_token: 400,
        cache_read_nanos_per_token: 40,
        cache_write_nanos_per_token: 500,
        output_nanos_per_token: 2_400,
        version: "openai-api-fast-2026-07-30-gpt-5.6-luna",
    },
    CatalogRate {
        model_keys: &["gpt-5.5", "gpt-5.5-2026-04-23"],
        effective_date: (2026, 7, 30),
        tier: PricingTier::Fast,
        uncached_input_nanos_per_token: 12_500,
        cache_read_nanos_per_token: 1_250,
        cache_write_nanos_per_token: 12_500,
        output_nanos_per_token: 75_000,
        version: "openai-api-fast-2026-07-30-gpt-5.5",
    },
    CatalogRate {
        model_keys: &["gpt-5.4", "gpt-5.4-2026-03-05"],
        effective_date: (2026, 7, 30),
        tier: PricingTier::Fast,
        uncached_input_nanos_per_token: 5_000,
        cache_read_nanos_per_token: 500,
        cache_write_nanos_per_token: 5_000,
        output_nanos_per_token: 30_000,
        version: "openai-api-fast-2026-07-30-gpt-5.4",
    },
    CatalogRate {
        model_keys: &["gpt-5.4-mini", "gpt-5.4-mini-2026-03-17"],
        effective_date: (2026, 7, 30),
        tier: PricingTier::Fast,
        uncached_input_nanos_per_token: 1_500,
        cache_read_nanos_per_token: 150,
        cache_write_nanos_per_token: 1_500,
        output_nanos_per_token: 9_000,
        version: "openai-api-fast-2026-07-30-gpt-5.4-mini",
    },
];

pub(crate) fn supports_codex_price_estimate(
    model_key: Option<&str>,
    service_tier: Option<&str>,
    at: DateTime<Utc>,
) -> bool {
    rate_for(model_key, service_tier, at).is_some()
}

pub(crate) fn estimate_codex_api_price(
    model_key: Option<&str>,
    service_tier: Option<&str>,
    at: DateTime<Utc>,
    tokens: CodexTokenBuckets,
) -> Option<PriceEstimate> {
    let rate = rate_for(model_key, service_tier, at)?;
    let components = [
        (tokens.uncached_input, rate.uncached_input_nanos_per_token),
        (tokens.cache_read, rate.cache_read_nanos_per_token),
        (tokens.cache_write, rate.cache_write_nanos_per_token),
        (tokens.output, rate.output_nanos_per_token),
    ];
    let mut total_nanos = 0_u128;
    for (tokens, nanos_per_token) in components {
        let tokens = u128::try_from(tokens).ok()?;
        total_nanos = total_nanos.checked_add(tokens.checked_mul(nanos_per_token.into())?)?;
    }
    Some(PriceEstimate {
        amount_decimal: format_usd_nanos(total_nanos),
        catalog_version: rate.version,
    })
}

fn rate_for(
    model_key: Option<&str>,
    service_tier: Option<&str>,
    at: DateTime<Utc>,
) -> Option<&'static CatalogRate> {
    let model_key = model_key?.trim();
    let tier = match service_tier
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some("standard" | "default") => PricingTier::Standard,
        Some("fast" | "priority") => PricingTier::Fast,
        None | Some(_) => return None,
    };
    CODEX_PRICING_CATALOG
        .iter()
        .filter(|rate| rate.tier == tier && rate.model_keys.contains(&model_key))
        .filter_map(|rate| {
            let effective = NaiveDate::from_ymd_opt(
                rate.effective_date.0,
                rate.effective_date.1,
                rate.effective_date.2,
            )?;
            (effective <= at.date_naive()).then_some((effective, rate))
        })
        .max_by_key(|(effective, _)| *effective)
        .map(|(_, rate)| rate)
}

fn format_usd_nanos(value: u128) -> String {
    let whole = value / NANODOLLARS_PER_DOLLAR;
    let remainder = value % NANODOLLARS_PER_DOLLAR;
    if remainder == 0 {
        return whole.to_string();
    }
    let fraction = format!("{remainder:09}").trim_end_matches('0').to_string();
    format!("{whole}.{fraction}")
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;

    #[test]
    fn codex_catalog_selects_effective_model_and_cache_write_rates() {
        assert!(!supports_codex_price_estimate(
            Some("gpt-5.6-terra"),
            None,
            Utc::now()
        ));
        let before_reduction = estimate_codex_api_price(
            Some("gpt-5.6-terra"),
            Some("default"),
            Utc.with_ymd_and_hms(2026, 7, 29, 12, 0, 0).unwrap(),
            CodexTokenBuckets {
                uncached_input: 1_000_000,
                cache_read: 1_000_000,
                cache_write: 1_000_000,
                output: 1_000_000,
            },
        )
        .unwrap();
        assert_eq!(before_reduction.amount_decimal, "20.875");
        assert_eq!(
            before_reduction.catalog_version,
            "openai-api-standard-2026-07-09-gpt-5.6-terra"
        );

        let current = estimate_codex_api_price(
            Some("gpt-5.6-terra"),
            Some("default"),
            Utc.with_ymd_and_hms(2026, 8, 17, 0, 0, 0).unwrap(),
            CodexTokenBuckets {
                uncached_input: 1_000_000,
                cache_read: 1_000_000,
                cache_write: 1_000_000,
                output: 1_000_000,
            },
        )
        .unwrap();
        assert_eq!(current.amount_decimal, "16.7");
        assert_eq!(
            current.catalog_version,
            "openai-api-standard-2026-07-30-gpt-5.6-terra"
        );

        let older_model = estimate_codex_api_price(
            Some("gpt-5.4-mini"),
            Some("default"),
            Utc.with_ymd_and_hms(2026, 8, 17, 0, 0, 0).unwrap(),
            CodexTokenBuckets {
                uncached_input: 0,
                cache_read: 0,
                cache_write: 1_000_000,
                output: 0,
            },
        )
        .unwrap();
        assert_eq!(older_model.amount_decimal, "0.75");
        assert!(!supports_codex_price_estimate(
            Some("gpt-5.3-codex-spark"),
            None,
            Utc.with_ymd_and_hms(2026, 8, 17, 0, 0, 0).unwrap()
        ));
        assert!(!supports_codex_price_estimate(
            Some("gpt-5.6-sol"),
            Some("legacy_enterprise"),
            Utc.with_ymd_and_hms(2026, 8, 17, 0, 0, 0).unwrap()
        ));
    }
}
