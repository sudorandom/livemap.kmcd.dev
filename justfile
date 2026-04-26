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
	cd web && mise exec -- pnpm install && mise exec -- pnpm exec tsc --noEmit
	cd web && mise exec -- pnpm run lint

web-dev:
	cd web && mise exec -- pnpm run dev

viewer:
	go run ./cmd/bgp-viewer/

collector:
	RUST_BACKTRACE=1 cargo run --bin bgp-collector -- --mmdb ./assets/dbip-city-lite-2026-03.mmdb

indexer:
	RUST_LOG=info RUST_BACKTRACE=1 cargo run --bin bgp-indexer -- --out-dir ./web/public/data --flush-interval 30

fauxrpc:
    fauxrpc run \
        --schema=proto \
        --addr=127.0.0.1:50051 \
