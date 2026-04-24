use crate::stats::*;
use std::sync::atomic::Ordering;

#[test]
fn test_default_rate_buckets() {
    let buckets = default_rate_buckets();
    assert_eq!(buckets.len(), 60);
    for bucket in buckets {
        assert_eq!(bucket.load(Ordering::Relaxed), 0);
    }
}

#[test]
fn test_cumulative_stats_add_event() {
    let stats = CumulativeStats::default();

    stats.add_event(100);
    assert_eq!(stats.msg_count.load(Ordering::Relaxed), 1);

    stats.add_event(101);
    assert_eq!(stats.msg_count.load(Ordering::Relaxed), 2);
}

#[test]
fn test_cumulative_stats_get_rate() {
    let stats = CumulativeStats::default();

    // add some events
    for i in 100..105 {
        stats.add_event(i);
    }

    // window is 10 secs, so total 5 events, rate 0.5
    let rate = stats.get_rate_for_window(104, 10);
    assert_eq!(rate, 0.5);
}

#[test]
fn test_to_from_snapshot() {
    let stats = CumulativeStats::default();
    stats.add_event(200);

    let snapshot = stats.to_snapshot();
    assert_eq!(snapshot.msg_count, 1);
    assert_eq!(snapshot.last_bucket_ts, 200);

    let stats2 = CumulativeStats::from_snapshot(snapshot);
    assert_eq!(stats2.msg_count.load(Ordering::Relaxed), 1);
}
