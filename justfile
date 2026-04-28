check:
	cargo fmt --all -- --check
	mise exec -- golangci-lint fmt ./...
	cargo clippy -- -D warnings -A clippy::collapsible_if
	mise exec -- golangci-lint run ./...
	just web-check

test:
	cargo test
	go test ./...

web-install:
	cd web && mise exec -- pnpm install

web-check:
	cd web && mise exec -- pnpm run astro sync
	cd web && mise exec -- pnpm run check


web-dev:
	cd web && mise exec -- pnpm run dev

viewer:
	go run ./cmd/bgp-viewer/

collector:
	RUST_BACKTRACE=1 cargo run --bin bgp-collector -- --mmdb ./assets/dbip-city-lite-2026-03.mmdb

indexer:
	RUST_LOG=info RUST_BACKTRACE=1 cargo run --bin bgp-indexer -- ./web/public/data

fauxrpc:
    fauxrpc run \
        --schema=proto \
        --addr=127.0.0.1:50051 \
