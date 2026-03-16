import os
import re

with open("src/main.rs", "r") as f:
    content = f.read()

# We need to add StreamAlerts implementation
content = content.replace("StreamStateTransitionsRequest, StreamStateTransitionsResponse, SubscribeEventsRequest,",
"Alert, AlertType, StreamAlertsRequest, StreamAlertsResponse, StreamStateTransitionsRequest, StreamStateTransitionsResponse, SubscribeEventsRequest,")

# Add new type of subscribers
content = content.replace("subscribers: RwLock<Vec<mpsc::Sender<Result<SubscribeEventsResponse, Status>>>>,",
"subscribers: RwLock<Vec<mpsc::Sender<Result<SubscribeEventsResponse, Status>>>>,\n    alert_subscribers: RwLock<Vec<mpsc::Sender<Result<StreamAlertsResponse, Status>>>>,")

# Add the implementation for StreamAlerts
stream_alerts_impl = """
    type StreamAlertsStream = ReceiverStream<Result<StreamAlertsResponse, Status>>;
    async fn stream_alerts(
        &self,
        _req: Request<StreamAlertsRequest>,
    ) -> Result<Response<Self::StreamAlertsStream>, Status> {
        let (tx, rx) = mpsc::channel(100);
        self.state.alert_subscribers.write().await.push(tx);
        Ok(Response::new(ReceiverStream::new(rx)))
    }
"""

content = content.replace("type StreamStateTransitionsStream =\n        ReceiverStream<Result<StreamStateTransitionsResponse, Status>>;", "type StreamStateTransitionsStream =\n        ReceiverStream<Result<StreamStateTransitionsResponse, Status>>;\n" + stream_alerts_impl)

with open("src/main.rs", "w") as f:
    f.write(content)

print("Added StreamAlerts method definition and state field.")
