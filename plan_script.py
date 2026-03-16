plan = """1. Verify `pkg/bgpengine/engine.go` updates.
   - Using `grep`, ensure `isEventSignificant` correctly applies the >= 5000 IPs or >= 20 IPv6 prefixes to `bgp.NameRouteLeak`, `bgp.NameMinorRouteLeak`, and `bgp.NameHijack` as done in the previous step.
2. Update `proto/livemap/v1/livemap.proto`
   - Use `write_file` or a Python script to patch the file, adding `rpc StreamAlerts(StreamAlertsRequest) returns (stream StreamAlertsResponse);`.
   - Add the necessary `Alert` definitions (by location, ASN, country) to the proto file.
   - Verify the edits with `read_file`.
3. Implement `StreamAlerts` feature in Rust backend (`src/main.rs`).
   - Define a `RollingWindows` struct that stores bad events by (ASN), (Country), and (Location) over the last 5 minutes (using timestamps to drop older data).
   - Update `AppState` to include a subscriber list for `StreamAlerts`.
   - Update the `rx.recv()` loop to push new bad events (like `RouteLeak`, `Outage`, `Hijack`) to the rolling windows.
   - Add a 1-minute ticker task that evaluates the count over the last 5 minutes. If a count changes significantly (e.g. > 10% increase or raw threshold), create an `Alert` and send it to all subscribers.
   - Verify the Rust changes compile using `cargo check`.
4. Consume `StreamAlerts` in Go frontend.
   - Run `buf generate` to regenerate the protobuf Go code.
   - In `pkg/bgpengine/grpc_worker.go`, add a `consumeAlertStream` method that connects to `StreamAlerts`. Add this to `runGRPCClient` alongside the other streams.
   - Modify `pkg/bgpengine/engine.go` to handle these alerts. For example, add a `RecordAlert` function that formats the high-order event into a `CriticalEvent` and adds it to `e.criticalQueue`.
   - Verify the Go changes compile using `go build ./...`.
5. Run tests
   - Run `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check` in root.
   - Run `xvfb-run go test ./...` in root.
6. Complete pre commit steps
   - Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.
"""

print(plan)
