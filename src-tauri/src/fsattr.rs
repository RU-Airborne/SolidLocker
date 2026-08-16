use std::io;
use std::path::Path;

#[cfg(windows)]
pub fn set_readonly(path: &Path, readonly: bool) -> io::Result<bool> {
    let mut perms = std::fs::metadata(path)?.permissions();
    if perms.readonly() == readonly {
        return Ok(false);
    }
    perms.set_readonly(readonly);
    std::fs::set_permissions(path, perms)?;
    Ok(true)
}

#[cfg(unix)]
pub fn set_readonly(path: &Path, readonly: bool) -> io::Result<bool> {
    use std::os::unix::fs::PermissionsExt;

    let perms = std::fs::metadata(path)?.permissions();
    let mode = perms.mode();
    let new_mode = if readonly { mode & !0o222 } else { mode | 0o200 };
    if new_mode == mode {
        return Ok(false);
    }
    let mut perms = perms;
    perms.set_mode(new_mode);
    std::fs::set_permissions(path, perms)?;
    Ok(true)
}

pub fn is_writable(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|m| !m.permissions().readonly())
        .unwrap_or(false)
}

#[cfg(test)]
#[cfg(unix)]
mod tests {
    use super::*;

    #[test]
    fn toggles_owner_write_bit_only() {
        use std::os::unix::fs::PermissionsExt;

        let dir = std::env::temp_dir().join("solidlocker-fsattr-test");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("t.sldprt");
        std::fs::write(&file, b"x").unwrap();

        let mut p = std::fs::metadata(&file).unwrap().permissions();
        p.set_mode(0o644);
        std::fs::set_permissions(&file, p).unwrap();

        assert!(set_readonly(&file, true).unwrap());
        assert_eq!(
            std::fs::metadata(&file).unwrap().permissions().mode() & 0o777,
            0o444
        );

        assert!(set_readonly(&file, false).unwrap());
        assert_eq!(
            std::fs::metadata(&file).unwrap().permissions().mode() & 0o777,
            0o644
        );

        assert!(!set_readonly(&file, false).unwrap());
        std::fs::remove_file(&file).unwrap();
    }
}
