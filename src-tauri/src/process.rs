use crate::domain::*;
use std::{
    io::{Read, Write},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread,
    time::{Duration, Instant},
};
pub fn command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    for key in [
        "NODE_OPTIONS",
        "LD_PRELOAD",
        "LD_LIBRARY_PATH",
        "DYLD_INSERT_LIBRARIES",
        "DYLD_LIBRARY_PATH",
        "PYTHONSTARTUP",
        "RUBYOPT",
        "PERL5OPT",
        "GIT_CONFIG_COUNT",
        "GIT_CONFIG_PARAMETERS",
    ] {
        cmd.env_remove(key);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    cmd
}
pub fn terminate(child: &mut Child) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
    let _ = child.wait();
}
fn read_bounded(
    mut reader: impl Read + Send + 'static,
    limit: usize,
    overflow: Arc<AtomicBool>,
) -> mpsc::Receiver<std::io::Result<Vec<u8>>> {
    let (tx, rx) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let mut chunk = [0u8; 8192];
        let result = loop {
            match reader.read(&mut chunk) {
                Ok(0) => break Ok(bytes),
                Ok(n) => {
                    if bytes.len() + n > limit {
                        overflow.store(true, Ordering::SeqCst);
                        break Ok(bytes);
                    }
                    bytes.extend_from_slice(&chunk[..n]);
                }
                Err(e) => break Err(e),
            }
        };
        let _ = tx.send(result);
    });
    rx
}
pub fn bounded(
    cmd: Command,
    input: Option<Vec<u8>>,
    limit: usize,
    timeout: Duration,
) -> Result<Vec<u8>> {
    bounded_with_success_codes(cmd, input, limit, timeout, &[0])
}

pub fn bounded_with_success_codes(
    mut cmd: Command,
    input: Option<Vec<u8>>,
    limit: usize,
    timeout: Duration,
    success_codes: &[i32],
) -> Result<Vec<u8>> {
    if input.is_some() {
        cmd.stdin(Stdio::piped());
    }
    let mut child = cmd.spawn().map_err(|e| {
        AppError::new(
            if e.kind() == std::io::ErrorKind::NotFound {
                "tool_missing"
            } else {
                "tool_failed"
            },
            "Could not start the configured tool. Check installation, PATH, and permissions.",
        )
    })?;
    let overflow = Arc::new(AtomicBool::new(false));
    let out = read_bounded(child.stdout.take().unwrap(), limit, overflow.clone());
    let err = read_bounded(child.stderr.take().unwrap(), 65536, overflow.clone());
    if let Some(bytes) = input {
        if let Some(mut stdin) = child.stdin.take() {
            thread::spawn(move || {
                let _ = stdin.write_all(&bytes);
            });
        }
    }
    let start = Instant::now();
    let status = loop {
        if overflow.load(Ordering::SeqCst) {
            terminate(&mut child);
            return Err(AppError::new(
                "tool_failed",
                "Tool output exceeded the safety limit.",
            ));
        }
        if start.elapsed() > timeout {
            terminate(&mut child);
            return Err(AppError::new("timeout", "Tool exceeded its time limit."));
        }
        if let Some(status) = child.try_wait()? {
            break status;
        }
        thread::sleep(Duration::from_millis(10));
    };
    let remaining = timeout.saturating_sub(start.elapsed());
    let output = out.recv_timeout(remaining);
    let errors = err.recv_timeout(timeout.saturating_sub(start.elapsed()));
    // Descendants may keep inherited pipes open after the direct child exits.
    if output.is_err() || errors.is_err() {
        terminate(&mut child);
        return Err(AppError::new(
            "timeout",
            "Tool descendants did not close their output streams.",
        ));
    }
    if overflow.load(Ordering::SeqCst) {
        return Err(AppError::new(
            "tool_failed",
            "Tool output exceeded the safety limit.",
        ));
    }
    let bytes = output.unwrap()?;
    let _ = errors.unwrap()?;
    if !status
        .code()
        .is_some_and(|code| success_codes.contains(&code))
    {
        return Err(AppError::new("tool_failed",format!("Tool exited unsuccessfully (code {}). Your buffer is preserved. Inspect the operation in your terminal.",status.code().unwrap_or(-1))));
    }
    Ok(bytes)
}
#[cfg(all(test, unix))]
mod tests {
    use super::*;
    #[test]
    fn arguments_are_not_shell_expanded() {
        let mut c = command("/usr/bin/printf");
        c.args(["%s", "$(echo unsafe); literal"]);
        assert_eq!(
            bounded(c, None, 1024, Duration::from_secs(1)).unwrap(),
            b"$(echo unsafe); literal"
        );
    }
    #[test]
    fn excessive_output_is_stopped() {
        let mut c = command("/usr/bin/yes");
        c.arg("output");
        assert_eq!(
            bounded(c, None, 128, Duration::from_secs(2))
                .unwrap_err()
                .code,
            "tool_failed"
        );
    }
    #[test]
    fn hung_tool_is_stopped() {
        let mut c = command("/bin/sleep");
        c.arg("5");
        let now = Instant::now();
        assert_eq!(
            bounded(c, None, 128, Duration::from_millis(50))
                .unwrap_err()
                .code,
            "timeout"
        );
        assert!(now.elapsed() < Duration::from_secs(2));
    }
}
