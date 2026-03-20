use maxminddb::Reader;
use std::net::IpAddr;

pub struct GeoData {
    pub lat: f32,
    pub lon: f32,
    pub city: Option<String>,
    pub country: Option<String>,
}

pub struct Geolocation {
    pub readers: Vec<Reader<Vec<u8>>>,
}

impl Geolocation {
    pub fn new(paths: Vec<String>) -> Self {
        let mut readers = Vec::new();
        for path in paths {
            if let Ok(reader) = Reader::open_readfile(path.clone()) {
                readers.push(reader);
            } else {
                log::warn!("Failed to load MMDB from path: {}", path);
            }
        }
        Self { readers }
    }

    pub fn lookup(&self, ip: IpAddr) -> Option<GeoData> {
        for reader in &self.readers {
            if let Ok(result) = reader.lookup(ip) {
                if let Ok(city_data) = result.decode::<maxminddb::geoip2::City>() {
                    let city_data = city_data?;

                    let lat = city_data.location.latitude? as f32;
                    let lon = city_data.location.longitude? as f32;

                    let city = city_data.city.names.english.map(|s| s.to_string());

                    let country = city_data.country.iso_code.map(|s| s.to_string());

                    return Some(GeoData {
                        lat,
                        lon,
                        city,
                        country,
                    });
                }
            }
        }
        None
    }
}
