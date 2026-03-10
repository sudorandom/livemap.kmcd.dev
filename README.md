# livemap.kmcd.dev

A Rust project using `bgpkit-parser` to consume BGP data from RIS Live (WebSocket) and RouteViews (Kafka).

## Setup

Tools are managed via `mise`.

```bash
mise install
```

## Running

The project runs both RIS Live and RouteViews consumers concurrently using `tokio`.

```bash
cargo run
```

Note: The RouteViews Kafka consumer is conceptual and expects a connection to `bmp.routeviews.org:9092`.

## Features

- **RIS Live**: Consumes streaming BGP messages from RIPE RIS Live WebSocket.
- **RouteViews**: Consumes BMP messages from RouteViews Kafka stream.
