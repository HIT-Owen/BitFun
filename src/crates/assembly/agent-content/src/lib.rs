//! Immutable built-in Agent prompt content.
//!
//! Prompt selection, rendering, and runtime policy remain owned by the
//! product runtime. This crate owns only the release-bound text bytes.

include!(concat!(env!("OUT_DIR"), "/embedded_agent_prompts.rs"));

/// Prompt content used by the Memory product feature outside the generated catalog.
pub mod memories {
    pub const PHASE1_SYSTEM: &str = include_str!("../prompts/memories/phase1_system.md");
}
