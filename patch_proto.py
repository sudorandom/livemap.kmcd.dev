import re

with open("proto/livemap/v1/livemap.proto", "r") as f:
    content = f.read()

# Add Alert related messages
alert_msgs = """

// Aggregation method for alerts.
enum AlertType {
    ALERT_TYPE_UNSPECIFIED = 0;
    ALERT_TYPE_BY_LOCATION = 1;
    ALERT_TYPE_BY_ASN = 2;
    ALERT_TYPE_BY_COUNTRY = 3;
}

// Alert represents a significant spike in anomalies.
message Alert {
    AlertType alert_type = 1;
    string location = 2; // Can be a radius, a city name, or just a generic string representing the area.
    uint32 asn = 3;
    string country = 4;
    Classification classification = 5;
    uint32 count = 6;
    int32 delta = 7; // Change in count over the last 5 minutes
    int64 timestamp = 8;
}

message StreamAlertsRequest {}

message StreamAlertsResponse {
    Alert alert = 1;
}
"""

if "StreamAlertsRequest" not in content:
    content = content.replace("message StreamStateTransitionsRequest {", alert_msgs + "message StreamStateTransitionsRequest {")
    content = content.replace("rpc StreamStateTransitions(StreamStateTransitionsRequest) returns (stream StreamStateTransitionsResponse);",
                              "rpc StreamStateTransitions(StreamStateTransitionsRequest) returns (stream StreamStateTransitionsResponse);\n    rpc StreamAlerts(StreamAlertsRequest) returns (stream StreamAlertsResponse);")
    with open("proto/livemap/v1/livemap.proto", "w") as f:
        f.write(content)
    print("Patched proto successfully")
else:
    print("Already patched")
