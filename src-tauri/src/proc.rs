use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use tokio::process::Command;

use crate::error::{AppError, AppResult};

static GIT_PROGRAM: OnceLock<String> = OnceLock::new();

const PROBE_SECS: u64 = 8;

fn runs(program: &str) -> bool {
    use std::process::Stdio;
    use std::time::Instant;
    let mut cmd = std::process::Command::new(program);
    cmd.arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }

    let Ok(mut child) = cmd.spawn() else {
        return false;
    };
    let deadline = Instant::now() + Duration::from_secs(PROBE_SECS);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(_) => return false,
        }
    }
}

//
// pub fn git_program() -> &'static str {
//     if let Some(found) = GIT_PROGRAM.get() {
//         return found.as_str();
//     }
//     match resolve_git() {
//         Some(found) => GIT_PROGRAM.get_or_init(|| found).as_str(),
//         None => "git",
//     }
// }

/// GitHub Desktop ships Git and Git LFS but deliberately keeps them off PATH,
/// so someone who installed only GitHub Desktop still has a perfectly good
/// Git sitting on disk. Look on PATH first, then inside GitHub Desktop.
async fn resolved_git() -> &'static str {
    if let Some(found) = GIT_PROGRAM.get() {
        return found.as_str();
    }
    match tokio::task::spawn_blocking(resolve_git).await.ok().flatten() {
        Some(found) => GIT_PROGRAM.get_or_init(|| found).as_str(),
        None => "git",
    }
}

fn resolve_git() -> Option<String> {
    if runs("git") {
        return Some("git".to_string());
    }
    for candidate in git_candidates() {
        if candidate.is_file() {
            let path = candidate.to_string_lossy().into_owned();
            if runs(&path) {
                return Some(path);
            }
        }
    }
    None
}

fn git_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    #[cfg(windows)]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let desktop = PathBuf::from(&local).join("GitHubDesktop");
            if let Ok(entries) = std::fs::read_dir(&desktop) {
                let mut apps: Vec<PathBuf> = entries
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| {
                        p.file_name()
                            .and_then(|n| n.to_str())
                            .is_some_and(|n| n.starts_with("app-"))
                    })
                    .collect();
                // Newest version wins.
                apps.sort();
                for app in apps.into_iter().rev() {
                    out.push(app.join("resources").join("app").join("git").join("cmd").join("git.exe"));
                }
            }
        }
        for var in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
            if let Some(dir) = std::env::var_os(var) {
                out.push(PathBuf::from(dir).join("Git").join("cmd").join("git.exe"));
            }
        }
    }
    out
}

pub struct GitOutput {
    pub status: i32,
    pub stdout: String,
    pub stderr: String,
}

impl GitOutput {
    pub fn ok(&self) -> bool {
        self.status == 0
    }
}

fn base_command(program: &str, cwd: &Path) -> Command {
    let mut cmd = Command::new(program);
    cmd.current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        // GIT_TERMINAL_PROMPT only silences terminal prompts. Git Credential
        // Manager is a GUI, so without this a signed out user gets a sign in
        // window from every background poll. Only the explicit "Sign in"
        // action is allowed to be interactive.
        .env("GCM_INTERACTIVE", "never")
        .env("GIT_LFS_SKIP_SMUDGE", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

pub async fn run_git(repo: &Path, args: &[&str], timeout_secs: u64) -> AppResult<GitOutput> {
    run_program(repo, resolved_git().await, args, timeout_secs).await
}

pub async fn run_git_ok(repo: &Path, args: &[&str], timeout_secs: u64) -> AppResult<GitOutput> {
    let out = run_git(repo, args, timeout_secs).await?;
    if !out.ok() {
        let msg = if out.stderr.trim().is_empty() {
            format!("git {} failed with exit code {}", args.join(" "), out.status)
        } else {
            out.stderr.trim().to_string()
        };
        return Err(AppError::git(msg));
    }
    Ok(out)
}

pub async fn run_program(
    cwd: &Path,
    program: &str,
    args: &[&str],
    timeout_secs: u64,
) -> AppResult<GitOutput> {
    let mut cmd = base_command(program, cwd);
    cmd.args(args);

    let output = tokio::time::timeout(Duration::from_secs(timeout_secs), cmd.output())
        .await
        .map_err(|_| {
            AppError::new(
                "TIMEOUT",
                format!("{program} {} timed out after {timeout_secs}s", args.join(" ")),
            )
        })?
        .map_err(|e| AppError::new("SPAWN", format!("could not run {program}: {e}")))?;

    Ok(GitOutput {
        status: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

/// Lets Git Credential Manager put its sign in window up. Explicit user
/// actions only.
pub async fn run_git_interactive(
    repo: &Path,
    args: &[&str],
    timeout_secs: u64,
) -> AppResult<GitOutput> {
    let mut cmd = base_command(resolved_git().await, repo);
    cmd.env("GCM_INTERACTIVE", "auto").args(args);

    let output = tokio::time::timeout(Duration::from_secs(timeout_secs), cmd.output())
        .await
        .map_err(|_| AppError::new("TIMEOUT", "git timed out waiting for the sign in"))?
        .map_err(|e| AppError::new("SPAWN", format!("could not run git: {e}")))?;

    Ok(GitOutput {
        status: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

pub async fn run_git_stdin(
    repo: &Path,
    args: &[&str],
    stdin_data: &[u8],
    timeout_secs: u64,
) -> AppResult<GitOutput> {
    use std::process::Stdio;
    use tokio::io::AsyncWriteExt;

    let mut cmd = base_command(resolved_git().await, repo);
    cmd.args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let fut = async {
        let mut child = cmd
            .spawn()
            .map_err(|e| AppError::new("SPAWN", format!("could not run git: {e}")))?;
        let mut stdin = child.stdin.take().expect("stdin piped");
        stdin.write_all(stdin_data).await.map_err(AppError::from)?;
        drop(stdin);
        let output = child.wait_with_output().await.map_err(AppError::from)?;
        Ok::<_, AppError>(GitOutput {
            status: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    };

    tokio::time::timeout(Duration::from_secs(timeout_secs), fut)
        .await
        .map_err(|_| {
            AppError::new(
                "TIMEOUT",
                format!("git {} timed out after {timeout_secs}s", args.join(" ")),
            )
        })?
}
