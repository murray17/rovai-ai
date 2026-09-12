use anyhow::{Result, ensure};
use serde::Serialize;
use std::net::{IpAddr, SocketAddr};

pub struct Network {
    pub listen: SocketAddr,
    external: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Address {
    pub origin: String,
    interface: String,
    recommended: bool,
}

impl Network {
    pub fn new(listen: SocketAddr, external: Option<String>) -> Result<Self> {
        let external = external
            .map(|origin| -> Result<String> {
                let url = url::Url::parse(&origin)?;
                ensure!(
                    matches!(url.scheme(), "http" | "https")
                        && url.host_str().is_some()
                        && url.username().is_empty()
                        && url.password().is_none()
                        && url.query().is_none()
                        && url.fragment().is_none()
                        && url.path() == "/",
                    "invalid console origin"
                );
                Ok(url.origin().ascii_serialization())
            })
            .transpose()?;
        Ok(Self { listen, external })
    }

    pub fn addresses(&self) -> Result<Vec<Address>> {
        Ok(self
            .request_addresses()?
            .into_iter()
            .filter(|address| advertise(&address.origin))
            .collect())
    }

    fn request_addresses(&self) -> Result<Vec<Address>> {
        let mut addresses = Vec::new();
        if let Some(origin) = &self.external {
            addresses.push(Address {
                origin: origin.clone(),
                interface: "自定义地址".into(),
                recommended: false,
            });
        }
        for interface in if_addrs::get_if_addrs()? {
            let ip = interface.ip();
            if ip.is_unspecified()
                || ip.is_multicast()
                || (self.listen.is_ipv4() != ip.is_ipv4())
                || (!self.listen.ip().is_unspecified() && self.listen.ip() != ip)
            {
                continue;
            }
            // Browser URLs cannot portably express an IPv6 link-local scope ID.
            if matches!(ip, IpAddr::V6(v6) if v6.is_unicast_link_local()) {
                continue;
            }
            let origin = format!("http://{}", SocketAddr::new(ip, self.listen.port()));
            if !addresses.iter().any(|item| item.origin == origin) {
                addresses.push(Address {
                    origin,
                    interface: interface.name,
                    recommended: recommend(ip),
                });
            }
        }
        if !self.listen.ip().is_unspecified()
            && !addresses
                .iter()
                .any(|item| item.origin == format!("http://{}", self.listen))
        {
            addresses.push(Address {
                origin: format!("http://{}", self.listen),
                interface: "监听地址".into(),
                recommended: recommend(self.listen.ip()),
            });
        }
        addresses.sort_by(|a, b| {
            b.recommended
                .cmp(&a.recommended)
                .then(a.origin.cmp(&b.origin))
        });
        Ok(addresses)
    }

    pub fn allows(&self, host: Option<&str>, origin: Option<&str>) -> bool {
        // Each request must use one actual Host interface (or explicit proxy)
        // and its own same origin. Choosing another displayed address grants nothing.
        self.request_addresses().is_ok_and(|addresses| {
            addresses.iter().any(|address| {
                host == address
                    .origin
                    .split_once("://")
                    .map(|(_, authority)| authority)
                    && origin.is_none_or(|origin| origin == address.origin)
            })
        })
    }
}

// Address discovery is presentation, not a network admission rule.
fn advertise(origin: &str) -> bool {
    let Ok(url) = url::Url::parse(origin) else {
        return false;
    };
    let ip = match url.host() {
        Some(url::Host::Ipv4(ip)) => Some(ip),
        Some(url::Host::Ipv6(ip)) => ip.to_ipv4_mapped(),
        _ => None,
    };
    !ip.is_some_and(|ip| {
        let [a, b, _, _] = ip.octets();
        a == 198 && matches!(b, 18 | 19)
    })
}

fn recommend(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_private() && !ip.is_loopback(),
        IpAddr::V6(ip) => ip.is_unique_local(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Unique owner of interface recommendation vs request-origin admission.
    #[test]
    fn discovery_excludes_benchmark_addresses_without_changing_origin_admission() {
        let network = Network::new(
            "127.0.0.1:4317".parse().unwrap(),
            Some("http://198.18.0.1:4317".into()),
        )
        .unwrap();
        assert!(
            network
                .addresses()
                .unwrap()
                .iter()
                .all(|address| { address.origin == "http://127.0.0.1:4317" })
        );
        for (ip, visible) in [
            ("198.17.255.255", true),
            ("198.18.0.0", false),
            ("198.18.0.1", false),
            ("198.19.255.255", false),
            ("198.20.0.0", true),
            ("[::ffff:198.18.0.1]", false),
            ("[::1]", true),
        ] {
            let origin = format!("http://{ip}:4317");
            assert_eq!(advertise(&origin), visible, "{origin}");
            let bound = Network::new(format!("{ip}:4317").parse().unwrap(), None).unwrap();
            assert_eq!(!bound.addresses().unwrap().is_empty(), visible);
            assert!(bound.allows(Some(&format!("{ip}:4317")), Some(&origin)));
        }
        for (host, origin, allowed) in [
            ("127.0.0.1:4317", None, true),
            ("127.0.0.1:4317", Some("http://127.0.0.1:4317"), true),
            ("198.18.0.1:4317", Some("http://198.18.0.1:4317"), true),
            ("198.18.0.1:4317", Some("http://127.0.0.1:4317"), false),
            ("evil.invalid:4317", None, false),
            ("127.0.0.1:4317", Some("http://evil.invalid"), false),
        ] {
            assert_eq!(network.allows(Some(host), origin), allowed);
        }
        for ip in ["198.18.0.1", "198.19.255.254", "127.0.0.1"] {
            assert!(!recommend(ip.parse().unwrap()));
        }
        assert!(recommend("192.168.1.2".parse().unwrap()));
    }
}
