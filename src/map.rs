use maxminddb::Reader;
use std::net::IpAddr;

pub struct GeoData {
    pub lat: f32,
    pub lon: f32,
    pub city: Option<String>,
    pub country: Option<String>,
}

pub struct Geolocation {
    pub reader: Option<Reader<Vec<u8>>>,
}

impl Geolocation {
    pub fn new(path: &str) -> Self {
        let reader = Reader::open_readfile(path).ok();
        Self { reader }
    }

    pub fn lookup(&self, ip: IpAddr) -> Option<GeoData> {
        let reader = self.reader.as_ref()?;
        let result = reader.lookup(ip).ok()?;
        let city_data: maxminddb::geoip2::City = result.decode().ok()??;

        let location = city_data.location;
        let lat = location.latitude? as f32;
        let lon = location.longitude? as f32;

        let city = city_data.city.names.english.map(String::from);
        let country = city_data.country.iso_code.map(String::from);

        Some(GeoData {
            lat,
            lon,
            city,
            country,
        })
    }
}
