//! Generate synthetic SolidWorks-like fixture files (OLE CFB containers with
//! embedded UTF-16 reference names) for testing SolidLocker against a repo.
//!
//! Usage: cargo run --example gen_fixtures -- /path/to/repo

use std::io::Write;
use std::path::Path;

fn write_fixture(path: &Path, refs: &[&str]) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    let _ = std::fs::remove_file(path);
    let mut comp = cfb::create(path).unwrap();
    let mut stream = comp.create_stream("Contents").unwrap();

    // Filler so files aren't trivially small.
    stream.write_all(&[0u8; 2048]).unwrap();

    for r in refs {
        let full = format!("C:\\shared\\rc-plane\\{r}");
        let mut data = Vec::new();
        for unit in full.encode_utf16() {
            data.extend_from_slice(&unit.to_le_bytes());
        }
        data.extend_from_slice(&[0, 0]);
        stream.write_all(&data).unwrap();
        stream.write_all(&[0u8; 64]).unwrap();
    }
    stream.flush().unwrap();
    println!("wrote {}", path.display());
}

fn main() {
    let root = std::env::args().nth(1).expect("usage: gen_fixtures <repo-root>");
    let root = Path::new(&root);

    let parts = [
        "01-Wing/spar-main.sldprt",
        "01-Wing/rib-01.sldprt",
        "01-Wing/rib-02.sldprt",
        "01-Wing/skin-panel.sldprt",
        "01-Wing/Ribs/rib-03.sldprt",
        "01-Wing/Ribs/Inner-Structure/rib-04.sldprt",
        "04-Horizontal-Tail/stabilizer.sldprt",
        "05-Vertical-Tail/fin.sldprt",
    ];
    for p in parts {
        write_fixture(&root.join(p), &[]);
    }

    write_fixture(
        &root.join("01-Wing/wing.sldasm"),
        &[
            "spar-main.sldprt",
            "rib-01.sldprt",
            "rib-02.sldprt",
            "rib-03.sldprt",
            "rib-04.sldprt",
            "skin-panel.sldprt",
        ],
    );
    write_fixture(
        &root.join("09-Full-Assembly/full-airplane.sldasm"),
        &["wing.sldasm", "stabilizer.sldprt", "fin.sldprt"],
    );
}
