//! Preview thumbnails for CAD files.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use crate::error::AppResult;

#[derive(Default)]
pub struct ThumbCache(pub Mutex<HashMap<String, Option<String>>>);

const BATCH: usize = 48;

#[cfg(windows)]
const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;

public struct SLSIZE { public int cx; public int cy; }

public static class SLThumb {
  [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"),
   InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItemImageFactory { void GetImage(SLSIZE size, int flags, out IntPtr phbm); }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr bc,
    [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
    [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory ppv);

  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr o);

  [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"),
   InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem { }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr bc,
    [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
    [MarshalAs(UnmanagedType.Interface)] out IShellItem ppv);

  public struct WTSID { public ulong a; public ulong b; }

  [ComImport, Guid("091162a4-bc96-411f-aae8-c5122cd03363"),
   InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISharedBitmap {
    void GetSharedBitmap(out IntPtr phbm);
    void GetSize(out SLSIZE size);
    void GetFormat(out uint fmt);
    void InitializeBitmap(IntPtr hbm, uint fmt);
    void Detach(out IntPtr phbm);
  }

  [ComImport, Guid("F676C15D-596A-4ce2-8234-33996F445DB1"),
   InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IThumbnailCache {
    void GetThumbnail(IShellItem item, uint size, uint flags,
      out ISharedBitmap bmp, out uint outFlags, out WTSID id);
  }

  // 0x8 is SIIGBF_THUMBNAILONLY: fail rather than hand back a generic file
  // icon, so the caller can fall back to its own type icon instead.
  static IntPtr FromProvider(string path, int px) {
    try {
      IShellItemImageFactory f;
      SHCreateItemFromParsingName(path, IntPtr.Zero,
        new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), out f);
      SLSIZE s; s.cx = px; s.cy = px;
      IntPtr h = IntPtr.Zero;
      f.GetImage(s, 0x8, out h);
      return h;
    } catch { return IntPtr.Zero; }
  }

  static IntPtr FromExplorerCache(string path, int px) {
    try {
      IShellItem item;
      SHCreateItemFromParsingName(path, IntPtr.Zero,
        new Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), out item);
      var cache = (IThumbnailCache)Activator.CreateInstance(
        Type.GetTypeFromCLSID(new Guid("50EF4544-AC9F-4A8E-B21B-8A26180DB13F")));
      ISharedBitmap sb; uint of; WTSID id;
      cache.GetThumbnail(item, (uint)px, 0x1, out sb, out of, out id);
      if (sb == null) return IntPtr.Zero;
      IntPtr h; sb.Detach(out h);
      return h;
    } catch { return IntPtr.Zero; }
  }

  public static string Png(string path, int px) {
    IntPtr h = FromProvider(path, px);
    if (h == IntPtr.Zero) h = FromExplorerCache(path, px);
    if (h == IntPtr.Zero) return null;
    try {
      using (Bitmap bmp = Image.FromHbitmap(h))
      using (MemoryStream ms = new MemoryStream()) {
        bmp.Save(ms, System.Drawing.Imaging.ImageFormat.Png);
        return Convert.ToBase64String(ms.ToArray());
      }
    } finally { DeleteObject(h); }
  }
}
"@ -ReferencedAssemblies System.Drawing

$px = [int]$env:SOLIDLOCKER_PX
$i = -1
foreach ($line in [IO.File]::ReadAllLines($env:SOLIDLOCKER_LIST)) {
  $i++
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  # One unreadable file must not cost the rest of the batch.
  try {
    $b = [SLThumb]::Png($line, $px)
    if ($b) { "$i`t$b" }
  } catch {
    [Console]::Error.WriteLine("thumb $i failed: " + $_.Exception.Message)
  }
}
"#;

fn embedded_png(abs: &Path) -> Option<Vec<u8>> {
    use std::io::Read;
    let mut comp = cfb::open(abs).ok()?;
    let stream_path = comp
        .walk()
        .find(|e| {
            e.is_stream() && e.name().eq_ignore_ascii_case("previewpng")
        })
        .map(|e| e.path().to_path_buf())?;
    let mut bytes = Vec::new();
    comp.open_stream(&stream_path).ok()?.read_to_end(&mut bytes).ok()?;
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some(bytes)
    } else {
        None
    }
}

pub async fn thumbnails(
    root: &Path,
    rels: Vec<String>,
    px: u32,
    cache: &ThumbCache,
) -> AppResult<HashMap<String, String>> {
    let started = std::time::Instant::now();
    let asked = rels.len();
    let mut found: HashMap<String, String> = HashMap::new();
    let mut todo: Vec<(String, String, String)> = Vec::new(); // rel, cache key, absolute
    // Kept only so the log can say where a request went.
    let (mut hits, mut blanks, mut absent) = (0usize, 0usize, 0usize);

    for rel in rels {
        let abs = root.join(&rel);
        let Ok(meta) = std::fs::metadata(&abs) else {
            absent += 1;
            continue;
        };
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let key = format!("{rel}|{mtime}|{}|{px}", meta.len());

        match cache.0.lock().unwrap().get(&key) {
            Some(Some(uri)) => {
                found.insert(rel, uri.clone());
                hits += 1;
                continue;
            }
            Some(None) => {
                blanks += 1;
                continue;
            }
            None => {}
        }
        // Git hands out forward slashes, so joining leaves a mixed-separator
        // path. SHCreateItemFromParsingName rejects those outright.
        let abs = abs.to_string_lossy().replace('/', "\\");
        todo.push((rel, key, abs));
    }

    if todo.is_empty() {
        // A request answered entirely from cache is not worth a line, but one
        // that comes back with nothing is: that is what a grid full of generic
        // icons looks like from in here.
        if found.is_empty() && asked > 0 {
            crate::logger::info(format!(
                "thumbs: {asked} file(s) at {px}px, no preview for any of them ({blanks} already known blank, {absent} not on disk)"
            ));
        }
        return Ok(found);
    }

    crate::logger::info(format!(
        "thumbs: {asked} file(s) at {px}px - {hits} cached, {blanks} known blank, {absent} not on disk, {} to draw",
        todo.len()
    ));

    {
        let paths: Vec<(usize, String)> = todo
            .iter()
            .enumerate()
            .map(|(i, (_, _, abs))| (i, abs.clone()))
            .collect();
        let embedded = tokio::task::spawn_blocking(move || {
            use base64::Engine;
            let mut out: HashMap<usize, String> = HashMap::new();
            for (i, abs) in paths {
                if let Some(png) = embedded_png(Path::new(&abs)) {
                    out.insert(
                        i,
                        base64::engine::general_purpose::STANDARD.encode(png),
                    );
                }
            }
            out
        })
        .await
        .unwrap_or_default();

        if !embedded.is_empty() {
            crate::logger::info(format!(
                "thumbs: {} of {} carried their own preview picture",
                embedded.len(),
                todo.len()
            ));
            let mut cached = cache.0.lock().unwrap();
            for (i, b64) in &embedded {
                let (rel, key, _) = &todo[*i];
                let uri = format!("data:image/png;base64,{b64}");
                cached.insert(key.clone(), Some(uri.clone()));
                found.insert(rel.clone(), uri);
            }
            drop(cached);
            let mut keep = Vec::new();
            for (i, item) in todo.into_iter().enumerate() {
                if !embedded.contains_key(&i) {
                    keep.push(item);
                }
            }
            todo = keep;
        }
    }
    if todo.is_empty() {
        crate::logger::info(format!(
            "thumbs: {} preview(s) for {asked} file(s) in {}ms",
            found.len(),
            started.elapsed().as_millis()
        ));
        return Ok(found);
    }

    #[cfg(windows)]
    for chunk in todo.chunks(BATCH) {
        let drawn = render_batch(chunk, px).await;
        let mut cached = cache.0.lock().unwrap();
        for (i, (rel, key, _)) in chunk.iter().enumerate() {
            match drawn.get(&i) {
                Some(b64) => {
                    let uri = format!("data:image/png;base64,{b64}");
                    cached.insert(key.clone(), Some(uri.clone()));
                    found.insert(rel.clone(), uri);
                }
                // Remembered so a file Windows cannot draw is asked about once.
                None => {
                    cached.insert(key.clone(), None);
                }
            }
        }
    }
    #[cfg(not(windows))]
    let _ = BATCH;

    crate::logger::info(format!(
        "thumbs: {} preview(s) for {asked} file(s) in {}ms",
        found.len(),
        started.elapsed().as_millis()
    ));

    Ok(found)
}

/// Index in the batch -> base64 PNG, for whatever came back.
#[cfg(windows)]
async fn render_batch(chunk: &[(String, String, String)], px: u32) -> HashMap<usize, String> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static SEQ: AtomicUsize = AtomicUsize::new(0);

    let started = std::time::Instant::now();

    let list = std::env::temp_dir().join(format!(
        "solidlocker-thumbs-{}-{}.txt",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    let body: String = chunk
        .iter()
        .map(|(_, _, abs)| abs.as_str())
        .collect::<Vec<_>>()
        .join("\r\n");
    if let Err(e) = std::fs::write(&list, body) {
        crate::logger::error(format!(
            "thumbs: could not write the batch list to {}: {e}",
            list.display()
        ));
        return HashMap::new();
    }

    let envs = [
        ("SOLIDLOCKER_LIST", list.clone().into_os_string()),
        ("SOLIDLOCKER_PX", std::ffi::OsString::from(px.to_string())),
    ];
    let out = crate::swrefs::run_powershell(SCRIPT, &envs, 90).await;
    let _ = std::fs::remove_file(&list);

    let out = match out {
        Ok(o) => o,
        Err(e) => {
            eprintln!("[thumbs] powershell failed: {e:?}");
            crate::logger::error(format!(
                "thumbs: PowerShell would not run for {} file(s): {}",
                chunk.len(),
                crate::logger::one_line(&format!("{e:?}"), 200)
            ));
            return HashMap::new();
        }
    };
    let mut drawn = HashMap::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let Some((idx, b64)) = line.split_once('\t') else {
            continue;
        };
        let (Ok(idx), b64) = (idx.trim().parse::<usize>(), b64.trim()) else {
            continue;
        };
        if idx < chunk.len() && !b64.is_empty() {
            drawn.insert(idx, b64.to_string());
        }
    }
    let ms = started.elapsed().as_millis();
    let detail = crate::logger::one_line(&String::from_utf8_lossy(&out.stderr), 400);

    if drawn.len() == chunk.len() && detail.is_empty() {
        crate::logger::info(format!("thumbs: drew all {} in {ms}ms", chunk.len()));
        return drawn;
    }

    let blank: Vec<&str> = chunk
        .iter()
        .enumerate()
        .filter(|(i, _)| !drawn.contains_key(i))
        .map(|(_, (rel, _, _))| rel.as_str())
        .collect();
    let named = blank.iter().take(5).copied().collect::<Vec<_>>().join(", ");
    let rest = if blank.len() > 5 {
        format!(" and {} more", blank.len() - 5)
    } else {
        String::new()
    };
    let line = format!(
        "thumbs: drew {} of {} in {ms}ms{}{}",
        drawn.len(),
        chunk.len(),
        if blank.is_empty() {
            String::new()
        } else {
            format!("; no preview for {named}{rest}")
        },
        if detail.is_empty() {
            String::new()
        } else {
            format!("; stderr: {detail}")
        }
    );
    if drawn.is_empty() {
        eprintln!("[thumbs] {line}");
        crate::logger::warn(line);
    } else {
        crate::logger::info(line);
    }
    drawn
}
