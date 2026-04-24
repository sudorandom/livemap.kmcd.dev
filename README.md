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

## Data Sources

The BGP analysis leverages **bgpkit** tools heavily to aggregate, parse, and analyze BGP data:
- **RIS Live**: Consumes streaming BGP messages from RIPE RIS Live WebSocket using `bgpkit-parser`.
- **RouteViews**: Consumes BMP messages from RouteViews Kafka stream using `bgpkit-parser`.
- **Authoritative Data**: Incorporates data from RPKI, AS-to-Org mappings, and hegemony scores fetched using `bgpkit-commons`.

## Classifications

The application analyzes the ingested streams to detect various types of events in near real-time:
- **Bogon**: An announcement for a prefix that is not globally routable (e.g., private IPs) or reserved.
- **Hijack**: An announcement for a prefix by an origin ASN that differs from the historically observed origin ASN, provided they aren't recognized siblings.
- **Route Leak**: The propagation of routing announcements beyond their intended scope (e.g., a customer route leaked to a transit provider), detected via Valley-Free violations or hairpin loops.
- **Minor Route Leak**: A smaller-scale route leak that is observed by a very small number of collectors/hosts.
- **Outage**: A significant event where a prefix loses all visibility (is fully withdrawn) across multiple collectors for a sustained period of time (e.g., 30 minutes).
- **DDoS Mitigation**: Detected through the presence of specific BGP communities (e.g., `65535:666`) commonly used for Remote Triggered Blackholing (RTBH) or traffic diversion during a DDoS attack.
- **Flap**: Frequent, rapid alternations between announcements and withdrawals for the same prefix.
- **Path Hunting**: A network convergence behavior where BGP explores multiple, increasingly longer, alternative paths before withdrawing a route completely.
- **Discovery**: A newly observed prefix that hasn't been seen historically by the application.
