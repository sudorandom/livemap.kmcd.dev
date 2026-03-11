check:
	cargo fmt --all -- --check
	cargo clippy -- -D warnings -A clippy::collapsible_if
	cargo test
