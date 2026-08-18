use std::collections::HashSet;
use std::io::Read;
use std::path::Path;

use crate::error::{AppError, AppResult};
#[cfg(windows)]
use crate::messages;

const REF_EXTENSIONS: &[&str] = &[".sldprt", ".sldasm"];

const INVALID_FILENAME_CHARS: &[char] = &['\\', '/', ':', '*', '?', '"', '<', '>', '|'];

/// works on any buffer, CFB container or not
pub fn extract_names(buf: &[u8]) -> HashSet<String> {
    let mut names = HashSet::new();
    scan_text(&ascii_string(buf), &mut names);
    for parity in 0..2 {
        scan_text(&utf16le_string(buf, parity), &mut names);
    }
    names
}

fn ascii_string(buf: &[u8]) -> String {
    buf.iter()
        .map(|&b| {
            if (0x20..0x7f).contains(&b) {
                b as char
            } else {
                '\u{0}'
            }
        })
        .collect()
}

fn utf16le_string(buf: &[u8], parity: usize) -> String {
    let mut s = String::with_capacity(buf.len() / 2);
    let mut i = parity;
    while i + 1 < buf.len() {
        let unit = u16::from_le_bytes([buf[i], buf[i + 1]]);
        match char::from_u32(unit as u32) {
            Some(c) if (' '..='\u{7e}').contains(&c) => s.push(c),
            _ => s.push('\u{0}'),
        }
        i += 2;
    }
    s
}

fn scan_text(text: &str, names: &mut HashSet<String>) {
    let lower = text.to_lowercase();
    for ext in REF_EXTENSIONS {
        let mut search_from = 0;
        while let Some(pos) = lower[search_from..].find(ext) {
            let ext_start = search_from + pos;
            let ext_end = ext_start + ext.len();
            search_from = ext_end;

            // The extension must not be followed by more filename characters
            if lower[ext_end..]
                .chars()
                .next()
                .is_some_and(|c| c.is_alphanumeric())
            {
                continue;
            }

            let stem_start = lower[..ext_start]
                .rfind(|c: char| {
                    c == '\u{0}' || c.is_control() || INVALID_FILENAME_CHARS.contains(&c)
                })
                .map(|i| i + 1)
                .unwrap_or(0);
            let stem = lower[stem_start..ext_start].trim();
            if stem.is_empty() || stem.len() > 120 {
                continue;
            }
            names.insert(format!("{stem}{ext}"));
        }
    }
}

/// Attach to the running SolidWorks, and load its interop assembly if we can
/// find it.
#[cfg(windows)]
const SW_ATTACH: &str = r#"
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
    try {
      Add-Type -Path $interop
      $early = $true
    } catch {
      [Console]::Error.WriteLine('interop load failed: ' + $_.Exception.Message)
    }
  }
}
"#;

/// `doc` goes over in an environment variable rather than spliced into the
/// script: a path holding a quote or a `$` would otherwise be read as code.
#[cfg(windows)]
async fn run_powershell(
    script: &str,
    doc: Option<&Path>,
    timeout_secs: u64,
) -> AppResult<std::process::Output> {
    use std::process::Stdio;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let mut cmd = tokio::process::Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(path) = doc {
        cmd.env("SOLIDLOCKER_DOC", path);
    }
    cmd.creation_flags(CREATE_NO_WINDOW);

    tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), cmd.output())
        .await
        .map_err(|_| AppError::new("SWCOM", messages::SW_TOO_SLOW))?
        .map_err(|e| AppError::new("SWCOM", format!("could not run PowerShell: {e}")))
}

#[cfg(windows)]
fn nonempty_lines(bytes: &[u8]) -> Vec<String> {
    String::from_utf8_lossy(bytes)
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

/// Ask a running solidworks for a document's full dependency tree
#[cfg(windows)]
pub async fn solidworks_dependencies(abs_path: &Path) -> AppResult<Vec<String>> {
    if solidworks_install_dir().is_none() {
        return Err(AppError::new("SWCOM", messages::SW_NOT_INSTALLED));
    }

    // GetDocumentDependencies2 returns a flat array of name, path, name,
    // path. Only the odd entries are wanted.
    let script = format!(
        "{SW_ATTACH}{}",
        r#"
$deps = $null
if ($early) {
  try {
    $deps = [SolidWorks.Interop.sldworks.ISldWorks].InvokeMember(
      'GetDocumentDependencies2', [Reflection.BindingFlags]::InvokeMethod,
      $null, $sw, @($env:SOLIDLOCKER_DOC, $true, $true, $false))
  } catch {
    [Console]::Error.WriteLine('early-bound lookup failed: ' + $_.Exception.Message)
    $early = $false
  }
}
if (-not $early) {
  $deps = $sw.GetDocumentDependencies2($env:SOLIDLOCKER_DOC, $true, $true, $false)
}
if ($null -ne $deps) {
  for ($i = 1; $i -lt $deps.Length; $i += 2) { $deps[$i] }
}
"#
    );

    let out = run_powershell(&script, Some(abs_path), 60).await?;

    let stderr = String::from_utf8_lossy(&out.stderr);
    if stderr.contains("SW_NOT_RUNNING") {
        return Err(AppError::new("SWCOM", messages::SW_NOT_RUNNING));
    }
    if !out.status.success() {
        return Err(AppError::new(
            "SWCOM",
            messages::sw_lookup_failed(stderr.trim()),
        ));
    }

    Ok(nonempty_lines(&out.stdout))
}

/// Which documents SolidWorks currently has open. Best effort: anything that
/// goes wrong means "cannot tell", and the callers treat that as "none".
#[cfg(windows)]
pub async fn solidworks_open_documents() -> Vec<String> {
    // No SolidWorks, no open documents: skip the process spawn entirely.
    if solidworks_install_dir().is_none() {
        return Vec::new();
    }

    let script = format!(
        "{SW_ATTACH}{}",
        r#"
$docs = $null
if ($early) {
  try {
    $docs = [SolidWorks.Interop.sldworks.ISldWorks].InvokeMember(
      'GetDocuments', [Reflection.BindingFlags]::InvokeMethod, $null, $sw, @())
    if ($null -ne $docs) {
      foreach ($d in $docs) {
        [SolidWorks.Interop.sldworks.IModelDoc2].InvokeMember(
          'GetPathName', [Reflection.BindingFlags]::InvokeMethod, $null, $d, @())
      }
    }
  } catch {
    [Console]::Error.WriteLine('early-bound lookup failed: ' + $_.Exception.Message)
    $early = $false
  }
}
if (-not $early) {
  $docs = $sw.GetDocuments
  if ($null -ne $docs) { foreach ($d in $docs) { $d.GetPathName } }
}
"#
    );

    match run_powershell(&script, None, 20).await {
        // Ok(out) => {
        //     eprintln!("[swrefs] open docs: {}", String::from_utf8_lossy(&out.stderr));
        //     nonempty_lines(&out.stdout)
        // }
        Ok(out) => nonempty_lines(&out.stdout),
        Err(_) => Vec::new(),
    }
}

#[cfg(windows)]
pub async fn solidworks_icon() -> Option<String> {
    // This only needs the executable on disk, so it works whether or not SolidWorks is running
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$p = (Get-Process SLDWORKS -ErrorAction SilentlyContinue | Select-Object -First 1).Path
if (-not $p) {
  $root = Join-Path $env:ProgramFiles 'SOLIDWORKS Corp'
  if (Test-Path $root) {
    $f = Get-ChildItem $root -Depth 2 -Filter SLDWORKS.exe -Recurse -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($f) { $p = $f.FullName }
  }
}
if (-not $p) { exit 3 }
$ico = [System.Drawing.Icon]::ExtractAssociatedIcon($p)
$bmp = $ico.ToBitmap()
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
[Convert]::ToBase64String($ms.ToArray())
"#;

    let out = run_powershell(SCRIPT, None, 15).await.ok()?;
    if !out.status.success() {
        return None;
    }
    let b64 = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if b64.is_empty() {
        return None;
    }
    Some(format!("data:image/png;base64,{b64}"))
}

/// Where SolidWorks lives, or None when it isn't installed.
#[cfg(windows)]
pub fn solidworks_install_dir() -> Option<std::path::PathBuf> {
    let program_files = std::env::var("ProgramFiles").ok()?;
    let dir = std::path::PathBuf::from(program_files)
        .join("SOLIDWORKS Corp")
        .join("SOLIDWORKS");
    if dir.join("SLDWORKS.exe").exists() {
        Some(dir)
    } else {
        None
    }
}

#[cfg(windows)]
pub fn solidworks_sound(name: &str) -> Option<String> {
    use base64::Engine;
    const ALLOWED: &[&str] = &[
        "animation complete.wav",
        "collision detected.wav",
        "design study scenario complete.wav",
        "file open complete.wav",
        "interference detection complete.wav",
        "mesh completed successfully.wav",
        "mesh failure.wav",
        "rebuild complete.wav",
        "rebuild error.wav",
        "render complete.wav",
        "sensor alert.wav",
    ];
    if !ALLOWED.contains(&name) {
        return None;
    }
    let program_files = std::env::var("ProgramFiles").ok()?;
    let candidate = std::path::PathBuf::from(program_files)
        .join("SOLIDWORKS Corp")
        .join("SOLIDWORKS")
        .join("sldSoundApp")
        .join("SoundFiles")
        .join(name);
    let bytes = std::fs::read(candidate).ok()?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:audio/wav;base64,{b64}"))
}

pub fn scan_file(abs_path: &Path) -> AppResult<HashSet<String>> {
    let mut comp = cfb::open(abs_path).map_err(|e| {
        AppError::new(
            "SWPARSE",
            format!("Not a readable SolidWorks file ({}): {e}", abs_path.display()),
        )
    })?;

    let stream_paths: Vec<std::path::PathBuf> = comp
        .walk()
        .filter(|e| e.is_stream())
        .map(|e| e.path().to_path_buf())
        .collect();

    let mut names = HashSet::new();
    let mut buf = Vec::new();
    for stream_path in stream_paths {
        buf.clear();
        let Ok(mut stream) = comp.open_stream(&stream_path) else {
            continue;
        };
        if stream.read_to_end(&mut buf).is_err() {
            continue;
        }
        names.extend(extract_names(&buf));
    }

    if let Some(own) = abs_path.file_name().and_then(|n| n.to_str()) {
        names.remove(&own.to_lowercase());
    }

    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_ascii_and_utf16_names() {
        let mut buf = Vec::new();
        buf.extend_from_slice(b"\x00\x01C:\\projects\\wing\\Spar-Main.SLDPRT\x00junk");
        for unit in "rib_03.sldprt".encode_utf16() {
            buf.extend_from_slice(&unit.to_le_bytes());
        }
        buf.extend_from_slice(&[0, 0]);

        let names = extract_names(&buf);
        assert!(names.contains("spar-main.sldprt"), "{names:?}");
        assert!(names.contains("rib_03.sldprt"), "{names:?}");
    }

    #[test]
    fn strips_path_components_and_rejects_garbage() {
        let names = extract_names(b"D:\\a\\b\\Wing Assembly.SLDASM\x00x.sldprt9tail");
        assert!(names.contains("wing assembly.sldasm"));
        assert!(!names.iter().any(|n| n.contains('\\')));
        assert!(!names.contains("x.sldprt"));
    }

    #[test]
    fn scans_a_real_cfb_container() {
        let dir = std::env::temp_dir().join("solidlocker-swrefs-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("fake.sldasm");
        let _ = std::fs::remove_file(&path);

        {
            let mut comp = cfb::create(&path).unwrap();
            let mut stream = comp.create_stream("Contents").unwrap();
            use std::io::Write;
            let mut data = Vec::new();
            for unit in "..\\parts\\bulkhead.sldprt".encode_utf16() {
                data.extend_from_slice(&unit.to_le_bytes());
            }
            stream.write_all(&data).unwrap();
        }

        let names = scan_file(&path).unwrap();
        assert!(names.contains("bulkhead.sldprt"), "{names:?}");
        std::fs::remove_file(&path).unwrap();
    }
}
