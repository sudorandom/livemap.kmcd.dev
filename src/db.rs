use crate::classifier::ClassificationType;
use ipnet::IpNet;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::params;
use std::collections::HashMap;
use std::time::Duration;
use tokio::sync::mpsc;

pub enum DbWriteOp {
    Upsert {
        prefix: String,
        state_json: String,
        ts: i64,
        c_type: i32,
        asn: u32,
    },
    Delete(String),
    Seen {
        prefix: IpNet,
        asn: u32,
    },
    RecordEvent {
        prefix: String,
        asn: u32,
        event_type: i32,
        ts: i64,
    },
}

pub struct ClassificationStats {
    pub total_prefixes: u32,
    pub ipv4_prefixes: u32,
    pub ipv6_prefixes: u32,
    pub asn_count: u32,
}

pub struct Db {
    pool: Pool<SqliteConnectionManager>,
    write_tx: mpsc::Sender<DbWriteOp>,
}

pub struct GlobalCounts {
    pub asn_count: u32,
    pub prefix_count: u32,
    pub ipv4_prefix_count: u32,
    pub ipv6_prefix_count: u32,
}

pub struct TopStats {
    pub flappiest_asn: u32,
    pub flappiest_prefix: String,
    pub flappy_prefix_count: u32,
    pub flappy_event_rate: f32,
}

impl Db {
    pub fn new(path: &str, seen_db: Option<crate::classifier::DiskTrie>) -> Self {
        let manager = SqliteConnectionManager::file(path);
        let pool = Pool::new(manager).expect("Failed to create SQLite pool");

        if let Ok(conn) = pool.get() {
            conn.execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA synchronous = NORMAL;
                 CREATE TABLE IF NOT EXISTS prefix_state (
                     prefix TEXT PRIMARY KEY,
                     state TEXT,
                     last_update_ts INTEGER,
                     classified_type INTEGER,
                     origin_asn INTEGER DEFAULT 0
                 );
                 CREATE TABLE IF NOT EXISTS events (
                     id INTEGER PRIMARY KEY AUTOINCREMENT,
                     prefix TEXT,
                     asn INTEGER,
                     event_type INTEGER,
                     ts INTEGER
                 );
                 CREATE TABLE IF NOT EXISTS rpki_stats (
                     id INTEGER PRIMARY KEY,
                     valid_ipv4 INTEGER,
                     invalid_ipv4 INTEGER,
                     not_found_ipv4 INTEGER
                 );
                 CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
                 CREATE INDEX IF NOT EXISTS idx_events_asn_ts ON events(asn, ts);
                 CREATE INDEX IF NOT EXISTS idx_prefix_state_type ON prefix_state(classified_type);
                 CREATE INDEX IF NOT EXISTS idx_prefix_state_asn ON prefix_state(origin_asn);
                 CREATE INDEX IF NOT EXISTS idx_prefix_state_stats ON prefix_state(classified_type, origin_asn, prefix);
                 ",
            )
            .expect("Failed to initialize SQLite schema");
            let _ = conn.execute(
                "ALTER TABLE prefix_state ADD COLUMN origin_asn INTEGER DEFAULT 0",
                [],
            );
        }

        let (write_tx, mut write_rx) = mpsc::channel::<DbWriteOp>(20000);
        let pool_clone = pool.clone();

        tokio::spawn(async move {
            let mut buffer = Vec::with_capacity(2000);
            let mut interval = tokio::time::interval(Duration::from_millis(100));
            loop {
                tokio::select! {
                    Some(op) = write_rx.recv() => {
                        buffer.push(op);
                        if buffer.len() >= 2000 { Self::flush_buffer(&pool_clone, seen_db.as_ref(), &mut buffer); }
                    }
                    _ = interval.tick() => {
                        if !buffer.is_empty() { Self::flush_buffer(&pool_clone, seen_db.as_ref(), &mut buffer); }
                    }
                }
            }
        });

        Self { pool, write_tx }
    }

    fn flush_buffer(
        pool: &Pool<SqliteConnectionManager>,
        seen_db: Option<&crate::classifier::DiskTrie>,
        buffer: &mut Vec<DbWriteOp>,
    ) {
        if let Ok(mut conn) = pool.get()
            && let Ok(tx) = conn.transaction()
        {
            for op in buffer.drain(..) {
                match op {
                    DbWriteOp::Upsert {
                        prefix,
                        state_json,
                        ts,
                        c_type,
                        asn,
                    } => {
                        let _ = tx.execute(
                                "INSERT INTO prefix_state (prefix, state, last_update_ts, classified_type, origin_asn) VALUES (?1, ?2, ?3, ?4, ?5)
                                 ON CONFLICT(prefix) DO UPDATE SET state=excluded.state, last_update_ts=excluded.last_update_ts, classified_type=excluded.classified_type, origin_asn=excluded.origin_asn",
                                params![prefix, state_json, ts, c_type, asn],
                            );
                    }
                    DbWriteOp::Delete(prefix) => {
                        let _ = tx.execute("DELETE FROM prefix_state WHERE prefix = ?1", [prefix]);
                    }
                    DbWriteOp::Seen { prefix, asn } => {
                        if let Some(s) = seen_db {
                            let _ = s.insert(prefix, &asn.to_be_bytes());
                        }
                    }
                    DbWriteOp::RecordEvent {
                        prefix,
                        asn,
                        event_type,
                        ts,
                    } => {
                        let _ = tx.execute(
                            "INSERT INTO events (prefix, asn, event_type, ts) VALUES (?1, ?2, ?3, ?4)",
                            params![prefix, asn, event_type, ts],
                        );
                    }
                }
            }
            let _ = tx.commit();
        }
    }

    pub fn get_pool(&self) -> Pool<SqliteConnectionManager> {
        self.pool.clone()
    }

    pub fn get_cached_rpki_stats(&self) -> Option<(u64, u64, u64)> {
        if let Ok(conn) = self.pool.get() {
            if let Ok(mut stmt) = conn.prepare("SELECT valid_ipv4, invalid_ipv4, not_found_ipv4 FROM rpki_stats WHERE id = 1") {
                if let Ok(mut rows) = stmt.query([]) {
                    if let Ok(Some(row)) = rows.next() {
                        let valid: i64 = row.get(0).unwrap_or(0);
                        let invalid: i64 = row.get(1).unwrap_or(0);
                        let not_found: i64 = row.get(2).unwrap_or(0);
                        return Some((valid as u64, invalid as u64, not_found as u64));
                    }
                }
            }
        }
        None
    }

    pub fn set_cached_rpki_stats(&self, valid: u64, invalid: u64, not_found: u64) {
        if let Ok(conn) = self.pool.get() {
            let _ = conn.execute(
                "INSERT INTO rpki_stats (id, valid_ipv4, invalid_ipv4, not_found_ipv4) VALUES (1, ?1, ?2, ?3)
                 ON CONFLICT(id) DO UPDATE SET valid_ipv4=excluded.valid_ipv4, invalid_ipv4=excluded.invalid_ipv4, not_found_ipv4=excluded.not_found_ipv4",
                params![valid as i64, invalid as i64, not_found as i64],
            );
        }
    }

    pub fn get_global_counts(&self) -> GlobalCounts {
        let mut counts = GlobalCounts {
            asn_count: 0,
            prefix_count: 0,
            ipv4_prefix_count: 0,
            ipv6_prefix_count: 0,
        };
        if let Ok(conn) = self.pool.get() {
            if let Ok(mut stmt) = conn.prepare_cached("SELECT count(DISTINCT origin_asn) FILTER (WHERE origin_asn != 0) FROM prefix_state") { counts.asn_count = stmt.query_row([], |row| row.get(0)).unwrap_or(0); }
            if let Ok(mut stmt) = conn.prepare_cached("SELECT count(*) FROM prefix_state") {
                counts.prefix_count = stmt.query_row([], |row| row.get(0)).unwrap_or(0);
            }
            if let Ok(mut stmt) = conn
                .prepare_cached("SELECT count(*) FROM prefix_state WHERE instr(prefix, ':') = 0")
            {
                counts.ipv4_prefix_count = stmt.query_row([], |row| row.get(0)).unwrap_or(0);
            }
            counts.ipv6_prefix_count = counts.prefix_count - counts.ipv4_prefix_count;
        }
        counts
    }

    pub fn get_top_stats(&self) -> TopStats {
        let mut stats = TopStats {
            flappiest_asn: 0,
            flappiest_prefix: String::new(),
            flappy_prefix_count: 0,
            flappy_event_rate: 0.0,
        };
        if let Ok(conn) = self.pool.get() {
            let now = chrono::Utc::now().timestamp();
            let day_ago = now - 86400;

            // Find the origin ASN with the most flap events in the last 24 hours
            // ClassificationType::Flap == 6
            let query = "SELECT asn, prefix, count(*) as c FROM events WHERE event_type = 6 AND ts >= ?1 GROUP BY prefix, asn ORDER BY c DESC LIMIT 1";
            if let Ok(mut stmt) = conn.prepare_cached(query) {
                if let Ok(mut rows) = stmt.query([day_ago]) {
                    if let Ok(Some(row)) = rows.next() {
                        stats.flappiest_asn = row.get(0).unwrap_or(0);
                        stats.flappiest_prefix = row.get(1).unwrap_or_default();
                        stats.flappy_prefix_count = row.get(2).unwrap_or(0);

                        // we'll try to calculate a naive update rate:
                        // last 5 minutes
                        let window_start = now - 300;
                        if let Ok(mut rate_stmt) = conn.prepare_cached("SELECT count(*) FROM prefix_state WHERE origin_asn = ?1 AND last_update_ts >= ?2") {
                            if let Ok(mut r_rows) = rate_stmt.query([stats.flappiest_asn as i64, window_start]) {
                                if let Ok(Some(r_row)) = r_rows.next() {
                                    let updates_in_5m: i64 = r_row.get(0).unwrap_or(0);
                                    stats.flappy_event_rate = (updates_in_5m as f32) / 300.0;
                                }
                            }
                        }
                    }
                }
            }
        }
        stats
    }

    pub fn get_classification_stats(&self) -> HashMap<ClassificationType, ClassificationStats> {
        let mut stats = HashMap::new();
        if let Ok(conn) = self.pool.get() {
            let query = "SELECT classified_type, count(*) as total, count(CASE WHEN instr(prefix, ':') = 0 THEN 1 END) as ipv4_total, count(DISTINCT origin_asn) FILTER (WHERE origin_asn != 0) as asns FROM prefix_state GROUP BY classified_type";
            if let Ok(mut stmt) = conn.prepare_cached(query)
                && let Ok(mut rows) = stmt.query([])
            {
                while let Ok(Some(row)) = rows.next() {
                    let c_i32: i32 = row.get(0).unwrap_or(0);
                    let total: u32 = row.get(1).unwrap_or(0);
                    let ipv4: u32 = row.get(2).unwrap_or(0);
                    let asns: u32 = row.get(3).unwrap_or(0);
                    stats.insert(
                        ClassificationType::from_i32(c_i32),
                        ClassificationStats {
                            total_prefixes: total,
                            ipv4_prefixes: ipv4,
                            ipv6_prefixes: total - ipv4,
                            asn_count: asns,
                        },
                    );
                }
            }
        }
        stats
    }

    pub fn get_prefix_state(&self, prefix: &str) -> Option<String> {
        if let Ok(conn) = self.pool.get()
            && let Ok(mut stmt) =
                conn.prepare_cached("SELECT state FROM prefix_state WHERE prefix = ?1")
        {
            return stmt.query_row([prefix], |row| row.get(0)).ok();
        }
        None
    }

    pub fn upsert_prefix_state(
        &self,
        prefix: &str,
        state_json: &str,
        ts: i64,
        c_type: i32,
        asn: u32,
    ) {
        let _ = self.write_tx.try_send(DbWriteOp::Upsert {
            prefix: prefix.to_string(),
            state_json: state_json.to_string(),
            ts,
            c_type,
            asn,
        });
    }

    pub fn delete_prefix(&self, prefix: &str) {
        let _ = self
            .write_tx
            .try_send(DbWriteOp::Delete(prefix.to_string()));
    }

    pub fn record_seen(&self, prefix: IpNet, asn: u32) {
        let _ = self.write_tx.try_send(DbWriteOp::Seen { prefix, asn });
    }

    pub fn record_event(&self, prefix: &str, asn: u32, event_type: i32, ts: i64) {
        let _ = self.write_tx.try_send(DbWriteOp::RecordEvent {
            prefix: prefix.to_string(),
            asn,
            event_type,
            ts,
        });
    }

    pub fn get_stale_prefixes(&self, stale_threshold: i64) -> Vec<(String, String)> {
        let mut results = Vec::new();
        if let Ok(conn) = self.pool.get()
            && let Ok(mut stmt) =
                conn.prepare("SELECT prefix, state FROM prefix_state WHERE last_update_ts < ?1")
            && let Ok(mut rows) = stmt.query([stale_threshold])
        {
            while let Ok(Some(row)) = rows.next() {
                results.push((row.get(0).unwrap(), row.get(1).unwrap()));
            }
        }
        results
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_global_counts_asn_zero() {
        use tempfile::tempdir;
        let dir = tempdir().unwrap();
        let path = dir.path().join("state.db");
        let db = Db::new(path.to_str().unwrap(), None);

        // Wait briefly for the pool to initialize
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

        let pool = db.get_pool();
        if let Ok(mut conn) = pool.get() {
            let tx = conn.transaction().unwrap();
            tx.execute(
                "INSERT INTO prefix_state (prefix, state, last_update_ts, classified_type, origin_asn) VALUES (?1, ?2, ?3, ?4, ?5)",
                params!["1.1.1.0/24", "{}", 0, 0, 0],
            ).unwrap();
            tx.execute(
                "INSERT INTO prefix_state (prefix, state, last_update_ts, classified_type, origin_asn) VALUES (?1, ?2, ?3, ?4, ?5)",
                params!["2.2.2.0/24", "{}", 0, 0, 12345],
            ).unwrap();
            tx.execute(
                "INSERT INTO prefix_state (prefix, state, last_update_ts, classified_type, origin_asn) VALUES (?1, ?2, ?3, ?4, ?5)",
                params!["2.2.3.0/24", "{}", 0, 0, 12345],
            ).unwrap();
            tx.commit().unwrap();
        }

        let counts = db.get_global_counts();
        // asn_count should ignore 0, and count DISTINCT non-zero ASNs
        assert_eq!(counts.asn_count, 1);
        assert_eq!(counts.prefix_count, 3);
    }
}
