use std::io::Write;

fn main() {
    let mut args = std::env::args().skip(1);
    let png_dir = std::path::PathBuf::from(args.next().expect("png dir"));
    for target in args {
        let path = std::path::PathBuf::from(&target);
        let stem = path.file_stem().unwrap().to_string_lossy().to_string();
        let png = std::fs::read(png_dir.join(format!("{stem}.png"))).expect("png");

        // fixtures are checked out read-only (lockable); lift that for the write
        let mut perms = std::fs::metadata(&path).expect("meta").permissions();
        let was_readonly = perms.readonly();
        if was_readonly {
            perms.set_readonly(false);
            std::fs::set_permissions(&path, perms.clone()).expect("chmod");
        }

        let mut comp = cfb::open_rw(&path).expect("open cfb");
        if comp.exists("/PreviewPNG") {
            comp.remove_stream("/PreviewPNG").expect("remove old");
        }
        let mut s = comp.create_stream("/PreviewPNG").expect("create stream");
        s.write_all(&png).expect("write png");
        drop(s);
        comp.flush().expect("flush");
        drop(comp);

        if was_readonly {
            let mut p = std::fs::metadata(&path).unwrap().permissions();
            p.set_readonly(true);
            let _ = std::fs::set_permissions(&path, p);
        }
        println!("ok {target}");
    }
}
