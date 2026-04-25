check:
	cargo fmt --all -- --check
	golangci-lint fmt ./...
	cargo clippy -- -D warnings -A clippy::collapsible_if
	golangci-lint run ./...

test:
	cargo test
	go test ./...

viewer:
	go run ./cmd/bgp-viewer/

collector:
	RUST_BACKTRACE=1 cargo run --bin bgp-collector -- --mmdb ./assets/dbip-city-lite-2026-03.mmdb

fauxrpc:
    fauxrpc run \
        --schema=proto \
        --addr=127.0.0.1:50051 \
