use bitfun_core_types::SessionKind;
use bitfun_services_core::session::{
    build_session_metadata_page, SessionMetadata, SessionRelationship, SessionRelationshipKind,
    SessionStatus,
};

fn metadata(session_id: &str, last_active_at: u64) -> SessionMetadata {
    let mut metadata = SessionMetadata::new(
        session_id.to_string(),
        session_id.to_string(),
        "agent".to_string(),
        "model".to_string(),
    );
    metadata.last_active_at = last_active_at;
    metadata
}

#[test]
fn session_page_keeps_visible_top_level_order_and_attaches_children() {
    let mut parent_older = metadata("parent-older", 1_000);
    let parent_latest = metadata("parent-latest", 2_000);
    let mut child = metadata("child-latest", 3_000);
    child.relationship = Some(SessionRelationship {
        kind: Some(SessionRelationshipKind::Btw),
        parent_session_id: Some("parent-latest".to_string()),
        ..Default::default()
    });
    let mut archived = metadata("archived", 4_000);
    archived.status = SessionStatus::Archived;
    parent_older.session_kind = SessionKind::Standard;

    let page =
        build_session_metadata_page(vec![archived, child, parent_latest, parent_older], None, 1);
    let session_ids = page
        .sessions
        .iter()
        .map(|metadata| metadata.session_id.as_str())
        .collect::<Vec<_>>();

    assert_eq!(page.total_top_level_count, 2);
    assert_eq!(page.loaded_top_level_count, 1);
    assert!(page.has_more);
    assert_eq!(session_ids, vec!["parent-latest", "child-latest"]);
}

#[test]
fn session_page_cursor_loads_next_top_level_window() {
    let page = build_session_metadata_page(
        vec![
            metadata("parent-3", 3_000),
            metadata("parent-2", 2_000),
            metadata("parent-1", 1_000),
        ],
        None,
        1,
    );

    let second_page = build_session_metadata_page(
        vec![
            metadata("parent-3", 3_000),
            metadata("parent-2", 2_000),
            metadata("parent-1", 1_000),
        ],
        page.next_cursor.as_deref(),
        1,
    );

    assert_eq!(second_page.loaded_top_level_count, 1);
    assert_eq!(second_page.sessions[0].session_id, "parent-2");
}

#[test]
fn session_page_nests_remote_edit_branches_under_their_fork_source() {
    let mut source = metadata("source", 1_000);
    let mut edit_branch = metadata("edit-branch", 2_000);
    edit_branch.custom_metadata = Some(serde_json::json!({
        "forkOrigin": {
            "sessionId": "source",
            "turnId": "turn-1",
            "turnIndex": 1,
            "baseTitle": "source"
        },
        "remoteEditOrigin": {
            "sessionId": "source",
            "turnId": "turn-1"
        }
    }));
    let mut plain_fork = metadata("plain-fork", 3_000);
    plain_fork.custom_metadata = Some(serde_json::json!({
        "forkOrigin": {
            "sessionId": "source",
            "turnId": "turn-0",
            "turnIndex": 1,
            "baseTitle": "source"
        }
    }));

    let page = build_session_metadata_page(vec![plain_fork, edit_branch, source], None, 10);

    let session_ids = page
        .sessions
        .iter()
        .map(|metadata| metadata.session_id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(session_ids, vec!["plain-fork", "source", "edit-branch"]);
    assert_eq!(page.total_top_level_count, 2);
}

#[test]
fn session_page_keeps_edit_branch_top_level_when_its_source_is_missing() {
    let mut edit_branch = metadata("edit-branch", 2_000);
    edit_branch.custom_metadata = Some(serde_json::json!({
        "forkOrigin": {
            "sessionId": "deleted-source",
            "turnId": "turn-1",
            "turnIndex": 1,
            "baseTitle": "deleted-source"
        },
        "remoteEditOrigin": {
            "sessionId": "deleted-source",
            "turnId": "turn-1"
        }
    }));

    let page = build_session_metadata_page(vec![edit_branch], None, 10);

    assert_eq!(page.total_top_level_count, 1);
    assert_eq!(page.sessions[0].session_id, "edit-branch");
}

#[test]
fn session_page_pins_sessions_above_unpinned_newest_pin_first() {
    let unpinned_newest = metadata("unpinned-newest", 3_000);
    let mut older_pin = metadata("older-pin", 1_000);
    older_pin.custom_metadata = Some(serde_json::json!({ "pinnedAt": 100 }));
    let mut newer_pin = metadata("newer-pin", 2_000);
    newer_pin.custom_metadata = Some(serde_json::json!({ "pinnedAt": 200 }));

    let page = build_session_metadata_page(vec![unpinned_newest, older_pin, newer_pin], None, 10);

    let session_ids = page
        .sessions
        .iter()
        .map(|metadata| metadata.session_id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        session_ids,
        vec!["newer-pin", "older-pin", "unpinned-newest"]
    );
}

#[test]
fn session_page_keeps_unpinned_last_active_order_and_paginates_pinned_first() {
    let mut pinned_old = metadata("pinned-old", 100);
    pinned_old.custom_metadata = Some(serde_json::json!({ "pinnedAt": 500 }));
    let unpinned_mid = metadata("unpinned-mid", 2_000);
    let unpinned_old = metadata("unpinned-old", 1_000);

    let first_page = build_session_metadata_page(
        vec![
            unpinned_mid.clone(),
            unpinned_old.clone(),
            pinned_old.clone(),
        ],
        None,
        2,
    );
    let first_ids = first_page
        .sessions
        .iter()
        .map(|metadata| metadata.session_id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(first_ids, vec!["pinned-old", "unpinned-mid"]);
    assert!(first_page.has_more);

    let second_page = build_session_metadata_page(
        vec![unpinned_mid, unpinned_old, pinned_old],
        first_page.next_cursor.as_deref(),
        2,
    );
    let second_ids = second_page
        .sessions
        .iter()
        .map(|metadata| metadata.session_id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(second_ids, vec!["unpinned-old"]);
    assert!(!second_page.has_more);
}

#[test]
fn session_page_treats_missing_or_cleared_pin_as_unpinned() {
    let mut cleared_pin = metadata("cleared-pin", 900);
    cleared_pin.custom_metadata = Some(serde_json::json!({}));
    let regular = metadata("regular", 800);
    let unpinned_newest = metadata("unpinned-newest", 3_000);

    let page = build_session_metadata_page(vec![cleared_pin, regular, unpinned_newest], None, 10);

    let session_ids = page
        .sessions
        .iter()
        .map(|metadata| metadata.session_id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        session_ids,
        vec!["unpinned-newest", "cleared-pin", "regular"]
    );
}

#[test]
fn session_page_pins_children_within_their_parent_group() {
    let parent = metadata("parent", 1_000);
    let mut unpinned_child = metadata("unpinned-child", 3_000);
    unpinned_child.relationship = Some(SessionRelationship {
        kind: Some(SessionRelationshipKind::Btw),
        parent_session_id: Some("parent".to_string()),
        ..Default::default()
    });
    let mut pinned_child = metadata("pinned-child", 2_000);
    pinned_child.relationship = Some(SessionRelationship {
        kind: Some(SessionRelationshipKind::Btw),
        parent_session_id: Some("parent".to_string()),
        ..Default::default()
    });
    pinned_child.custom_metadata = Some(serde_json::json!({ "pinnedAt": 300 }));

    let page = build_session_metadata_page(vec![parent, unpinned_child, pinned_child], None, 10);

    let session_ids = page
        .sessions
        .iter()
        .map(|metadata| metadata.session_id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        session_ids,
        vec!["parent", "pinned-child", "unpinned-child"]
    );
}
