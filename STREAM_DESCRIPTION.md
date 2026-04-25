Experience the hidden infrastructure of the global internet.

This live stream visualizes real-time BGP (Border Gateway Protocol) update messages as they ripple across the globe. Every pulse represents a routing change, a network link flapping, or a critical withdrawal of connectivity from the global routing table.

🔴 WHAT YOU ARE SEEING:
The map shows BGP updates sourced from RIPE NCC's RIS Live service:
[https://ris-live.ripe.net/](https://ris-live.ripe.net/)
These updates are the "gossip" of the internet. It is how different networks (Autonomous Systems) tell each other how to reach IP addresses.

🎨 THE LEGEND (CLASSIFICATION ENGINE):
Updates are processed through a multi-stage classification engine and categorized into four severity tiers based on network behavior:

* Red Pulses (Critical): Hijacks, Outages, and Route Leaks. These represent significant routing failures or malicious activity, such as a network's prefixes being "stolen" (Hijack) or sustaining multiple withdrawals without recovery.
* Orange Pulses (Bad Behavior): Link Flaps and Routing Instability. This highlights volatile or inefficient routing, often caused by hardware issues or misconfigurations leading to rapid "flapping" of routes.
* Purple Pulses (Policy & Path Hunting): Routing adjustments and DDoS mitigation. This includes traffic engineering (Policy Churn), DDoS mitigation redirections, or the natural "Path Hunting" process where routers explore alternative routes during convergence.
* Blue Pulses (Discovery & Gossip): Routine background noise. This covers standard prefix origination and redundant updates that keep the global routing table synchronized.

🛡️ RPKI STATUS BARS:
The display includes real-time RPKI (Resource Public Key Infrastructure) metrics. RPKI is a security framework that allows networks to cryptographically verify that an Autonomous System is actually authorized to announce a specific set of IP addresses.
* Neo Green: Valid announcements (authenticated).
* Neo Pink/Red: Invalid announcements (potential hijacks or misconfigurations).
* Grey: Unknown/Not Found (no RPKI record exists for the prefix). The large size of this bar highlights a major industry challenge: much of the global internet still lacks cryptographic route validation, leaving it more vulnerable to accidents and hijacks.

🌀 WATCHING THE INTERNET SELF-HEAL:
Occasionally, you will see a sudden, massive wave of Purple (Path Hunting) pulses sweep across the globe simultaneously. You are witnessing the Internet’s "immune system" in action:

* Self-Correction in Real-Time: When a major global fiber cable is cut or a high-capacity backbone router fails, thousands of networks lose their primary path.
* The Global Recalculation: Instead of staying disconnected, the global routing system automatically "hunts" for new paths. This massive burst of purple is the sound of millions of routers worldwide re-mapping the internet to bypass the failure.
* Resiliency in Action: You are watching the internet heal itself at the speed of light, routing around damage to ensure the world stays connected.

📡 BEACON ANALYSIS:
The stream tracks "routing beacons"—prefixes that announce and withdraw on a strict schedule. By watching how fast these test signals ripple across the globe, we can measure the overall health, speed, and reaction time of the global routing system.
Learn more about routing beacons here:
[https://ris.ripe.net/docs/routing-beacons/](https://ris.ripe.net/docs/routing-beacons/)

⚙️ TECHNICAL SPECS:
* Resolution: 3840x2160 @ 30fps
* Data Source: RIPE NCC RIS Live (Real-time)
* Engine: Built with Go and Ebitengine
* Map Projection: Mollweide

🔗 PROJECT LINKS:
This project is open-source! Check out the code or contribute on GitHub:
[https://github.com/sudorandom/bgp-stream](https://github.com/sudorandom/bgp-stream)

Read the full technical breakdown:
[https://kmcd.dev/posts/live-internet-map/](https://kmcd.dev/posts/live-internet-map/)

🎵 MUSIC:
Featuring ambient and lo-fi tracks. Music sourced from https://freetouse.com/music

#BGP #Internet #Networking #Visualization #Cybersecurity #DataViz #4K #LiveStream #Technology #RPKI
