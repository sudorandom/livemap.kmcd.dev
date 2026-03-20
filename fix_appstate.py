import re

with open("src/main.rs", "r") as f:
    content = f.read()

content = content.replace("""#[allow(clippy::type_complexity)]
struct AppState {
    subscribers: RwLock<Vec<mpsc::Sender<Result<SubscribeEventsResponse, Status>>>>,""", """#[allow(clippy::type_complexity)]
struct AppState {
    top_flappiest_prefix: RwLock<String>,
    subscribers: RwLock<Vec<mpsc::Sender<Result<SubscribeEventsResponse, Status>>>>,""")

with open("src/main.rs", "w") as f:
    f.write(content)
