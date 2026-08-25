//! References that reach outside the project.

use std::collections::HashSet;
use std::path::Path;

use serde::Serialize;

use crate::error::{AppError, AppResult};

/// A reference that points at a file outside the project.
#[derive(Debug, Serialize, Clone)]
pub struct OutsideRef {
    pub from: String,
    pub to: String,
    pub missing: bool,
}

#[derive(Debug, Serialize)]
pub struct OutsideCheck {
    pub refs: Vec<OutsideRef>,
    pub scanned: usize,
    pub checked: bool,
    pub why: Option<String>,
}

/// Only assemblies and drawings reference anything else.
fn references_things(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".sldasm") || lower.ends_with(".slddrw")
}

fn is_library_part(path: &str) -> bool {
    let lower = path.to_lowercase().replace('\\', "/");
    const LIBRARY_MARKERS: &[&str] = &[
        "/solidworks data/",
        "/solidworks corp/",
        "/design library/",
        "/toolbox/",
        "/program files/solidworks",
        "/program files (x86)/solidworks",
    ];
    if LIBRARY_MARKERS.iter().any(|m| lower.contains(m)) {
        return true;
    }
    #[cfg(windows)]
    if let Some(dir) = crate::swrefs::solidworks_install_dir() {
        let install = dir.to_string_lossy().to_lowercase().replace('\\', "/");
        if !install.is_empty() && lower.starts_with(&install) {
            return true;
        }
    }
    false
}

#[cfg(windows)]
const DEPS_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
try {
  $sw = [Runtime.InteropServices.Marshal]::GetActiveObject('SldWorks.Application')
} catch {
  [Console]::Error.WriteLine('SW_NOT_RUNNING')
  exit 3
}

$early = $false
$proc = Get-Process SLDWORKS -ErrorAction SilentlyContinue | Select-Object -First 1
if ($proc) {
  $interop = Join-Path (Split-Path $proc.Path) 'api\redist\SolidWorks.Interop.sldworks.dll'
  if (Test-Path $interop) {
    try { Add-Type -Path $interop; $early = $true }
    catch { [Console]::Error.WriteLine('interop load failed: ' + $_.Exception.Message) }
  }
}


$i = -1
foreach ($line in [IO.File]::ReadAllLines($env:SOLIDLOCKER_LIST)) {
  $i++
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  try {
    if ($early) {
      $deps = [SolidWorks.Interop.sldworks.ISldWorks].InvokeMember(
        'GetDocumentDependencies2', [Reflection.BindingFlags]::InvokeMethod,
        $null, $sw, @($line, $true, $true, $false))
    } else {
      $deps = $sw.GetDocumentDependencies2($line, $true, $true, $false)
    }
    # A flat array of name, path, name, path: only the paths are wanted.
    if ($null -ne $deps) {
      for ($k = 1; $k -lt $deps.Length; $k += 2) { "$i`t" + $deps[$k] }
    }
  } catch {
    [Console]::Error.WriteLine("deps $i failed: " + $_.Exception.Message)
  }
}
"#;

/// Ask the running SolidWorks what each document pulls in
#[cfg(windows)]
async fn ask_solidworks(docs: &[String], root: &Path) -> AppResult<Vec<(usize, String)>> {
    if crate::swrefs::solidworks_install_dir().is_none() {
        return Err(AppError::quiet("SWCOM", crate::messages::SW_NOT_INSTALLED));
    }

    let list = std::env::temp_dir().join(format!("solidlocker-refs-{}.txt", std::process::id()));
    let body: Vec<String> = docs
        .iter()
        .map(|rel| root.join(rel).to_string_lossy().into_owned())
        .collect();
    std::fs::write(&list, body.join("\r\n")).map_err(AppError::from)?;

    let envs = [("SOLIDLOCKER_LIST", list.clone().into_os_string())];
    let out = crate::swrefs::run_powershell(DEPS_SCRIPT, &envs, 300).await;
    let _ = std::fs::remove_file(&list);
    let out = out?;

    let stderr = String::from_utf8_lossy(&out.stderr);
    if stderr.contains("SW_NOT_RUNNING") {
        return Err(AppError::quiet("SWCOM", crate::messages::SW_NOT_RUNNING));
    }
    if !out.status.success() {
        return Err(AppError::new(
            "SWCOM",
            crate::messages::sw_lookup_failed(stderr.trim()),
        ));
    }

    let mut pairs = Vec::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let Some((idx, child)) = line.split_once('\t') else {
            continue;
        };
        let (Ok(idx), child) = (idx.trim().parse::<usize>(), child.trim()) else {
            continue;
        };
        if idx < docs.len() && !child.is_empty() {
            pairs.push((idx, child.to_string()));
        }
    }
    Ok(pairs)
}

#[cfg(not(windows))]
async fn ask_solidworks(_docs: &[String], _root: &Path) -> AppResult<Vec<(usize, String)>> {
    Err(AppError::quiet("SWCOM", crate::messages::SW_NOT_INSTALLED))
}


async fn shared_file_names(root: &Path) -> AppResult<HashSet<String>> {
    let out = crate::proc::run_git(root, &["ls-files", "-z"], 60).await?;
    if !out.ok() {
        return Err(AppError::git(out.stderr.trim().to_string()));
    }
    Ok(out
        .stdout
        .split('\0')
        .filter(|p| !p.is_empty())
        .filter_map(|p| p.rsplit('/').next())
        .map(|name| name.to_lowercase())
        .collect())
}

fn file_name_of(path: &str) -> String {
    path.rsplit(['/', '\\']).next().unwrap_or(path).to_lowercase()
}

fn place(root: &Path, abs: &str) -> (String, bool) {
    let root_key = root.to_string_lossy().replace('\\', "/").to_lowercase();
    let norm = abs.replace('\\', "/");
    let lower = norm.to_lowercase();
    let prefix = format!("{}/", root_key.trim_end_matches('/'));
    match lower.strip_prefix(&prefix) {
        Some(rest) => (norm[norm.len() - rest.len()..].to_string(), true),
        None => (norm, false),
    }
}

#[derive(Debug, Serialize)]
pub struct DepEdge {
    pub parent: String,
    pub child: String,
}

pub async fn dependency_graph(root: &Path) -> AppResult<Vec<DepEdge>> {
    let docs = documents_in_project(root).await?;
    if docs.is_empty() {
        return Ok(Vec::new());
    }
    let pairs = match ask_solidworks(&docs, root).await {
        Ok(pairs) => pairs,
        Err(_) if crate::swrefs::solidworks_install_dir().is_none() => {
            return Err(AppError::quiet(
                "SWCOM",
                crate::messages::SW_MAP_NOT_INSTALLED,
            ));
        }
        Err(_) => {
            return Err(AppError::quiet(
                "SWCOM",
                crate::messages::SW_MAP_NOT_RUNNING,
            ));
        }
    };

    if pairs.is_empty() {
        return Err(AppError::quiet("SWCOM", crate::messages::SW_MAP_NO_ANSWER));
    }

    let inside = shared_file_names(root).await.unwrap_or_default();
    let by_name: std::collections::HashMap<String, String> = docs
        .iter()
        .map(|p| (file_name_of(p), p.clone()))
        .collect();

    let mut seen: HashSet<(String, String)> = HashSet::new();
    let mut edges = Vec::new();
    for (idx, abs) in pairs {
        let name = file_name_of(&abs);
        if !inside.contains(&name) {
            continue;
        }
        let parent = docs[idx].clone();
        let child = by_name.get(&name).cloned().unwrap_or_else(|| place(root, &abs).0);
        if parent == child {
            continue;
        }
        if seen.insert((parent.clone(), child.clone())) {
            edges.push(DepEdge { parent, child });
        }
    }
    edges.sort_by(|a, b| {
        a.parent
            .to_lowercase()
            .cmp(&b.parent.to_lowercase())
            .then(a.child.to_lowercase().cmp(&b.child.to_lowercase()))
    });
    Ok(edges)
}

/// Assemblies and drawings that reference this part. Same COM call as the
/// reference check, read the other way round.
pub async fn used_by(root: &Path, target: &str) -> AppResult<Vec<String>> {
    let docs = documents_in_project(root).await?;
    if docs.is_empty() {
        return Ok(Vec::new());
    }
    let pairs = match ask_solidworks(&docs, root).await {
        Ok(pairs) => pairs,
        // can't ask SolidWorks -> show nothing rather than "used by nobody"
        Err(_) => return Ok(Vec::new()),
    };

    let wanted = file_name_of(target);
    let mut users: Vec<String> = Vec::new();
    for (idx, abs) in pairs {
        if file_name_of(&abs) != wanted {
            continue;
        }
        let holder = docs[idx].clone();
        if !users.contains(&holder) {
            users.push(holder);
        }
    }
    users.sort_by_key(|p| p.to_lowercase());
    Ok(users)
}

/// Assemblies and drawings in the project; nothing else references anything.
async fn documents_in_project(root: &Path) -> AppResult<Vec<String>> {
    let out = crate::proc::run_git(root, &["ls-files", "-z"], 60).await?;
    if !out.ok() {
        return Ok(Vec::new());
    }
    let mut docs: Vec<String> = out
        .stdout
        .split('\0')
        .filter(|p| !p.is_empty())
        .filter(|p| references_things(p))
        .filter(|p| root.join(p).is_file())
        .map(|p| p.to_string())
        .collect();
    docs.sort_by_key(|p| p.to_lowercase());
    Ok(docs)
}

/// Which of these files reach outside the project for something
pub async fn outside_references(root: &Path, paths: Vec<String>) -> AppResult<OutsideCheck> {
    let docs: Vec<String> = paths
        .into_iter()
        .filter(|p| references_things(p))
        .filter(|p| root.join(p).is_file())
        .collect();
    let scanned = docs.len();
    if docs.is_empty() {
        return Ok(OutsideCheck {
            refs: Vec::new(),
            scanned: 0,
            checked: true,
            why: None,
        });
    }

    let pairs = match ask_solidworks(&docs, root).await {
        Ok(pairs) => pairs,
        Err(e) => {
            return Ok(OutsideCheck {
                refs: Vec::new(),
                scanned,
                checked: false,
                why: Some(e.message),
            })
        }
    };

    let shared = shared_file_names(root).await.unwrap_or_default();

    let mut refs: Vec<OutsideRef> = Vec::new();
    let mut resolvable = 0usize;
    let mut seen: HashSet<(String, String)> = HashSet::new();
    for (idx, abs) in pairs {
        let (to, inside) = place(root, &abs);
        if inside || is_library_part(&to) {
            continue;
        }
        if shared.contains(&file_name_of(&to)) {
            resolvable += 1;
            continue;
        }
        let from = docs[idx].clone();
        if seen.insert((from.clone(), to.clone())) {
            refs.push(OutsideRef {
                missing: !Path::new(&abs).is_file(),
                from,
                to,
            });
        }
    }
    refs.sort_by_key(|r| r.from.to_lowercase());

    if !refs.is_empty() || resolvable > 0 {
        crate::logger::info(format!(
            "reference check: {} outside path(s) the project has its own copy of, {} with nothing to fall back on",
            resolvable,
            refs.len()
        ));
    }

    Ok(OutsideCheck {
        refs,
        scanned,
        checked: true,
        why: None,
    })
}

#[cfg(test)]
mod tests {
    use super::{is_library_part, place, references_things};
    use std::path::Path;

    #[test]
    fn sorts_paths_into_inside_and_outside_the_project() {
        let root = Path::new("C:/Users/Scaven/Downloads/Plane");
        // Windows hands these back with backslashes and its own casing
        let (path, inside) = place(root, "C:\\Users\\Scaven\\Downloads\\Plane\\Wings\\Rib.SLDPRT");
        assert!(inside);
        assert_eq!(path, "Wings/Rib.SLDPRT");

        // The one that breaks for everybody else keeps its full path.
        let (path, inside) = place(root, "C:\\Users\\andrew\\Desktop\\bracket.SLDPRT");
        assert!(!inside);
        assert_eq!(path, "C:/Users/andrew/Desktop/bracket.SLDPRT");
    }

    #[test]
    fn leaves_solidworks_own_library_alone() {
        assert!(is_library_part(
            "C:/SOLIDWORKS Data/browser/ansi metric/bolts and studs/hex bolt.sldprt"
        ));
        assert!(is_library_part(
            "C:/Program Files/SOLIDWORKS Corp/SOLIDWORKS/data/design library/routing/elbow.sldprt"
        ));
        assert!(!is_library_part("C:/Users/Dawelny/Downloads/Motor/Motor.SLDASM"));
    }

    #[test]
    fn a_stale_stored_path_is_not_a_broken_one() {
        use super::file_name_of;
        let shared: std::collections::HashSet<String> =
            ["motor assembly.sldasm", "wing_ribs.sldprt"]
                .iter()
                .map(|s| s.to_string())
                .collect();
        assert!(shared.contains(&file_name_of(
            "C:/Users/Tatia/Downloads/WING_Assembly/Wing_Ribs.SLDPRT"
        )));
        assert!(!shared.contains(&file_name_of("C:/Users/andrew/Desktop/bracket_v2.SLDPRT")));
    }

    #[test]
    fn only_assemblies_and_drawings_reference_anything() {
        assert!(references_things("Full Assembly/SA26.SLDASM"));
        assert!(references_things("Sheets/Layout.slddrw"));
        assert!(!references_things("Wings/Rib.SLDPRT"));
        assert!(!references_things("README.md"));
    }
}
