use bgpkit_parser::models::{BgpElem, ElemType, NetworkPrefix};
use ipnet::IpNet;
use std::str::FromStr;

fn main() {
    let p = IpNet::from_str("1.2.3.0/24").unwrap();
    println!("{:?}", p);
}
