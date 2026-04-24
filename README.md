# livemap.kmcd.dev

A high-performance, real-time BGP visualization platform. This project visualizes the global "heartbeat" of the internet by processing thousands of BGP updates per second and rendering them as a fluid, interactive map.

[**Download the Latest Release**](https://github.com/sudorandom/livemap.kmcd.dev/releases/latest)

## Architecture

This project uses a hybrid architecture to achieve maximum performance and stability:

- **Collector (Rust):** A high-throughput backend that consumes BGP data from RIS Live (WebSocket) and RouteViews (Kafka). It performs real-time classification, RPKI validation, and anomaly detection using the `bgpkit` ecosystem.
- **Viewer (Go):** A 60fps, GPU-accelerated desktop application built with the **Ebitengine** 2D game engine. It communicates with the collector via gRPC to provide a fluid, real-time visualization of global routing events.

## Features

- **Real-Time Visualization:** Every BGP announcement or withdrawal is rendered as a pulse of light on a global map.
- **Advanced Classification:** Detects Hijacks, Route Leaks, Outages, Bogons, and DDoS Mitigation events in near real-time.
- **Dual-Protocol RPKI:** A dedicated dashboard visualizing the cryptographic health of both IPv4 and IPv6 routing.
- **Jitter Smoothing:** A 10-second desynchronized smoothing buffer ensures a fluid visual flow even during network stalls.
- **Resilient Recovery:** Intelligent "time-jump" detection allows the application to recover instantly from system sleep or hibernation.

## Data Sources

The BGP analysis leverages the **bgpkit** ecosystem heavily:
- **RIS Live**: Streaming BGP messages from RIPE RIS Live.
- **RouteViews**: BMP messages from RouteViews Kafka streams.
- **Authoritative Data**: RPKI validation, AS-to-Org mappings, and ASN metadata via `bgpkit-commons`.

## Building from Source

To build optimized production binaries for both components:

```bash
# Build the Collector (Rust)
cargo build --release

# Build the Viewer (Go)
go build -o bgp-viewer ./cmd/bgp-viewer/
```

## Running the Project

### 1. Start the Collector (Backend)
The collector handles all BGP stream ingestion and data processing. It requires a MaxMind GeoIP database (MMDB) to map BGP updates to geographical coordinates.

```bash
./target/release/bgp-collector --mmdb ./assets/dbip-city-lite-2026-03.mmdb --listen 127.0.0.1:50051
```
*Note: You can specify multiple MMDB files by repeating the `--mmdb` flag.*

### 2. Start the Viewer (Frontend)
The viewer connects to the collector via gRPC and renders the visualization.

```bash
./bgp-viewer
```

The viewer supports several CLI arguments for customization:
- `--width`: Render width (default: 1920)
- `--height`: Render height (default: 1080)
- `--scale`: Map scale factor (default: 380.0)
- `--tps`: Ticks per second (default: 30)
- `--hide-ui`: Start with UI hidden
- `--minimal-ui`: Start with minimal UI

## Local Development

For development, tools are managed via `mise`. This will install the required versions of Rust, Go, and other build tools.

```bash
# Install dependencies
mise install

# Run full project check (lint, fmt, test)
just check
```

You can use `just` to run the project in development mode:

```bash
# Start the Collector
just collector

# Start the Viewer
just viewer
```
