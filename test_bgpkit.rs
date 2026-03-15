fn main() {
    let mut bgpkit = bgpkit_commons::BgpkitCommons::new();
    bgpkit.load_asinfo_cached().unwrap();
}
