use bgpkit_commons::BgpkitCommons;

#[tokio::main]
async fn main() {
    let handle = tokio::spawn(async move {
        let mut bgpkit = BgpkitCommons::new();
        bgpkit.load_rpki(None).unwrap();
        let status = bgpkit.rpki_validate(13335, "1.1.1.0/24").unwrap();
        println!("Status inside tokio::spawn: {:?}", status);
    });

    handle.await.unwrap();
}
