use bgpkit_commons::BgpkitCommons;

fn main() {
    let mut bgpkit = BgpkitCommons::new();
    bgpkit.load_asinfo(true, false, true, false).unwrap();
    let asn = 917;
    println!("{:?}", bgpkit.asinfo_get(asn).unwrap());

    let asn = 57695;
    println!("{:?}", bgpkit.asinfo_get(asn).unwrap());
}
