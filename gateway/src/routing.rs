//! Glob-based pattern matching for redirects, rewrites, and header rules.
//!
//! Patterns use `*` as the wildcard, anchored start-to-end. Each `*` becomes
//! a capture group, addressable in templates via `$1`, `$2`, … in the order
//! the wildcards appeared.
//!
//! Examples:
//!   - `/old/*`              matches `/old/page.html`, captures `page.html`
//!   - `/api/*/v1/*`         matches `/api/foo/v1/bar`, captures `foo`, `bar`
//!   - `/assets/*`           matches `/assets/main.css`, captures `main.css`

use regex::Regex;

#[derive(Debug, Clone)]
pub struct CompiledPattern {
    regex: Regex,
}

impl CompiledPattern {
    pub fn new(glob: &str) -> Result<Self, regex::Error> {
        Ok(Self {
            regex: Regex::new(&glob_to_regex(glob))?,
        })
    }

    /// Returns the captured wildcard substrings (in order) if `path` matches,
    /// otherwise `None`. An empty `Vec` means a literal pattern matched.
    pub fn match_path<'a>(&self, path: &'a str) -> Option<Vec<&'a str>> {
        let caps = self.regex.captures(path)?;
        Some(
            caps.iter()
                .skip(1)
                .map(|c| c.map(|m| m.as_str()).unwrap_or(""))
                .collect(),
        )
    }
}

fn glob_to_regex(glob: &str) -> String {
    let mut out = String::with_capacity(glob.len() + 2);
    out.push('^');
    for ch in glob.chars() {
        match ch {
            '*' => out.push_str("(.*)"),
            '.' | '+' | '(' | ')' | '[' | ']' | '{' | '}' | '|' | '^' | '$' | '\\' | '?' => {
                out.push('\\');
                out.push(ch);
            }
            _ => out.push(ch),
        }
    }
    out.push('$');
    out
}

/// Substitute `$1`, `$2`, … in `template` with the corresponding capture.
/// Digits after `$` are parsed greedily, so `$10` references capture 10 (not
/// capture 1 followed by a literal `0`). Unknown indices are left as-is.
/// Use `$$` to write a literal `$`.
pub fn expand_template(template: &str, captures: &[&str]) -> String {
    let mut result = String::with_capacity(template.len());
    let mut chars = template.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '$' {
            if let Some(&next) = chars.peek() {
                if next == '$' {
                    chars.next();
                    result.push('$');
                    continue;
                }
                if next.is_ascii_digit() {
                    let mut digits = String::new();
                    while let Some(&d) = chars.peek() {
                        if d.is_ascii_digit() {
                            digits.push(d);
                            chars.next();
                        } else {
                            break;
                        }
                    }
                    let idx: usize = digits.parse().unwrap_or(0);
                    if idx > 0 && idx <= captures.len() {
                        result.push_str(captures[idx - 1]);
                    } else {
                        // Unknown index (or overflow): emit the original sequence.
                        result.push('$');
                        result.push_str(&digits);
                    }
                    continue;
                }
            }
        }
        result.push(c);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn literal_pattern_matches_exactly() {
        let p = CompiledPattern::new("/about").unwrap();
        assert!(p.match_path("/about").is_some());
        assert!(p.match_path("/about/").is_none());
        assert!(p.match_path("/about/team").is_none());
    }

    #[test]
    fn wildcard_captures_trailing_segment() {
        let p = CompiledPattern::new("/old/*").unwrap();
        let caps = p.match_path("/old/page.html").unwrap();
        assert_eq!(caps, vec!["page.html"]);
    }

    #[test]
    fn wildcard_captures_multiple_groups() {
        let p = CompiledPattern::new("/api/*/v1/*").unwrap();
        let caps = p.match_path("/api/foo/v1/bar").unwrap();
        assert_eq!(caps, vec!["foo", "bar"]);
    }

    #[test]
    fn wildcard_matches_empty_capture() {
        let p = CompiledPattern::new("/old/*").unwrap();
        let caps = p.match_path("/old/").unwrap();
        assert_eq!(caps, vec![""]);
    }

    #[test]
    fn regex_metacharacters_in_glob_are_escaped() {
        let p = CompiledPattern::new("/a.b").unwrap();
        assert!(p.match_path("/a.b").is_some());
        assert!(p.match_path("/aXb").is_none());
    }

    #[test]
    fn expand_template_substitutes_captures() {
        assert_eq!(expand_template("/new/$1", &["foo"]), "/new/foo");
        assert_eq!(
            expand_template("/api/$2/$1", &["x", "y"]),
            "/api/y/x"
        );
    }

    #[test]
    fn expand_template_preserves_dollar_dollar() {
        assert_eq!(expand_template("$$1", &["foo"]), "$1");
    }

    #[test]
    fn expand_template_passes_through_unknown_index() {
        assert_eq!(expand_template("/x/$3", &["a"]), "/x/$3");
    }

    #[test]
    fn expand_template_parses_multi_digit_indices() {
        let caps: Vec<&str> = vec![
            "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l",
        ];
        assert_eq!(expand_template("$10", &caps), "j");
        assert_eq!(expand_template("$12", &caps), "l");
        // boundary: $1 still works when 10+ captures exist
        assert_eq!(expand_template("$1", &caps), "a");
    }

    #[test]
    fn expand_template_unknown_multi_digit_passes_through() {
        assert_eq!(expand_template("$99", &["only-one"]), "$99");
    }
}
