//! Setup checks

use std::path::Path;

use serde::Serialize;

use crate::error::AppResult;
use crate::proc::run_git;

#[derive(Debug, Serialize)]
pub struct Check {
    /// Stable id the UI keys fix buttons on.
    pub id: String,
    pub label: String,
    /// "ok" | "warn" | "fail"
    pub state: String,
    pub detail: String,
    pub fix: Option<String>,
    /// The app can apply the fix itself.
    pub fixable: bool,
}

impl Check {
    fn ok(id: &str, label: &str, detail: impl Into<String>) -> Self {
        Check {
            id: id.into(),
            label: label.into(),
            state: "ok".into(),
            detail: detail.into(),
            fix: None,
            fixable: false,
        }
    }

    fn bad(state: &str, id: &str, label: &str, detail: impl Into<String>, fix: &str) -> Self {
        Check {
            id: id.into(),
            label: label.into(),
            state: state.into(),
            detail: detail.into(),
            fix: Some(fix.into()),
            fixable: false,
        }
    }

    fn we_can_fix(mut self) -> Self {
        self.fixable = true;
        self
    }
}

/// An LFS pointer file, rather than the real content.
fn is_pointer(path: &Path) -> bool {
    use std::io::Read;
    let Ok(mut f) = std::fs::File::open(path) else {
        return false;
    };
    let mut head = [0u8; 64];
    let Ok(n) = f.read(&mut head) else {
        return false;
    };
    head[..n].starts_with(b"version https://git-lfs")
}

fn cad_paths(stdout: &str) -> Vec<String> {
    stdout
        .split('\0')
        .filter(|p| !p.is_empty())
        .filter(|p| {
            let l = p.to_lowercase();
            l.ends_with(".sldprt") || l.ends_with(".sldasm") || l.ends_with(".slddrw")
        })
        .map(|p| p.to_string())
        .collect()
}

pub async fn run_checks(root: &Path) -> AppResult<Vec<Check>> {
    let mut checks = Vec::new();

    // tools
    let git = run_git(root, &["--version"], 15).await;
    checks.push(match &git {
        Ok(out) if out.ok() => Check::ok("git", "Git", out.stdout.trim()),
        _ => Check::bad(
            "fail",
            "git",
            "Git",
            "Not found on this computer.",
            "Install Git for Windows, then restart SolidLocker.",
        ),
    });

    let lfs = run_git(root, &["lfs", "version"], 15).await;
    checks.push(match &lfs {
        Ok(out) if out.ok() => Check::ok("lfs", "Git LFS", out.stdout.trim()),
        _ => Check::bad(
            "fail",
            "lfs",
            "Git LFS",
            "Not installed. Large CAD files cannot be stored or locked without it.",
            "Install Git LFS from git-lfs.com, then restart SolidLocker.",
        ),
    });

    // without the filters every CAD file checks out as a pointer
    let clean = run_git(root, &["config", "--get", "filter.lfs.clean"], 15).await;
    checks.push(match &clean {
        Ok(out) if out.ok() && !out.stdout.trim().is_empty() => {
            Check::ok("filters", "LFS filters", "Set up, so CAD files arrive whole.")
        }
        _ => Check::bad(
            "fail",
            "filters",
            "LFS filters",
            "Not set up, so CAD files stay as small placeholder files.",
            "Run `git lfs install` once for this computer.",
        )
        .we_can_fix(),
    });

    // this project
    let attrs = root.join(".gitattributes");
    let lockable = std::fs::read_to_string(&attrs)
        .map(|s| s.contains("lockable"))
        .unwrap_or(false);
    checks.push(if lockable {
        Check::ok("rules", "Locking rules", "This branch has them.")
    } else {
        Check::bad(
            "warn",
            "rules",
            "Locking rules",
            "This branch has no locking rules, so files cannot be locked on it.",
            "Use \"Set up locking\" on the main screen.",
        )
    });

    let readonly = run_git(
        root,
        &["config", "--local", "--get", "lfs.setlockablereadonly"],
        15,
    )
    .await;
    checks.push(match &readonly {
        Ok(out) if out.ok() && out.stdout.trim() == "true" => Check::ok(
            "readonly",
            "Read-only until locked",
            "On, so a file nobody has locked cannot be edited by accident.",
        ),
        _ => Check::bad(
            "warn",
            "readonly",
            "Read-only until locked",
            "Off. Files will stay editable even when somebody else holds the lock.",
            "SolidLocker sets this itself; if it keeps coming back, check .git/config.lock.",
        )
        .we_can_fix(),
    });

    // pointers instead of real files: the usual first-clone problem
    if let Ok(out) = run_git(root, &["ls-files", "-z"], 60).await {
        let cad = cad_paths(&out.stdout);
        let on_disk: Vec<&String> = cad.iter().filter(|p| root.join(p).is_file()).collect();
        let pointers = on_disk
            .iter()
            .filter(|p| is_pointer(&root.join(p.as_str())))
            .count();
        checks.push(if cad.is_empty() {
            Check::ok("content", "CAD files", "No CAD files on this branch yet.")
        } else if pointers == 0 {
            Check::ok(
                "content",
                "CAD files",
                format!("All {} downloaded in full.", on_disk.len()),
            )
        } else {
            Check::bad(
                "fail",
                "content",
                "CAD files",
                format!(
                    "{pointers} of {} are still placeholders, so SolidWorks cannot open them and they have no previews.",
                    on_disk.len()
                ),
                "Download them with `git lfs pull`.",
            )
            .we_can_fix()
        });
    }

    // left by a git killed mid-write; every later write fails until removed
    let mut stale = Vec::new();
    for name in ["config.lock", "index.lock"] {
        if root.join(".git").join(name).is_file() {
            stale.push(name);
        }
    }
    checks.push(if stale.is_empty() {
        Check::ok("locks", "Leftover lock files", "None.")
    } else {
        Check::bad(
            "warn",
            "locks",
            "Leftover lock files",
            format!(
                "{} left behind by a Git that was stopped partway. Some operations will keep failing until it is removed.",
                stale.join(" and ")
            ),
            "Close any other Git tool, then remove it.",
        )
        .we_can_fix()
    });

    // SolidWorks
    #[cfg(windows)]
    {
        let installed = crate::swrefs::solidworks_install_dir().is_some();
        checks.push(if installed {
            Check::ok("sw", "SolidWorks", "Installed.")
        } else {
            Check::bad(
                "warn",
                "sw",
                "SolidWorks",
                "Not found. Previews and \"Lock with parts\" both need it.",
                "Install SolidWorks on this computer.",
            )
        });

        if installed {
            let running = crate::swrefs::solidworks_running().await;
            checks.push(if running {
                Check::ok(
                    "swrun",
                    "SolidWorks running",
                    "Running, so parts lists and reference checks can be read.",
                )
            } else {
                Check::bad(
                    "warn",
                    "swrun",
                    "SolidWorks running",
                    "Not running. \"Lock with parts\" and the outside-reference check cannot read anything until it is.",
                    "Open SolidWorks. The documents themselves do not need to be open.",
                )
            });
        }
    }

    // draw one preview fresh, bypassing the cache, on a real file from this project
    #[cfg(windows)]
    if let Ok(out) = run_git(root, &["ls-files", "-z"], 60).await {
        let candidate = cad_paths(&out.stdout)
            .into_iter()
            .find(|p| root.join(p).is_file() && !is_pointer(&root.join(p)));
        if let Some(rel) = candidate {
            let fresh = crate::thumbs::ThumbCache::default();
            let drawn = crate::thumbs::thumbnails(root, vec![rel.clone()], 96, &fresh).await;
            let name = rel.rsplit('/').next().unwrap_or(&rel).to_string();
            checks.push(match drawn {
                Ok(map) if map.contains_key(&rel) => {
                    Check::ok("previews", "Previews", format!("Drew one for {name}."))
                }
                _ => Check::bad(
                    "warn",
                    "previews",
                    "Previews",
                    format!(
                        "Windows had no picture for {name}, so the file list will show plain icons."
                    ),
                    "Previews come from SolidWorks' own Windows handler. Check SolidWorks is installed, and that File Explorer's Options > View does not have \"Always show icons, never thumbnails\" ticked.",
                ),
            });
        }
    }

    Ok(checks)
}
