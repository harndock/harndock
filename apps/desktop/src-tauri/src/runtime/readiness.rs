use tauri::Url;

const READY_MARKER: &str = "dsh web: ";

pub(super) fn parse_ready_url(line: &str) -> Result<Option<Url>, String> {
    let Some(marker_index) = line.find(READY_MARKER) else {
        return Ok(None);
    };
    let value = line[marker_index + READY_MARKER.len()..]
        .split_whitespace()
        .next()
        .ok_or_else(|| "the readiness line did not contain a URL".to_string())?;
    let url = Url::parse(value).map_err(|error| format!("invalid readiness URL: {error}"))?;

    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none()
        || url.path() != "/"
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(format!(
            "readiness URL must be a loopback HTTP root URL with an explicit port, got {value}"
        ));
    }

    let Some(query) = url.query() else {
        return Err(format!(
            "readiness URL must contain a launch token, got {value}"
        ));
    };
    let Some(token) = query.strip_prefix("token=") else {
        return Err(format!(
            "readiness URL must contain only a launch token, got {value}"
        ));
    };
    if token.len() != 43
        || !token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err(format!(
            "readiness URL contains an invalid launch token, got {value}"
        ));
    }

    Ok(Some(url))
}

#[cfg(test)]
mod tests {
    use super::parse_ready_url;

    #[test]
    fn ignores_unrelated_output() {
        assert_eq!(parse_ready_url("loader settled").unwrap(), None);
    }

    #[test]
    fn accepts_the_harness_readiness_line_with_a_lan_suffix() {
        let url =
            parse_ready_url("dsh web: http://127.0.0.1:43127/?token=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO12 (LAN: http://192.168.1.2:43127/?token=ignored)")
                .unwrap()
                .unwrap();
        assert_eq!(
            url.as_str(),
            "http://127.0.0.1:43127/?token=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO12"
        );
    }

    #[test]
    fn rejects_non_loopback_or_implicit_ports() {
        assert!(
            parse_ready_url(
                "dsh web: http://localhost:43127/?token=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO12"
            )
            .is_err()
        );
        assert!(parse_ready_url("dsh web: http://127.0.0.1").is_err());
        assert!(parse_ready_url("dsh web: https://127.0.0.1:43127/?token=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO12").is_err());
    }
}
