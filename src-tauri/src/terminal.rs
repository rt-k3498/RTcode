use crate::{
    domain::*,
    state::{State, TerminalSession},
};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::{
    io::{Read, Write},
    sync::{Arc, Mutex},
};
use tauri::Manager;
fn local_shell_command(shell: &str) -> CommandBuilder {
    let mut command = CommandBuilder::new(shell);
    // A new tab is an interactive session, not a new login. Re-running login
    // profiles can repeat expensive environment/tool-manager initialization.
    // Keep interactive startup files so aliases, functions and prompts work.
    if !cfg!(windows) {
        command.arg("-i");
    }
    command
}

#[tauri::command]
pub async fn terminal_create(
    app: tauri::AppHandle,
    workspace_id: String,
    alias: Option<String>,
    channel: tauri::ipc::Channel<Stream>,
) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        create_terminal(&app.state::<State>(), workspace_id, alias, channel)
    })
    .await
    .map_err(|_| AppError::new("internal", "Terminal startup worker stopped."))?
}

fn create_terminal(
    state: &State,
    workspace_id: String,
    alias: Option<String>,
    channel: tauri::ipc::Channel<Stream>,
) -> Result<String> {
    let ws = state.trusted(&workspace_id)?;
    if state.terminals.lock().unwrap().len() >= 8 {
        return Err(AppError::new("invalid_request", "Terminal limit reached."));
    }
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|_| AppError::new("tool_failed", "Could not allocate a PTY."))?;
    let mut command = if let Some(alias) = alias {
        if alias.is_empty()
            || alias.len() > 255
            || alias.starts_with('-')
            || alias.chars().any(|c| c.is_whitespace() || c.is_control())
        {
            return Err(AppError::new(
                "invalid_request",
                "Use a single SSH alias or user@host.",
            ));
        }
        let mut c = CommandBuilder::new("ssh");
        c.arg("--");
        c.arg(alias);
        c
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| {
            if cfg!(windows) {
                "powershell.exe".into()
            } else {
                "/bin/sh".into()
            }
        });
        local_shell_command(&shell)
    };
    command.cwd(&ws.root);
    command.env("TERM", "xterm-256color");
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|_| AppError::new("tool_failed", "PTY reader unavailable."))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|_| AppError::new("tool_failed", "PTY input unavailable."))?;
    let mut child = pair.slave.spawn_command(command).map_err(|_| {
        AppError::new(
            "tool_missing",
            "Shell or SSH executable could not be started.",
        )
    })?;
    drop(pair.slave);
    // Do not hold the session registry during OS process creation. Existing
    // terminals must remain writable/resizable while a new PTY is starting.
    let mut sessions = state.terminals.lock().unwrap();
    let admission = state.trusted(&workspace_id).and_then(|_| {
        if sessions.len() >= 8 {
            Err(AppError::new("invalid_request", "Terminal limit reached."))
        } else {
            Ok(())
        }
    });
    if let Err(error) = admission {
        drop(sessions);
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }
    let child = Arc::new(Mutex::new(child));
    let observed_child = child.clone();
    let terminal_id = id();
    sessions.insert(
        terminal_id.clone(),
        TerminalSession {
            workspace: workspace_id,
            master: pair.master,
            writer,
            child,
        },
    );
    drop(sessions);
    std::thread::spawn(move || {
        let mut bytes = [0u8; 16384];
        let mut sequence = 0;
        while let Ok(n) = reader.read(&mut bytes) {
            if n == 0 {
                break;
            }
            if channel
                .send(Stream {
                    sequence,
                    data: Some(bytes[..n].to_vec()),
                    exit_code: None,
                })
                .is_err()
            {
                let _ = observed_child.lock().unwrap().kill();
                break;
            }
            sequence += 1;
        }
        let _ = channel.send(Stream {
            sequence,
            data: None,
            exit_code: Some(loop {
                match observed_child.lock().unwrap().try_wait() {
                    Ok(Some(status)) => break status.exit_code(),
                    Err(_) => break 1,
                    _ => {}
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }),
        });
    });
    Ok(terminal_id)
}
#[tauri::command]
pub fn terminal_write(state: tauri::State<State>, terminal_id: String, data: String) -> Result<()> {
    if data.len() > 65536 {
        return Err(AppError::new(
            "invalid_request",
            "Terminal input exceeds batch limit.",
        ));
    }
    let mut sessions = state.terminals.lock().unwrap();
    let session = sessions
        .get_mut(&terminal_id)
        .ok_or_else(|| AppError::new("not_found", "Terminal closed."))?;
    state.trusted(&session.workspace)?;
    session.writer.write_all(data.as_bytes())?;
    session.writer.flush()?;
    Ok(())
}
#[tauri::command]
pub fn terminal_resize(
    state: tauri::State<State>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<()> {
    if cols == 0 || rows == 0 || cols > 1000 || rows > 1000 {
        return Err(AppError::new(
            "invalid_request",
            "Invalid terminal dimensions.",
        ));
    }
    let sessions = state.terminals.lock().unwrap();
    let session = sessions
        .get(&terminal_id)
        .ok_or_else(|| AppError::new("not_found", "Terminal closed."))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|_| AppError::new("tool_failed", "PTY resize failed."))
}
#[tauri::command]
pub fn terminal_close(state: tauri::State<State>, terminal_id: String) -> Result<()> {
    if let Some(session) = state.terminals.lock().unwrap().remove(&terminal_id) {
        let _ = session.child.lock().unwrap().kill();
        session
            .child
            .lock()
            .unwrap()
            .wait()
            .map_err(|_| AppError::new("tool_failed", "PTY process cleanup failed."))?;
    }
    Ok(())
}
#[tauri::command]
pub fn ssh_profiles() -> Vec<String> {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" });
    let Some(home) = home else {
        return vec![];
    };
    let path = std::path::PathBuf::from(home).join(".ssh/config");
    let Ok(config) = std::fs::read_to_string(path) else {
        return vec![];
    };
    if config.len() > 1024 * 1024 {
        return vec![];
    }
    let mut aliases = Vec::new();
    for line in config.lines() {
        let mut parts = line.split_whitespace();
        if parts
            .next()
            .map(|s| s.eq_ignore_ascii_case("host"))
            .unwrap_or(false)
        {
            for alias in parts {
                if !alias.contains(['*', '?', '!', '#']) && alias.len() < 255 {
                    aliases.push(alias.to_string());
                }
            }
        }
    }
    aliases.sort();
    aliases.dedup();
    aliases.truncate(500);
    aliases
}
#[cfg(all(test, unix))]
mod tests {
    use super::*;
    #[cfg(target_os = "macos")]
    #[test]
    fn local_shell_loads_interactive_config_without_login_profile() {
        let config = tempfile::tempdir().unwrap();
        std::fs::write(config.path().join(".zprofile"), "print LOGIN_PROFILE_RAN\n").unwrap();
        std::fs::write(
            config.path().join(".zshrc"),
            "export R_CONSOLE_STARTUP_TEST=interactive-config\n",
        )
        .unwrap();
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut command = local_shell_command("/bin/zsh");
        command.env("ZDOTDIR", config.path());
        command.env_remove("R_CONSOLE_STARTUP_TEST");
        command.args([
            "-c",
            "printf '%s' \"$R_CONSOLE_STARTUP_TEST\"; [[ -o interactive && ! -o login ]]",
        ]);
        let mut child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        let mut output = Vec::new();
        let _ = pair
            .master
            .try_clone_reader()
            .unwrap()
            .read_to_end(&mut output);
        let output = String::from_utf8_lossy(&output);
        assert!(output.contains("interactive-config"), "{output}");
        assert!(!output.contains("LOGIN_PROFILE_RAN"), "{output}");
        assert_eq!(child.wait().unwrap().exit_code(), 0);
    }

    #[test]
    fn real_pty_preserves_output_and_exit_code() {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut cmd = CommandBuilder::new("/usr/bin/printf");
        cmd.args(["%s", "pty-contract-ok"]);
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        pair.master
            .resize(PtySize {
                rows: 30,
                cols: 100,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut output = Vec::new();
        let _ = reader.read_to_end(&mut output);
        assert!(String::from_utf8_lossy(&output).contains("pty-contract-ok"));
        assert_eq!(child.wait().unwrap().exit_code(), 0);
    }
}
