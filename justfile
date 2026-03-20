check:
	cargo fmt --all -- --check
	cargo clippy -- -D warnings -A clippy::collapsible_if
	cargo test

fauxrpc:
    fauxrpc run \
        --schema=proto \
        --addr=127.0.0.1:50051 \
