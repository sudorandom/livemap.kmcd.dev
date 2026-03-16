use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

pub fn default_rate_buckets() -> Vec<Arc<AtomicU64>> {
    (0..60).map(|_| Arc::new(AtomicU64::new(0))).collect()
}

pub struct CumulativeStats {
    pub msg_count: AtomicU64,
    pub rate_buckets: Vec<Arc<AtomicU64>>,
    pub last_bucket_ts: AtomicU64,
}

impl Default for CumulativeStats {
    fn default() -> Self {
        Self {
            msg_count: AtomicU64::new(0),
            rate_buckets: default_rate_buckets(),
            last_bucket_ts: AtomicU64::new(0),
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct StatsSnapshot {
    pub msg_count: u64,
    pub last_bucket_ts: i64,
}

impl CumulativeStats {
    pub fn cleanup_buckets(&self, now: i64) {
        let last = self.last_bucket_ts.load(Ordering::Relaxed) as i64;
        if last == 0 {
            self.last_bucket_ts.store(now as u64, Ordering::Relaxed);
            return;
        }
        if now > last {
            let diff = now - last;
            if diff >= 60 {
                for i in 0..60 {
                    self.rate_buckets[i].store(0, Ordering::Relaxed);
                }
            } else {
                for t in (last + 1)..=now {
                    self.rate_buckets[(t % 60) as usize].store(0, Ordering::Relaxed);
                }
            }
            self.last_bucket_ts.store(now as u64, Ordering::Relaxed);
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_event(&self, ts: i64) {
        self.msg_count.fetch_add(1, Ordering::Relaxed);
        self.cleanup_buckets(ts);
        self.rate_buckets[(ts % 60) as usize].fetch_add(1, Ordering::Relaxed);
    }

    pub fn get_current_rate(&self, now: i64, start_ts: i64) -> f32 {
        self.cleanup_buckets(now);
        let last = self.last_bucket_ts.load(Ordering::Relaxed) as i64;
        if now - last >= 60 {
            return 0.0;
        }
        let elapsed = (now - start_ts).max(1);
        let divisor = elapsed.min(60) as f32;
        let total: u64 = self
            .rate_buckets
            .iter()
            .map(|b| b.load(Ordering::Relaxed))
            .sum();
        total as f32 / divisor
    }

    pub fn get_rate_for_window(&self, now: i64, window_secs: i64) -> f32 {
        self.cleanup_buckets(now);
        let window = window_secs.clamp(1, 60);
        let mut total = 0;
        for i in 0..window {
            let ts = now - i;
            total += self.rate_buckets[(ts % 60) as usize].load(Ordering::Relaxed);
        }
        total as f32 / window as f32
    }

    pub fn to_snapshot(&self) -> StatsSnapshot {
        StatsSnapshot {
            msg_count: self.msg_count.load(Ordering::Relaxed),
            last_bucket_ts: self.last_bucket_ts.load(Ordering::Relaxed) as i64,
        }
    }

    pub fn from_snapshot(snap: StatsSnapshot) -> Self {
        Self {
            msg_count: AtomicU64::new(snap.msg_count),
            rate_buckets: default_rate_buckets(),
            last_bucket_ts: AtomicU64::new(snap.last_bucket_ts as u64),
        }
    }
}
