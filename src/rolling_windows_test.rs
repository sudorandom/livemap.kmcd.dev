use crate::classifier::ClassificationType;
use crate::rolling_windows::*;
use std::sync::Arc;

#[test]
fn test_rolling_windows_add_and_cleanup() {
    let mut rw = RollingWindows::default();
    let class = ClassificationType::Hijack;

    rw.add_event(
        10.0,
        20.0,
        12345,
        "AS12345".to_string(),
        Some("US".to_string()),
        Some("NYC".to_string()),
        None,
        class,
        100,
        "10.0.0.0/24".to_string(),
    );

    assert_eq!(rw.by_location.len(), 1);
    assert_eq!(rw.by_asn.len(), 1);
    assert_eq!(rw.by_country.len(), 1);

    // cleanup, current ts is 200, window is 50, so cut off is 150
    // Event ts 100 should be removed
    rw.cleanup(200, 50);

    assert_eq!(rw.by_location.len(), 0);
    assert_eq!(rw.by_asn.len(), 0);
    assert_eq!(rw.by_country.len(), 0);
}

#[test]
fn test_window_entry_creation() {
    let entry = WindowEntry {
        ts: 100,
        prefix: Arc::new("192.168.1.0/24".to_string()),
        city: Some(Arc::new("Tokyo".to_string())),
        country: Some(Arc::new("JP".to_string())),
        asn: 4444,
        as_name: Arc::new("AS4444".to_string()),
        org_name: None,
        lat: 0.0,
        lon: 0.0,
    };

    assert_eq!(entry.asn, 4444);
    assert_eq!(entry.ts, 100);
}
