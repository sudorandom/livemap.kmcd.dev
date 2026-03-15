use bgpkit_commons::BgpkitCommons;

fn main() {
    let mut bgpkit = BgpkitCommons::new();
    bgpkit.load_asinfo(true, true, true, true).unwrap();
    let asn = 917;
    let info = bgpkit.asinfo_get(asn).unwrap();
    println!("{:?}", info);
}
