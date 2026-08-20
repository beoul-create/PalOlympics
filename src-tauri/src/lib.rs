use std::fs::{self, File};
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, State, WindowEvent};
use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Activity {
    pub details: String,
    pub state: Option<String>,
    pub start_timestamp: Option<u64>,
}

pub enum IpcCommand {
    SetActivity(Activity),
    ClearActivity,
}

pub struct DiscordIpc {
    client_id: String,
    pipe: Option<File>,
    seq: u64,
}

impl DiscordIpc {
    pub fn new(client_id: String) -> Self {
        Self {
            client_id,
            pipe: None,
            seq: 0,
        }
    }

    pub fn connect(&mut self) -> Result<(), String> {
        for i in 0..10 {
            let pipe_name = format!(r"\\.\pipe\discord-ipc-{}", i);
            if let Ok(mut file) = fs::OpenOptions::new().read(true).write(true).open(&pipe_name) {
                let handshake = serde_json::json!({
                    "v": 1,
                    "client_id": self.client_id
                });
                let json_str = handshake.to_string();
                let packet = build_discord_ipc_packet(0, &json_str);

                if file.write_all(&packet).is_ok() && file.flush().is_ok() {
                    let mut header = [0u8; 8];
                    if file.read_exact(&mut header).is_ok() {
                        let len = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
                        let mut body = vec![0u8; len];
                        let _ = file.read_exact(&mut body);
                        self.pipe = Some(file);
                        return Ok(());
                    }
                }
            }
        }
        Err("Discord IPC pipe not found (Discord client may not be running)".into())
    }

    pub fn set_activity(&mut self, activity: &Activity) -> Result<(), String> {
        let file = self.pipe.as_mut().ok_or("Not connected")?;
        self.seq += 1;

        let mut act_json = serde_json::Map::new();
        act_json.insert("details".to_string(), serde_json::Value::String(activity.details.clone()));
        if let Some(ref st) = activity.state {
            act_json.insert("state".to_string(), serde_json::Value::String(st.clone()));
        }
        if let Some(ts) = activity.start_timestamp {
            let mut timestamps = serde_json::Map::new();
            timestamps.insert("start".to_string(), serde_json::Value::Number(ts.into()));
            act_json.insert("timestamps".to_string(), serde_json::Value::Object(timestamps));
        }

        let mut assets = serde_json::Map::new();
        assets.insert("large_image".to_string(), serde_json::Value::String("palworld".to_string()));
        assets.insert("large_text".to_string(), serde_json::Value::String("PalOlympics Launcher".to_string()));
        act_json.insert("assets".to_string(), serde_json::Value::Object(assets));

        let target_pid = win_process::find_game_pids()
            .first()
            .copied()
            .unwrap_or_else(std::process::id);

        let payload = serde_json::json!({
            "cmd": "SET_ACTIVITY",
            "args": {
                "pid": target_pid,
                "activity": serde_json::Value::Object(act_json)
            },
            "nonce": self.seq.to_string()
        });

        let json_str = payload.to_string();
        let packet = build_discord_ipc_packet(1, &json_str);

        file.write_all(&packet).map_err(|e| e.to_string())?;
        file.flush().map_err(|e| e.to_string())?;

        let mut header = [0u8; 8];
        if file.read_exact(&mut header).is_ok() {
            let len = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
            let mut body = vec![0u8; len];
            let _ = file.read_exact(&mut body);
        }

        Ok(())
    }

    pub fn clear_activity(&mut self) -> Result<(), String> {
        let file = self.pipe.as_mut().ok_or("Not connected")?;
        self.seq += 1;

        let target_pid = win_process::find_game_pids()
            .first()
            .copied()
            .unwrap_or_else(std::process::id);

        let payload = serde_json::json!({
            "cmd": "SET_ACTIVITY",
            "args": {
                "pid": target_pid,
                "activity": serde_json::Value::Null
            },
            "nonce": self.seq.to_string()
        });

        let json_str = payload.to_string();
        let packet = build_discord_ipc_packet(1, &json_str);

        file.write_all(&packet).map_err(|e| e.to_string())?;
        file.flush().map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub fn build_discord_ipc_packet(opcode: u32, payload_json: &str) -> Vec<u8> {
    let json_bytes = payload_json.as_bytes();
    let mut packet = Vec::with_capacity(8 + json_bytes.len());
    packet.extend_from_slice(&opcode.to_le_bytes());
    packet.extend_from_slice(&(json_bytes.len() as u32).to_le_bytes());
    packet.extend_from_slice(json_bytes);
    packet
}

fn start_discord_rpc_worker(
    client_id: String,
    start_time: u64,
    rx: Receiver<IpcCommand>,
) {
    std::thread::spawn(move || {
        let mut ipc = DiscordIpc::new(client_id);
        let mut current_activity = Activity {
            details: "PalOlympics Launcher".to_string(),
            state: Some("Browsing PalOlympics".to_string()),
            start_timestamp: Some(start_time),
        };

        loop {
            if ipc.pipe.is_none() {
                if ipc.connect().is_ok() {
                    let _ = ipc.set_activity(&current_activity);
                }
            }

            match rx.recv_timeout(Duration::from_secs(5)) {
                Ok(IpcCommand::SetActivity(act)) => {
                    current_activity = act.clone();
                    if ipc.pipe.is_some() {
                        if ipc.set_activity(&act).is_err() {
                            ipc.pipe = None;
                        }
                    }
                }
                Ok(IpcCommand::ClearActivity) => {
                    if ipc.pipe.is_some() {
                        if ipc.clear_activity().is_err() {
                            ipc.pipe = None;
                        }
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    break;
                }
            }
        }
    });
}

fn default_startup_flags() -> String {
    "-dx12".to_string()
}
fn default_server_address() -> String {
    "beoul.duckdns.org:8211".to_string()
}
fn default_server_password() -> String {
    "0331BAZEEY".to_string()
}
fn default_true() -> bool {
    true
}
fn default_backup_dir() -> String {
    let appdata = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:\\Users\\Public".to_string());
    format!(r"{}\PalOlympicsLauncher\Backups", appdata)
}
fn default_save_path() -> String {
    let appdata = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:\\Users\\Public".to_string());
    format!(r"{}\Pal\Saved\SaveGames", appdata)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherConfig {
    #[serde(default)]
    pub game_path: String,
    #[serde(default = "default_startup_flags")]
    pub startup_flags: String,
    #[serde(default = "default_server_address")]
    pub server_address: String,
    #[serde(default = "default_server_password")]
    pub server_password: String,
    #[serde(default = "default_true")]
    pub auto_connect: bool,
    #[serde(default = "default_true")]
    pub minimize_to_tray: bool,
    #[serde(default)]
    pub close_on_game_launch: bool,
    #[serde(default = "default_true")]
    pub hardware_acceleration: bool,
    #[serde(default)]
    pub disable_animations: bool,
    #[serde(default = "default_true")]
    pub auto_process_priority: bool,
    #[serde(default)]
    pub auto_launch: bool,
    #[serde(default)]
    pub auto_update_modpack: bool,
    #[serde(default = "default_backup_dir")]
    pub save_backup_directory: String,
    #[serde(default = "default_save_path")]
    pub custom_save_path: String,
    #[serde(default = "default_true")]
    pub optimize_engine_ini: bool,
    #[serde(default)]
    pub custom_background_path: String,
    #[serde(default)]
    pub custom_audio_path: String,
    #[serde(default = "default_accent")]
    pub theme_accent: String,
    #[serde(default)]
    pub bg_dim_opacity: f32,
    #[serde(default)]
    pub bg_blur_radius: f32,
}

fn default_accent() -> String {
    "cyan".to_string()
}

impl Default for LauncherConfig {
    fn default() -> Self {
        Self {
            game_path: String::new(),
            startup_flags: default_startup_flags(),
            server_address: default_server_address(),
            server_password: default_server_password(),
            auto_connect: true,
            minimize_to_tray: true,
            close_on_game_launch: false,
            hardware_acceleration: true,
            disable_animations: false,
            auto_process_priority: true,
            auto_launch: false,
            auto_update_modpack: false,
            save_backup_directory: default_backup_dir(),
            custom_save_path: default_save_path(),
            optimize_engine_ini: true,
            custom_background_path: String::new(),
            custom_audio_path: String::new(),
            theme_accent: "cyan".to_string(),
            bg_dim_opacity: 0.0,
            bg_blur_radius: 0.0,
        }
    }
}

pub fn get_config_dir() -> PathBuf {
    let local_appdata = std::env::var("LOCALAPPDATA")
        .unwrap_or_else(|_| "C:\\Users\\Public".to_string());
    PathBuf::from(local_appdata).join("PalOlympicsLauncher")
}

pub fn get_config_path() -> PathBuf {
    get_config_dir().join("config.json")
}

pub fn load_config() -> LauncherConfig {
    let path = get_config_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(cfg) = serde_json::from_str::<LauncherConfig>(&content) {
                return cfg;
            }
        }
    }
    LauncherConfig::default()
}

pub fn save_config(config: &LauncherConfig) -> Result<(), String> {
    let dir = get_config_dir();
    let _ = fs::create_dir_all(&dir);
    let path = get_config_path();
    let json_data = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;
    fs::write(&path, json_data)
        .map_err(|e| format!("Failed to write config file to {:?}: {e}", path))?;
    Ok(())
}

#[cfg(windows)]
mod win_process {
    use std::ffi::c_void;
    type HANDLE = *mut c_void;
    type DWORD = u32;
    type BOOL = i32;

    const PROCESS_SET_INFORMATION: DWORD = 0x0200;
    const PROCESS_QUERY_INFORMATION: DWORD = 0x0400;
    const HIGH_PRIORITY_CLASS: DWORD = 0x00000080;
    const TH32CS_SNAPPROCESS: DWORD = 0x00000002;
    const INVALID_HANDLE_VALUE: HANDLE = -1isize as HANDLE;

    #[repr(C)]
    #[allow(non_snake_case)]
    struct PROCESSENTRY32W {
        dwSize: DWORD,
        cntUsage: DWORD,
        th32ProcessID: DWORD,
        th32DefaultHeapID: usize,
        th32ModuleID: DWORD,
        cntThreads: DWORD,
        th32ParentProcessID: DWORD,
        pcPriClassBase: i32,
        dwFlags: DWORD,
        szExeFile: [u16; 260],
    }

    extern "system" {
        fn CreateToolhelp32Snapshot(dwFlags: DWORD, th32ProcessID: DWORD) -> HANDLE;
        fn Process32FirstW(hSnapshot: HANDLE, lppe: *mut PROCESSENTRY32W) -> BOOL;
        fn Process32NextW(hSnapshot: HANDLE, lppe: *mut PROCESSENTRY32W) -> BOOL;
        fn OpenProcess(dwDesiredAccess: DWORD, bInheritHandle: BOOL, dwProcessId: DWORD) -> HANDLE;
        fn SetPriorityClass(hProcess: HANDLE, dwPriorityClass: DWORD) -> BOOL;
        fn CloseHandle(hObject: HANDLE) -> BOOL;
    }

    pub fn find_game_pids() -> Vec<u32> {
        let mut pids = Vec::new();
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot == INVALID_HANDLE_VALUE {
                return pids;
            }

            let mut entry = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as DWORD,
                cntUsage: 0,
                th32ProcessID: 0,
                th32DefaultHeapID: 0,
                th32ModuleID: 0,
                cntThreads: 0,
                th32ParentProcessID: 0,
                pcPriClassBase: 0,
                dwFlags: 0,
                szExeFile: [0; 260],
            };

            if Process32FirstW(snapshot, &mut entry) != 0 {
                loop {
                    let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                    let exe_name = String::from_utf16_lossy(&entry.szExeFile[..len]).to_lowercase();

                    if exe_name == "palworld-win64-shipping.exe"
                        || exe_name == "palworld.exe"
                        || exe_name == "pal.exe"
                    {
                        pids.push(entry.th32ProcessID);
                    }

                    if Process32NextW(snapshot, &mut entry) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snapshot);
        }
        pids
    }

    pub fn find_server_pids() -> Vec<u32> {
        let mut pids = Vec::new();
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot == INVALID_HANDLE_VALUE {
                return pids;
            }

            let mut entry = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as DWORD,
                cntUsage: 0,
                th32ProcessID: 0,
                th32DefaultHeapID: 0,
                th32ModuleID: 0,
                cntThreads: 0,
                th32ParentProcessID: 0,
                pcPriClassBase: 0,
                dwFlags: 0,
                szExeFile: [0; 260],
            };

            if Process32FirstW(snapshot, &mut entry) != 0 {
                loop {
                    let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                    let exe_name = String::from_utf16_lossy(&entry.szExeFile[..len]).to_lowercase();

                    if exe_name == "palserver-win64-shipping-cmd.exe"
                        || exe_name == "palserver-win64-shipping.exe"
                        || exe_name == "palserver.exe"
                    {
                        pids.push(entry.th32ProcessID);
                    }

                    if Process32NextW(snapshot, &mut entry) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snapshot);
        }
        pids
    }

    pub fn set_process_priority_high(pid: u32) -> Result<(), String> {
        unsafe {
            let handle = OpenProcess(PROCESS_SET_INFORMATION | PROCESS_QUERY_INFORMATION, 0, pid);
            if handle.is_null() {
                return Err(format!("Failed to open process PID {}", pid));
            }
            let success = SetPriorityClass(handle, HIGH_PRIORITY_CLASS);
            CloseHandle(handle);
            if success != 0 {
                Ok(())
            } else {
                Err(format!("SetPriorityClass returned 0 for PID {}", pid))
            }
        }
    }
}

#[cfg(not(windows))]
mod win_process {
    pub fn find_game_pids() -> Vec<u32> { Vec::new() }
    pub fn find_server_pids() -> Vec<u32> { Vec::new() }
    pub fn set_process_priority_high(_pid: u32) -> Result<(), String> { Ok(()) }
}



#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaintenanceReport {
    pub files_removed: usize,
    pub bytes_freed: u64,
    pub summary: String,
}

#[tauri::command]
fn run_system_maintenance() -> Result<MaintenanceReport, String> {
    let mut files_removed = 0;
    let mut bytes_freed = 0;

    let local_appdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let appdata = std::env::var("APPDATA").unwrap_or_default();

    let mut target_dirs = Vec::new();

    if !local_appdata.is_empty() {
        // Palworld crash dumps & logs
        target_dirs.push(PathBuf::from(&local_appdata).join("Pal").join("Saved").join("Crashes"));
        target_dirs.push(PathBuf::from(&local_appdata).join("Pal").join("Saved").join("Logs"));
        // DirectX & GPU Shader Cache (NVIDIA, AMD, Intel, DirectX D3DSCache)
        target_dirs.push(PathBuf::from(&local_appdata).join("D3DSCache"));
        target_dirs.push(PathBuf::from(&local_appdata).join("NVIDIA").join("DXCache"));
        target_dirs.push(PathBuf::from(&local_appdata).join("NVIDIA").join("GLCache"));
        target_dirs.push(PathBuf::from(&local_appdata).join("AMD").join("DxCache"));
        target_dirs.push(PathBuf::from(&local_appdata).join("Intel").join("ShaderCache"));
    }

    if !appdata.is_empty() {
        // Minecraft temporary logs & crash reports
        target_dirs.push(PathBuf::from(&appdata).join(".minecraft").join("logs"));
        target_dirs.push(PathBuf::from(&appdata).join(".minecraft").join("crash-reports"));
    }

    let config = load_config();
    if !config.game_path.is_empty() {
        let ue4ss_log = PathBuf::from(&config.game_path)
            .join("Pal")
            .join("Binaries")
            .join("Win64")
            .join("ue4ss")
            .join("UE4SS.log");
        if ue4ss_log.is_file() {
            if let Ok(meta) = fs::metadata(&ue4ss_log) {
                let size = meta.len();
                if fs::remove_file(&ue4ss_log).is_ok() {
                    files_removed += 1;
                    bytes_freed += size;
                }
            }
        }
    }

    for dir in target_dirs {
        if dir.exists() && dir.is_dir() {
            if let Ok(entries) = fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        if let Ok(meta) = fs::metadata(&path) {
                            let size = meta.len();
                            if fs::remove_file(&path).is_ok() {
                                files_removed += 1;
                                bytes_freed += size;
                            }
                        }
                    } else if path.is_dir() {
                        let size = get_dir_size(&path);
                        if fs::remove_dir_all(&path).is_ok() {
                            files_removed += 1;
                            bytes_freed += size;
                        }
                    }
                }
            }
        }
    }

    let mb_freed = (bytes_freed as f64) / (1024.0 * 1024.0);
    Ok(MaintenanceReport {
        files_removed,
        bytes_freed,
        summary: format!("Cleaned {} temporary files & logs ({:.2} MB freed)", files_removed, mb_freed),
    })
}

fn get_dir_size(path: &Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                if let Ok(m) = fs::metadata(&p) {
                    total += m.len();
                }
            } else if p.is_dir() {
                total += get_dir_size(&p);
            }
        }
    }
    total
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupResult {
    pub file_path: String,
    pub file_name: String,
    pub file_size_bytes: u64,
    pub files_archived: usize,
}

#[tauri::command]
fn backup_save_files(
    custom_save_dir: Option<String>,
    target_backup_dir: Option<String>,
) -> Result<BackupResult, String> {
    let local_appdata = std::env::var("LOCALAPPDATA").unwrap_or_default();

    let source_dir = if let Some(custom) = custom_save_dir.filter(|s| !s.trim().is_empty()) {
        PathBuf::from(custom)
    } else {
        PathBuf::from(&local_appdata).join("Pal").join("Saved").join("SaveGames")
    };

    if !source_dir.exists() {
        return Err(format!("Save directory not found: {}", source_dir.display()));
    }

    let backup_dir = if let Some(custom_bak) = target_backup_dir.filter(|s| !s.trim().is_empty()) {
        PathBuf::from(custom_bak)
    } else {
        get_config_dir().join("Backups")
    };

    let _ = fs::create_dir_all(&backup_dir);

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let zip_name = format!("PalSave_Backup_{}.zip", timestamp);
    let zip_path = backup_dir.join(&zip_name);

    let zip_file = File::create(&zip_path)
        .map_err(|e| format!("Failed to create zip file {:?}: {e}", zip_path))?;

    let mut zip_writer = zip::ZipWriter::new(zip_file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o755);

    let mut files_archived = 0;
    add_dir_to_zip(&mut zip_writer, &source_dir, &source_dir, &options, &mut files_archived)?;

    zip_writer
        .finish()
        .map_err(|e| format!("Failed to finalize zip archive: {e}"))?;

    let meta = fs::metadata(&zip_path)
        .map_err(|e| format!("Failed to get backup metadata: {e}"))?;

    Ok(BackupResult {
        file_path: zip_path.to_string_lossy().into_owned(),
        file_name: zip_name,
        file_size_bytes: meta.len(),
        files_archived,
    })
}

fn add_dir_to_zip<W: Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    base_dir: &Path,
    current_dir: &Path,
    options: &zip::write::SimpleFileOptions,
    count: &mut usize,
) -> Result<(), String> {
    if let Ok(entries) = fs::read_dir(current_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let relative_path = path.strip_prefix(base_dir).unwrap_or(&path);
            let name_str = relative_path.to_string_lossy().replace('\\', "/");

            if path.is_file() {
                zip.start_file(name_str, *options)
                    .map_err(|e| format!("Failed to add file to zip: {e}"))?;
                let mut f = File::open(&path)
                    .map_err(|e| format!("Failed to read file {:?}: {e}", path))?;
                let mut buffer = Vec::new();
                f.read_to_end(&mut buffer)
                    .map_err(|e| format!("Failed to read data from {:?}: {e}", path))?;
                zip.write_all(&buffer)
                    .map_err(|e| format!("Failed to write data to zip: {e}"))?;
                *count += 1;
            } else if path.is_dir() {
                if !name_str.is_empty() {
                    let dir_name = if name_str.ends_with('/') {
                        name_str
                    } else {
                        format!("{}/", name_str)
                    };
                    zip.add_directory(dir_name, *options)
                        .map_err(|e| format!("Failed to add directory to zip: {e}"))?;
                }
                add_dir_to_zip(zip, base_dir, &path, options, count)?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn open_backup_folder(target_backup_dir: Option<String>) -> Result<(), String> {
    let backup_dir = if let Some(custom) = target_backup_dir.filter(|s| !s.trim().is_empty()) {
        PathBuf::from(custom)
    } else {
        get_config_dir().join("Backups")
    };
    let _ = fs::create_dir_all(&backup_dir);
    let _ = open_browser(&backup_dir.to_string_lossy());
    Ok(())
}

fn build_engine_ini_optimization_string(
    pool_size_mb: u32,
    gc_time_secs: u32,
    async_time_ms: u32,
    enable_d3d12_async: bool,
) -> String {
    let d3d12_section = if enable_d3d12_async {
        "D3D12.UseAsyncCompute=1\nD3D12.AllowMultiEngine=1\n"
    } else {
        ""
    };

    format!(
        "\n[/Script/Engine.Engine]\nbSmoothFrameRate=False\n\n[SystemSettings]\n{d3d12_section}r.Streaming.PoolSize={pool_size_mb}\nr.Streaming.LimitPoolSizeToVRAM=1\nr.Streaming.HLODStrategy=2\nr.Streaming.Boost=1\nr.Streaming.FramesForFullUpdate=1\nr.Streaming.AmortizeCPUToGPUCopy=1\nr.Streaming.DefragDynamicBounds=1\nr.Streaming.CheckResourcesWithMissingMesh=0\nr.Streaming.MaxEffectiveScreenSize=0\nr.Streaming.MaxNumTexturesToStreamPerCycle=6\nr.Streaming.MipBias=0\nr.MaxAnisotropy=16\nr.TextureStreaming=1\nr.bForceCPUAccessToGPUBuffer=0\nr.CreateShadersOnLoad=0\nr.Shaders.Optimize=1\nr.ShaderPipelineCache.BatchTime=1.0\nr.ShaderPipelineCache.BackgroundBatchTime=0.5\nr.ShaderPipelineCache.SaveAfterInitialLoad=1\nr.ShaderPipelineCache.PreCompile=1\nr.VolumetricFog=1\nr.VolumetricFog.GridPixelSize=16\nr.VolumetricFog.GridSizeZ=64\nr.VolumetricCloud=1\nr.VolumetricCloud.ViewRaySampleCountScale=0.5\nr.VolumetricCloud.Shadow.ViewRaySampleCountScale=0.5\nr.Shadow.Virtual.Enable=0\nr.Shadow.CSM.MaxCascades=3\nr.Shadow.MaxResolution=2048\nr.MotionBlurQuality=0\nr.DepthOfFieldQuality=0\nr.SceneColorFmt=6\nr.Tonemapper.GrainQuantization=0\nr.Tonemapper.Sharpen=0.8\nr.OneFrameThreadLag=1\nr.ParallelMeshDispatch=1\na.URO.ForceAnimRate=1\nfx.Niagara.AllowAsyncTick=1\nau.DisableSeamlessLooping=0\ngc.IncrementalBeginDestroyEnabled=True\ngc.CreateGCClusters=True\ngc.NumRetriesBeforeForcingGC=10\ngc.MinDesiredObjectsPerSubTask=20\ngc.TimeBetweenPurgingPendingKillObjects={gc_time_secs}\ns.AsyncLoadingThreadEnabled=True\ns.AsyncLoadingTime={async_time_ms}\ns.AsyncLoadingUseFullTimeLimit=0\ns.PriorityAsyncLoadingExtraTime=25.0\ns.LevelStreamingActorsUpdateTimeLimit=10.0\ns.PriorityLevelStreamingActorsUpdateExtraTime=10.0\ns.UnregisterComponentsTimeLimit=1.0\nSlate.bAllowThrottling=0\nSlate.SleepBufferTarget=0\nSlate.EnableSlatePostBuffers=0\nr.FastBlurThreshold=0\n"
    )
}

#[tauri::command]
fn apply_engine_optimizations(enabled: bool) -> Result<String, String> {
    let local_appdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
    if local_appdata.is_empty() {
        return Err("LOCALAPPDATA environment variable not found".into());
    }

    let config_dir = PathBuf::from(&local_appdata)
        .join("Pal")
        .join("Saved")
        .join("Config")
        .join("Windows");
    let _ = fs::create_dir_all(&config_dir);

    let engine_ini_path = config_dir.join("Engine.ini");
    let mut content = if engine_ini_path.exists() {
        fs::read_to_string(&engine_ini_path).unwrap_or_default()
    } else {
        String::new()
    };

    if enabled {
        if let Some(pos) = content.find("[/Script/Engine.Engine]") {
            content.truncate(pos);
        }
        let opt_section = build_engine_ini_optimization_string(4096, 90, 20, true);
        content.push_str(&opt_section);
        fs::write(&engine_ini_path, &content).map_err(|e| format!("Failed to write Engine.ini: {e}"))?;
        Ok("Engine.ini high-performance tuning (Async Compute, 4GB Texture Pool, Incremental GC, Volumetric Optimization) applied successfully.".into())
    } else {
        if let Some(pos) = content.find("[/Script/Engine.Engine]") {
            content.truncate(pos);
            let _ = fs::write(&engine_ini_path, &content);
        }
        Ok("Engine optimizations reset to default.".into())
    }
}

#[tauri::command]
fn reset_engine_ini() -> Result<String, String> {
    let local_appdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
    if local_appdata.is_empty() {
        return Err("LOCALAPPDATA environment variable not found".into());
    }

    let config_dir = PathBuf::from(&local_appdata)
        .join("Pal")
        .join("Saved")
        .join("Config")
        .join("Windows");

    let engine_ini_path = config_dir.join("Engine.ini");
    if engine_ini_path.exists() {
        let mut content = fs::read_to_string(&engine_ini_path).unwrap_or_default();
        if let Some(pos) = content.find("[/Script/Engine.Engine]") {
            content.truncate(pos);
            fs::write(&engine_ini_path, content.trim_end()).map_err(|e| format!("Failed to write Engine.ini: {e}"))?;
        }
    }

    Ok("Engine.ini reverted to default configuration.".into())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalibrationResult {
    pub tier: String,
    pub tier_badge: String,
    pub cpu_name: String,
    pub cpu_threads: u32,
    pub ram_gb: f64,
    pub gpu_name: String,
    pub recommended_flags: String,
    pub recommended_pool_mb: u32,
    pub summary: String,
}

#[tauri::command]
fn calibrate_hardware_profile() -> Result<CalibrationResult, String> {
    let cpu_threads = std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(4);

    let mut cpu_name = "Multi-Core Processor".to_string();
    let mut gpu_name = "DirectX 12 Compatible GPU".to_string();
    let mut ram_gb = 16.0f64;

    #[cfg(windows)]
    {
        // Query CPU Name from Registry
        if let Ok(output) = std::process::Command::new("reg")
            .args(&["query", "HKLM\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0", "/v", "ProcessorNameString"])
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                if line.contains("ProcessorNameString") {
                    if let Some(pos) = line.find("REG_SZ") {
                        let name = line[pos + 6..].trim();
                        if !name.is_empty() {
                            cpu_name = name.to_string();
                        }
                    }
                }
            }
        }

        // Query GPU Name from Registry across subkeys 0000 through 0003, prioritizing dedicated GPUs
        for subkey in &["0000", "0001", "0002", "0003"] {
            let reg_path = format!(r"HKLM\SYSTEM\CurrentControlSet\Control\Class\{{4d36e968-e325-11ce-bfc1-08002be10318}}\{}", subkey);
            if let Ok(output) = std::process::Command::new("reg")
                .args(&["query", &reg_path, "/v", "DriverDesc"])
                .output()
            {
                let text = String::from_utf8_lossy(&output.stdout);
                for line in text.lines() {
                    if line.contains("DriverDesc") {
                        if let Some(pos) = line.find("REG_SZ") {
                            let name = line[pos + 6..].trim();
                            if !name.is_empty() {
                                let lower = name.to_lowercase();
                                if lower.contains("nvidia") || lower.contains("geforce") || lower.contains("rtx") || lower.contains("radeon rx") || lower.contains("arc") {
                                    gpu_name = name.to_string();
                                    break;
                                } else if gpu_name == "DirectX 12 Compatible GPU" {
                                    gpu_name = name.to_string();
                                }
                            }
                        }
                    }
                }
            }
        }

        // Query Physical Memory
        #[repr(C)]
        struct MEMSTATUS {
            dw_length: u32,
            dw_memory_load: u32,
            ull_total_phys: u64,
            ull_avail_phys: u64,
            ull_total_page_file: u64,
            ull_avail_page_file: u64,
            ull_total_virtual: u64,
            ull_avail_virtual: u64,
            ull_avail_extended_virtual: u64,
        }
        extern "system" {
            fn GlobalMemoryStatusEx(lp_buffer: *mut MEMSTATUS) -> i32;
        }

        unsafe {
            let mut status = MEMSTATUS {
                dw_length: std::mem::size_of::<MEMSTATUS>() as u32,
                dw_memory_load: 0,
                ull_total_phys: 0,
                ull_avail_phys: 0,
                ull_total_page_file: 0,
                ull_avail_page_file: 0,
                ull_total_virtual: 0,
                ull_avail_virtual: 0,
                ull_avail_extended_virtual: 0,
            };
            if GlobalMemoryStatusEx(&mut status) != 0 {
                ram_gb = (status.ull_total_phys as f64 / (1024.0 * 1024.0 * 1024.0) * 10.0).round() / 10.0;
            }
        }
    }

    let is_nvidia = gpu_name.to_lowercase().contains("nvidia") || gpu_name.to_lowercase().contains("geforce") || gpu_name.to_lowercase().contains("rtx") || gpu_name.to_lowercase().contains("gtx");
    let is_high_end_gpu = gpu_name.contains("40") || gpu_name.contains("30") || gpu_name.contains("7900") || gpu_name.contains("7800") || gpu_name.contains("6800");

    let (tier, tier_badge, recommended_flags, recommended_pool_mb, summary) = if ram_gb >= 24.0 && cpu_threads >= 12 && (is_high_end_gpu || is_nvidia) {
        (
            "Ultra Enthusiast Profile".to_string(),
            "ULTRA TIER".to_string(),
            "-dx12 -USEALLAVAILABLECORES -useperfthreads -NoVerifyGC -NOSPLASH".to_string(),
            4096,
            "Calibrated for high-end multi-threaded hardware. Unlocks a 4GB texture streaming budget, DirectX 12 Async Compute, P-Core thread allocation, and non-blocking incremental GC.".to_string(),
        )
    } else if ram_gb >= 15.0 && cpu_threads >= 8 {
        (
            "High Performance Gaming Profile".to_string(),
            "HIGH TIER".to_string(),
            "-dx12 -USEALLAVAILABLECORES -useperfthreads -NoVerifyGC -NOSPLASH".to_string(),
            3072,
            "Balanced for modern gaming PCs. 3GB texture streaming pool with D3D12 Async Compute, GC verification bypass, and 8+ thread distribution.".to_string(),
        )
    } else if ram_gb >= 8.0 && cpu_threads >= 4 {
        (
            "Balanced Mainstream Profile".to_string(),
            "MAINSTREAM TIER".to_string(),
            "-dx12 -USEALLAVAILABLECORES -nomansky -NoVerifyGC -NOSPLASH".to_string(),
            2048,
            "Optimized for smooth framerates on mainstream systems. Disables background sky overhead, allocates 2GB streaming cache, and scales volumetric raymarching.".to_string(),
        )
    } else {
        (
            "Maximum Efficiency & Low-Memory Profile".to_string(),
            "EFFICIENCY TIER".to_string(),
            "-dx11 -USEALLAVAILABLECORES -nomansky -lowmemory -NOSPLASH".to_string(),
            1024,
            "Lightweight low-footprint mode. Forces DirectX 11, aggressive 45s RAM cleanups, and 1GB texture pool to eliminate micro-stutters.".to_string(),
        )
    };

    Ok(CalibrationResult {
        tier,
        tier_badge,
        cpu_name,
        cpu_threads,
        ram_gb,
        gpu_name,
        recommended_flags,
        recommended_pool_mb,
        summary,
    })
}

#[tauri::command]
fn apply_calibrated_profile(profile: CalibrationResult) -> Result<String, String> {
    let local_appdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
    if local_appdata.is_empty() {
        return Err("LOCALAPPDATA environment variable not found".into());
    }

    let config_dir = PathBuf::from(&local_appdata)
        .join("Pal")
        .join("Saved")
        .join("Config")
        .join("Windows");
    let _ = fs::create_dir_all(&config_dir);

    let engine_ini_path = config_dir.join("Engine.ini");
    let mut content = if engine_ini_path.exists() {
        fs::read_to_string(&engine_ini_path).unwrap_or_default()
    } else {
        String::new()
    };

    if let Some(pos) = content.find("[/Script/Engine.Engine]") {
        content.truncate(pos);
    }

    let pool_size = profile.recommended_pool_mb;
    let gc_time = if pool_size >= 4096 { 120 } else if pool_size >= 3072 { 90 } else if pool_size >= 2048 { 60 } else { 45 };
    let async_time = if pool_size >= 4096 { 20 } else if pool_size >= 3072 { 15 } else if pool_size >= 2048 { 10 } else { 5 };
    let enable_async_compute = pool_size >= 2048;

    let opt_section = build_engine_ini_optimization_string(pool_size, gc_time, async_time, enable_async_compute);

    content.push_str(&opt_section);
    fs::write(&engine_ini_path, &content).map_err(|e| format!("Failed to write Engine.ini: {e}"))?;

    Ok(format!("Successfully applied {} ({}MB Pool, Async Compute, Incremental GC) to Engine.ini!", profile.tier, pool_size))
}

struct LauncherState {
    minimize_to_tray: AtomicBool,
    auto_process_priority: std::sync::Arc<AtomicBool>,
    close_on_game_launch: std::sync::Arc<AtomicBool>,
    discord_presence_tx: Mutex<Option<Sender<IpcCommand>>>,
    start_time: u64,
}

impl LauncherState {
    pub fn update_presence(&self, details: &str, state: Option<&str>) {
        if let Ok(guard) = self.discord_presence_tx.lock() {
            if let Some(ref tx) = *guard {
                let _ = tx.send(IpcCommand::SetActivity(Activity {
                    details: details.to_string(),
                    state: state.map(|s| s.to_string()),
                    start_timestamp: Some(self.start_time),
                }));
            }
        }
    }
}

#[tauri::command]
fn get_launcher_config() -> LauncherConfig {
    load_config()
}

#[tauri::command]
fn update_launcher_config(config: LauncherConfig, state: State<'_, LauncherState>) -> Result<(), String> {
    state.minimize_to_tray.store(config.minimize_to_tray, Ordering::Relaxed);
    state.auto_process_priority.store(config.auto_process_priority, Ordering::Relaxed);
    state.close_on_game_launch.store(config.close_on_game_launch, Ordering::Relaxed);
    save_config(&config)?;
    Ok(())
}

#[tauri::command]
fn set_auto_process_priority(enabled: bool, state: State<'_, LauncherState>) {
    state.auto_process_priority.store(enabled, Ordering::Relaxed);
    let mut cfg = load_config();
    cfg.auto_process_priority = enabled;
    let _ = save_config(&cfg);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerInfo {
    pub name: String,
    pub level: u32,
    pub ping: u32,
    pub player_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerStatusInfo {
    pub online: bool,
    pub server_name: String,
    pub address: String,
    pub ping_ms: u32,
    pub player_count: u32,
    pub max_players: u32,
    pub uptime_seconds: u64,
    pub next_restart_seconds: Option<u64>,
    pub version: String,
    pub players: Vec<PlayerInfo>,
}

#[tauri::command]
async fn query_server_status(server_address: String, password: Option<String>) -> Result<ServerStatusInfo, String> {
    let clean_addr = server_address.trim();
    let parts: Vec<&str> = clean_addr.split(':').collect();
    let host = if !parts.is_empty() && !parts[0].is_empty() { parts[0] } else { "beoul.duckdns.org" };
    let game_port: u16 = parts.get(1).and_then(|p| p.parse().ok()).unwrap_or(8211);

    let is_local_server_running = !win_process::find_server_pids().is_empty();

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(1200))
        .build()
        .map_err(|e| e.to_string())?;

    let target_hosts = if is_local_server_running {
        vec!["127.0.0.1", "localhost", host]
    } else {
        vec![host, "127.0.0.1", "localhost"]
    };

    let rest_ports = [8212, game_port, 8211];

    let mut found_rest = false;
    let mut server_name = "PalOlympics Dedicated Server".to_string();
    let mut server_version = "v1.0.3.x".to_string();
    let mut uptime_seconds = 0u64;
    let mut players = Vec::new();
    let mut ping_ms = 0u32;
    let mut max_players = 32u32;

    let auth_passes = [
        "0012",
        password.as_deref().unwrap_or("").trim(),
        "0331BAZEEY",
        "",
    ];

    let start_instant = Instant::now();

    'host_loop: for &t_host in &target_hosts {
        for &r_port in &rest_ports {
            for &auth_pass in &auth_passes {
                let url_info = format!("http://{}:{}/v1/api/info", t_host, r_port);
                let mut req = client.get(&url_info);
                if !auth_pass.is_empty() {
                    req = req.basic_auth("admin", Some(auth_pass));
                }

                if let Ok(res) = req.send().await {
                    let status_code = res.status();
                    if status_code.is_success() {
                        let elapsed = start_instant.elapsed().as_millis() as u32;
                        ping_ms = if t_host == "127.0.0.1" || t_host == "localhost" { 5 } else { elapsed.max(12) };
                        if let Ok(json) = res.json::<serde_json::Value>().await {
                            found_rest = true;
                            if let Some(sname) = json.get("servername").and_then(|v| v.as_str()) {
                                server_name = sname.to_string();
                            }
                            if let Some(ver) = json.get("version").and_then(|v| v.as_str()) {
                                server_version = ver.to_string();
                            }
                        }

                        // Query Players
                        let url_players = format!("http://{}:{}/v1/api/players", t_host, r_port);
                        let mut req_p = client.get(&url_players);
                        if !auth_pass.is_empty() {
                            req_p = req_p.basic_auth("admin", Some(auth_pass));
                        }
                        if let Ok(res_p) = req_p.send().await {
                            if res_p.status().is_success() {
                                if let Ok(json_p) = res_p.json::<serde_json::Value>().await {
                                    let raw_players = if let Some(arr) = json_p.as_array() {
                                        Some(arr)
                                    } else if let Some(arr) = json_p.get("players").and_then(|v| v.as_array()) {
                                        Some(arr)
                                    } else if let Some(arr) = json_p.get("value").and_then(|v| v.as_array()) {
                                        Some(arr)
                                    } else if let Some(arr) = json_p.get("value").and_then(|v| v.get("players")).and_then(|v| v.as_array()) {
                                        Some(arr)
                                    } else {
                                        None
                                    };

                                    if let Some(arr) = raw_players {
                                        for p in arr {
                                            let name = p.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                            if name.is_empty() || name.to_lowercase() == "name" {
                                                continue;
                                            }
                                            let level = p.get("level").and_then(|v| v.as_u64()).unwrap_or(1) as u32;
                                            let p_ping = p.get("ping").and_then(|v| v.as_f64()).unwrap_or(ping_ms as f64) as u32;
                                            let player_id = p.get("userId")
                                                .or_else(|| p.get("playerId"))
                                                .or_else(|| p.get("player_id"))
                                                .or_else(|| p.get("user_id"))
                                                .and_then(|v| v.as_str())
                                                .unwrap_or(&name)
                                                .to_string();

                                            players.push(PlayerInfo {
                                                name,
                                                level,
                                                ping: p_ping,
                                                player_id,
                                            });
                                        }
                                    }
                                }
                            }
                        }

                        // Query Metrics
                        let url_metrics = format!("http://{}:{}/v1/api/metrics", t_host, r_port);
                        let mut req_m = client.get(&url_metrics);
                        if !auth_pass.is_empty() {
                            req_m = req_m.basic_auth("admin", Some(auth_pass));
                        }
                        if let Ok(res_m) = req_m.send().await {
                            if res_m.status().is_success() {
                                if let Ok(json_m) = res_m.json::<serde_json::Value>().await {
                                    if let Some(up) = json_m.get("uptime").and_then(|v| v.as_u64()) {
                                        uptime_seconds = up;
                                    }
                                    if let Some(max_p) = json_m.get("maxplayernum").and_then(|v| v.as_u64()) {
                                        max_players = max_p as u32;
                                    }
                                }
                            }
                        }

                        break 'host_loop;
                    } else if status_code != reqwest::StatusCode::UNAUTHORIZED {
                        // Port replied with non-401 (e.g. 404, 500, etc.), do not retry passwords on this port
                        break;
                    }
                } else {
                    // Connection failed or timed out on this host:port, skip remaining passwords for this port
                    break;
                }
            }
        }
    }

    let is_online = found_rest || is_local_server_running;
    if is_online && ping_ms == 0 {
        ping_ms = if is_local_server_running { 5 } else { 24 };
    }

    let player_count = players.len() as u32;
    let next_restart_seconds = if uptime_seconds > 0 {
        let cycle_seconds = 14400u64; // 4 hours from SCHEDULED_RESTART_HOURS
        Some(cycle_seconds - (uptime_seconds % cycle_seconds))
    } else {
        Some(14400)
    };

    Ok(ServerStatusInfo {
        online: is_online,
        server_name,
        address: if !clean_addr.is_empty() { clean_addr.to_string() } else { "beoul.duckdns.org:8211".to_string() },
        ping_ms: if is_online { ping_ms } else { 0 },
        player_count,
        max_players,
        uptime_seconds,
        next_restart_seconds,
        version: server_version,
        players,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCheckResult {
    pub should_update: bool,
    pub current_version: String,
    pub version: Option<String>,
    pub date: Option<String>,
    pub body: Option<String>,
}

#[tauri::command]
async fn check_for_launcher_updates(app: tauri::AppHandle) -> Result<UpdateCheckResult, String> {
    let current_version = app.package_info().version.to_string();

    // Check through tauri-plugin-updater
    if let Ok(updater) = app.updater() {
        if let Ok(Some(update)) = updater.check().await {
            return Ok(UpdateCheckResult {
                should_update: true,
                current_version,
                version: Some(update.version),
                date: update.date.map(|d| d.to_string()),
                body: update.body,
            });
        }
    }

    // Direct GitHub release fallback check
    let client = reqwest::Client::new();
    let res = client
        .get("https://api.github.com/repos/beoul-create/palolympics-launcher/releases/latest")
        .header("User-Agent", "PalOlympics-Launcher")
        .send()
        .await;

    if let Ok(response) = res {
        if response.status().is_success() {
            if let Ok(json) = response.json::<serde_json::Value>().await {
                if let Some(tag) = json.get("tag_name").and_then(|t| t.as_str()) {
                    let remote_ver = tag.trim_start_matches('v').trim();
                    if remote_ver != current_version && !remote_ver.is_empty() {
                        let body = json.get("body").and_then(|b| b.as_str()).map(|s| s.to_string());
                        let date = json.get("published_at").and_then(|d| d.as_str()).map(|s| s.to_string());
                        return Ok(UpdateCheckResult {
                            should_update: true,
                            current_version,
                            version: Some(remote_ver.to_string()),
                            date,
                            body,
                        });
                    }
                }
            }
        }
    }

    Ok(UpdateCheckResult {
        should_update: false,
        current_version,
        version: None,
        date: None,
        body: None,
    })
}

#[tauri::command]
async fn download_and_install_launcher_update(app: tauri::AppHandle) -> Result<String, String> {
    if let Ok(updater) = app.updater() {
        if let Ok(Some(update)) = updater.check().await {
            update.download_and_install(|_, _| {}, || {})
                .await
                .map_err(|e| format!("In-app download & install failed: {e}"))?;
            app.restart();
        }
    }

    Err("No in-app update is currently available or signature verification failed.".into())
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ManifestFile {
    pub name: String,
    pub url: String,
    pub destination: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ModpackManifest {
    pub version: String,
    pub files: Vec<ManifestFile>,
}

#[tauri::command]
fn detect_palworld_path() -> Result<String, String> {
    let mut candidate_paths = Vec::new();

    // Scan standard drive letters C through Z
    for drive in b'C'..=b'Z' {
        let drive_char = drive as char;
        candidate_paths.push(format!(r"{}:\SteamLibrary\steamapps\common\Palworld", drive_char));
        candidate_paths.push(format!(r"{}:\Program Files (x86)\Steam\steamapps\common\Palworld", drive_char));
        candidate_paths.push(format!(r"{}:\Program Files\Steam\steamapps\common\Palworld", drive_char));
        candidate_paths.push(format!(r"{}:\Steam\steamapps\common\Palworld", drive_char));
        candidate_paths.push(format!(r"{}:\Games\SteamLibrary\steamapps\common\Palworld", drive_char));
        candidate_paths.push(format!(r"{}:\Games\Steam\steamapps\common\Palworld", drive_char));
    }

    for path_str in &candidate_paths {
        let path = Path::new(path_str);
        if path.is_dir() && find_palworld_executable(path).is_some() {
            return Ok(path.to_string_lossy().into_owned());
        }
    }

    Err("Could not find a complete Palworld installation across local drives. Please verify the game is installed on Steam.".into())
}

#[tauri::command]
async fn update_modpack(game_path: String, state: State<'_, LauncherState>) -> Result<String, String> {
    state.update_presence("PalOlympics Launcher", Some("Downloading & Updating Modpack..."));
    let manifest_url =
        "https://raw.githubusercontent.com/beoul-create/PalOlympics/main/modpack-manifest.json";
    let client = reqwest::Client::new();
    let response = client
        .get(manifest_url)
        .header("User-Agent", "PalOlympics-Launcher")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch manifest: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Failed to fetch manifest: {e}"))?;

    let manifest: ModpackManifest = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse manifest JSON: {e}"))?;
    let base_dir = Path::new(&game_path);

    for file_info in manifest.files {
        if file_info.destination != "ue4ss_mods_zip" {
            continue;
        }

        let file_bytes = client
            .get(&file_info.url)
            .header("User-Agent", "PalOlympics-Launcher")
            .send()
            .await
            .map_err(|e| format!("Failed to download {}: {e}", file_info.name))?
            .error_for_status()
            .map_err(|e| format!("Failed to download {}: {e}", file_info.name))?
            .bytes()
            .await
            .map_err(|e| format!("Failed to read bytes for {}: {e}", file_info.name))?;

        fs::create_dir_all(base_dir).map_err(|e| e.to_string())?;
        extract_zip_to_directory(&file_bytes, base_dir)?;
    }

    if verify_modpack_files(Path::new(&game_path)) {
        state.update_presence("PalOlympics Launcher", Some("Modpack Verified - Ready to Launch"));
        Ok("Modpack installed and verified. Ready to launch!".into())
    } else {
        state.update_presence("PalOlympics Launcher", Some("Modpack Update Incomplete"));
        Err("Modpack was downloaded, but the expected UE4SS files were not found.".into())
    }
}

#[tauri::command]
fn verify_modpack(game_path: String) -> Result<bool, String> {
    let base_dir = Path::new(&game_path);
    if !base_dir.is_dir() {
        return Err("The selected Palworld directory does not exist.".into());
    }

    Ok(verify_modpack_files(base_dir))
}

fn verify_modpack_files(base_dir: &Path) -> bool {
    let win64_dir = base_dir.join("Pal").join("Binaries").join("Win64");
    win64_dir.join("dwmapi.dll").is_file() && win64_dir.join("ue4ss").is_dir()
}

fn cleanup_auto_join_mod(base_dir: &Path) {
    let win64_dir = base_dir.join("Pal").join("Binaries").join("Win64");
    let dirs = [
        win64_dir.join("ue4ss").join("Mods").join("PalOlympicsAutoJoin"),
        win64_dir.join("Mods").join("PalOlympicsAutoJoin"),
    ];
    for d in &dirs {
        if d.exists() {
            let _ = fs::remove_dir_all(d);
        }
    }
}

#[tauri::command]
fn launch_game(
    game_path: String,
    startup_flags: String,
    server_address: String,
    server_password: Option<String>,
    window: tauri::Window,
    state: State<'_, LauncherState>,
) -> Result<String, String> {
    let base_dir = PathBuf::from(&game_path);
    if find_palworld_executable(&base_dir).is_none() {
        return Err(format!(
            "Palworld executable was not found in {}.",
            base_dir.display()
        ));
    }

    cleanup_auto_join_mod(&base_dir);

    if load_config().optimize_engine_ini {
        let _ = apply_engine_optimizations(true);
    }

    let server_address = server_address.trim().to_string();
    let server_password = server_password.unwrap_or_default().trim().to_string();

    let mut extra_args = Vec::new();
    for flag in startup_flags.split_whitespace() {
        if flag.starts_with('-') {
            extra_args.push(flag.to_string());
        }
    }

    let exe_path = find_palworld_executable(&base_dir)
        .ok_or_else(|| format!("Palworld executable not found in {}", base_dir.display()))?;
    let working_dir = exe_path.parent().unwrap_or(&base_dir);

    // Ensure steam_appid.txt is present in the working directory to prevent Steam launcher redirects
    let _ = fs::write(working_dir.join("steam_appid.txt"), "1623730");
    let _ = fs::write(base_dir.join("steam_appid.txt"), "1623730");

    let mut cmd = Command::new(&exe_path);
    cmd.current_dir(working_dir)
        .env("SteamAppId", "1623730")
        .env("SteamGameId", "1623730")
        .env("SteamAppUser", "Palworld")
        .env("SteamClientLaunch", "1")
        .args(&extra_args);

    let spawn_res = cmd.spawn();

    if let Err(e) = spawn_res {
        // Fallback to Steam protocol if direct execution encounters an issue
        let steam_url = if extra_args.is_empty() {
            "steam://run/1623730".to_string()
        } else {
            let params = extra_args.join(" ");
            format!("steam://run/1623730//{}", url_encode(&params))
        };
        open_browser(&steam_url)
            .map_err(|err| format!("Failed to launch game directly ({e}) and via Steam protocol: {err}"))?;
    }

    if state.close_on_game_launch.load(Ordering::Relaxed) {
        let win = window.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(800));
            let _ = win.hide();
        });
    }

    let is_local_host = !win_process::find_server_pids().is_empty();

    let presence_state = if !server_address.is_empty() {
        format!("Playing on {}", server_address)
    } else {
        "Playing Palworld".to_string()
    };
    state.update_presence("Palworld - PalOlympics", Some(&presence_state));

    let connect_note = if is_local_host && server_address.contains("duckdns.org") {
        " (Host Note: Server is running on this PC — use 127.0.0.1:8211 in direct connect to avoid router NAT loopback)".to_string()
    } else if !server_address.is_empty() {
        if !server_password.is_empty() {
            format!(" (Server & Password ready for in-game Direct Connect)")
        } else {
            format!(" (Server IP ready for in-game Direct Connect)")
        }
    } else {
        String::new()
    };

    Ok(format!(
        "Palworld launched successfully.{connect_note}"
    ))
}

fn find_palworld_executable(base_dir: &Path) -> Option<PathBuf> {
    let candidates = [
        base_dir
            .join("Pal")
            .join("Binaries")
            .join("Win64")
            .join("Palworld-Win64-Shipping.exe"),
        base_dir.join("Palworld.exe"),
    ];

    candidates.into_iter().find(|candidate| candidate.is_file())
}

#[tauri::command]
fn is_game_running(state: State<'_, LauncherState>) -> Result<bool, String> {
    let running = !win_process::find_game_pids().is_empty();

    if running {
        let cfg = load_config();
        let server_info = if !cfg.server_address.trim().is_empty() {
            format!("Playing on {}", cfg.server_address.trim())
        } else {
            "In PalOlympics Modpack".to_string()
        };
        state.update_presence("Palworld - PalOlympics", Some(&server_info));
    }

    Ok(running)
}

#[tauri::command]
fn set_rich_presence(
    details: String,
    status: Option<String>,
    state: State<'_, LauncherState>,
) -> Result<(), String> {
    state.update_presence(&details, status.as_deref());
    Ok(())
}

fn get_config_var(key: &str) -> Option<String> {
    if let Ok(val) = std::env::var(key) {
        let trimmed = val.trim();
        if !trimmed.is_empty() && !trimmed.starts_with("your_") {
            return Some(trimmed.to_string());
        }
    }

    let candidates = [
        PathBuf::from(".env"),
        PathBuf::from("../.env"),
        PathBuf::from("src-tauri/.env"),
        PathBuf::from(r"C:\PalOlympics Launcher\.env"),
    ];

    for path in &candidates {
        if let Ok(contents) = fs::read_to_string(path) {
            for line in contents.lines() {
                let line = line.trim();
                if line.starts_with('#') || line.is_empty() {
                    continue;
                }
                if let Some((k, v)) = line.split_once('=') {
                    if k.trim() == key {
                        let cleaned = v.trim().trim_matches('"').trim_matches('\'').trim();
                        if !cleaned.is_empty() && !cleaned.starts_with("your_") {
                            return Some(cleaned.to_string());
                        }
                    }
                }
            }
        }
    }

    None
}

fn url_encode(input: &str) -> String {
    let mut encoded = String::new();
    for byte in input.bytes() {
        match byte {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => {
                encoded.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    encoded
}

fn parse_port_from_url(url_str: &str, default_port: u16) -> u16 {
    if let Some(after_scheme) = url_str.split("://").nth(1) {
        let host_port = after_scheme.split('/').next().unwrap_or(after_scheme);
        if let Some(port_str) = host_port.split(':').nth(1) {
            if let Ok(port) = port_str.parse::<u16>() {
                return port;
            }
        }
    }
    default_port
}

fn wait_for_discord_oauth_code(port: u16, timeout_secs: u64) -> Result<String, String> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", port))
        .map_err(|e| format!("Could not bind to local callback port {port}: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(timeout_secs);

    while start.elapsed() < timeout {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buffer = [0u8; 4096];
                let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
                let bytes_read = stream.read(&mut buffer).unwrap_or(0);
                let request = String::from_utf8_lossy(&buffer[..bytes_read]);

                let code = if let Some(first_line) = request.lines().next() {
                    if let Some(query_start) = first_line.find("code=") {
                        let after_code = &first_line[query_start + 5..];
                        let code_end = after_code
                            .find(|c: char| c.is_whitespace() || c == '&')
                            .unwrap_or(after_code.len());
                        Some(after_code[..code_end].to_string())
                    } else {
                        None
                    }
                } else {
                    None
                };

                let response_body = if code.is_some() {
                    r#"<!doctype html><html><head><meta charset="utf-8"><title>PalOlympics Launcher - Discord Authorized</title><style>body{background:#0b1120;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:32px 48px;text-align:center;box-shadow:0 12px 30px rgba(0,0,0,0.5);max-width:440px}h1{color:#38bdf8;font-size:22px;margin:0 0 12px}p{color:#94a3b8;font-size:14px;line-height:1.5;margin:0 0 8px}</style></head><body><div class="card"><h1>Authorization Successful</h1><p>Your Discord account has been authorized for PalOlympics Launcher.</p><p>You may now close this tab and return to the launcher.</p></div></body></html>"#
                } else {
                    r#"<!doctype html><html><head><meta charset="utf-8"><title>PalOlympics Launcher - Authorization Incomplete</title><style>body{background:#0b1120;color:#e2e8f0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.card{background:#1e293b;border:1px solid #ef4444;border-radius:12px;padding:32px 48px;text-align:center;max-width:440px}h1{color:#f87171;font-size:22px;margin:0 0 12px}p{color:#94a3b8;font-size:14px;margin:0}</style></head><body><div class="card"><h1>Authorization Incomplete</h1><p>No authorization code received from Discord.</p></div></body></html>"#
                };

                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response_body.len(),
                    response_body
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();

                if let Some(code) = code {
                    return Ok(code);
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(std::time::Duration::from_millis(150));
            }
            Err(e) => return Err(format!("Listener error: {e}")),
        }
    }

    Err("Discord authorization timed out (60s). Please try again.".into())
}

#[derive(Deserialize, Debug)]
struct DiscordTokenResponse {
    access_token: String,
    token_type: String,
}

#[derive(Deserialize, Debug)]
struct DiscordUserResponse {
    username: String,
    global_name: Option<String>,
}

fn open_browser(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let mut cmd = Command::new("rundll32.exe");
    cmd.args(["url.dll,FileProtocolHandler", url]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    match cmd.spawn() {
        Ok(_) => Ok(()),
        Err(_) => {
            let mut exp_cmd = Command::new("explorer.exe");
            exp_cmd.arg(url);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                exp_cmd.creation_flags(CREATE_NO_WINDOW);
            }
            exp_cmd
                .spawn()
                .map_err(|e| format!("Failed to launch browser: {e}"))?;
            Ok(())
        }
    }
}

async fn handle_discord_connection() -> Result<String, String> {
    let client_id = match get_config_var("DISCORD_CLIENT_ID") {
        Some(id) if !id.is_empty() => id,
        _ => {
            open_browser("https://discord.gg/8YCVeQgUVq")
                .map_err(|e| format!("Failed to open Discord: {e}"))?;
            return Ok("Opened PalOlympics Discord invite in browser!".into());
        }
    };

    let redirect_uri = get_config_var("DISCORD_REDIRECT_URI")
        .unwrap_or_else(|| "http://127.0.0.1:17832/callback".to_string());
    let port = parse_port_from_url(&redirect_uri, 17832);

    let auth_url = format!(
        "https://discord.com/oauth2/authorize?client_id={}&response_type=code&redirect_uri={}&scope=identify",
        client_id,
        url_encode(&redirect_uri)
    );

    open_browser(&auth_url)?;

    let code = tauri::async_runtime::spawn_blocking(move || wait_for_discord_oauth_code(port, 60))
        .await
        .map_err(|e| format!("Task execution failed: {e}"))??;

    let client_secret = get_config_var("DISCORD_CLIENT_SECRET").or_else(|| {
        let env_name = get_config_var("DISCORD_CLIENT_SECRET_ENV_VAR").unwrap_or_default();
        if !env_name.is_empty() {
            get_config_var(&env_name)
        } else {
            None
        }
    });

    if let Some(secret) = client_secret {
        let client = reqwest::Client::new();
        let params = [
            ("client_id", client_id.as_str()),
            ("client_secret", secret.as_str()),
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
        ];

        let token_res = client
            .post("https://discord.com/api/v10/oauth2/token")
            .form(&params)
            .header("User-Agent", "PalOlympics-Launcher")
            .send()
            .await
            .map_err(|e| format!("Token request failed: {e}"))?
            .error_for_status()
            .map_err(|e| format!("Discord token error: {e}"))?
            .json::<DiscordTokenResponse>()
            .await
            .map_err(|e| format!("Failed to parse Discord token: {e}"))?;

        let user_res = client
            .get("https://discord.com/api/v10/users/@me")
            .header(
                "Authorization",
                format!("{} {}", token_res.token_type, token_res.access_token),
            )
            .header("User-Agent", "PalOlympics-Launcher")
            .send()
            .await
            .map_err(|e| format!("User profile request failed: {e}"))?
            .error_for_status()
            .map_err(|e| format!("Discord user profile error: {e}"))?
            .json::<DiscordUserResponse>()
            .await
            .map_err(|e| format!("Failed to parse user info: {e}"))?;

        let display_name = user_res.global_name.unwrap_or(user_res.username);
        Ok(format!("Linked - {display_name}"))
    } else {
        Ok("Linked - Account Authorized".into())
    }
}

fn url_decode(input: &str) -> String {
    let mut result = Vec::new();
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(val) = u8::from_str_radix(&input[i + 1..i + 3], 16) {
                result.push(val);
                i += 3;
                continue;
            }
        } else if bytes[i] == b'+' {
            result.push(b' ');
            i += 1;
            continue;
        }
        result.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&result).into_owned()
}

fn extract_steam_id_from_text(text: &str) -> Option<String> {
    let decoded = url_decode(text);
    if let Some(pos) = decoded.find("steamcommunity.com/openid/id/") {
        let after = &decoded[pos + "steamcommunity.com/openid/id/".len()..];
        let id_str: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
        if id_str.len() >= 15 && id_str.parse::<u64>().is_ok() {
            return Some(id_str);
        }
    }
    None
}

fn wait_for_steam_openid(port: u16, timeout_secs: u64) -> Result<String, String> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", port))
        .map_err(|e| format!("Could not bind to local callback port {port}: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(timeout_secs);

    while start.elapsed() < timeout {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buffer = [0u8; 8192];
                let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
                let bytes_read = stream.read(&mut buffer).unwrap_or(0);
                let request = String::from_utf8_lossy(&buffer[..bytes_read]);

                if !request.starts_with("GET /steam/callback") && !request.contains("/steam/callback") {
                    let not_found = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                    let _ = stream.write_all(not_found.as_bytes());
                    continue;
                }

                let steam_id = extract_steam_id_from_text(&request);

                let response_body = if let Some(ref id) = steam_id {
                    format!(
                        r#"<!doctype html><html><head><meta charset="utf-8"><title>PalOlympics Launcher - Steam Linked</title><style>body{{background:#0b1120;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}}.card{{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:32px 48px;text-align:center;box-shadow:0 12px 30px rgba(0,0,0,0.5);max-width:440px}}h1{{color:#38bdf8;font-size:22px;margin:0 0 12px}}p{{color:#94a3b8;font-size:14px;line-height:1.5;margin:0 0 8px}}.id{{color:#4ade80;font-weight:600;font-family:monospace;font-size:15px}}</style></head><body><div class="card"><h1>Steam Linked Successfully</h1><p>Authenticated SteamID: <span class="id">{}</span></p><p>You may now close this browser window and return to the launcher.</p></div></body></html>"#,
                        id
                    )
                } else {
                    r#"<!doctype html><html><head><meta charset="utf-8"><title>PalOlympics Launcher - Steam Login Failed</title><style>body{{background:#0b1120;color:#e2e8f0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}}.card{{background:#1e293b;border:1px solid #ef4444;border-radius:12px;padding:32px 48px;text-align:center;max-width:440px}}h1{{color:#f87171;font-size:22px;margin:0 0 12px}}p{{color:#94a3b8;font-size:14px;margin:0}}</style></head><body><div class="card"><h1>Steam Authentication Incomplete</h1><p>Could not extract SteamID from identity claim.</p></div></body></html>"#.to_string()
                };

                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response_body.len(),
                    response_body
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();

                if let Some(id) = steam_id {
                    return Ok(id);
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(std::time::Duration::from_millis(150));
            }
            Err(e) => return Err(format!("Listener error: {e}")),
        }
    }

    Err("Steam login timed out (60s). Please try again.".into())
}

async fn handle_steam_connection() -> Result<String, String> {
    let return_url = get_config_var("STEAM_OPENID_RETURN_URL")
        .unwrap_or_else(|| "http://127.0.0.1:17832/steam/callback".to_string());
    let port = parse_port_from_url(&return_url, 17832);

    let realm = if let Some(pos) = return_url.find("/steam/callback") {
        format!("{}/", &return_url[..pos])
    } else {
        format!("http://127.0.0.1:{port}/")
    };

    let steam_auth_url = format!(
        "https://steamcommunity.com/openid/login?openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&openid.mode=checkid_setup&openid.return_to={}&openid.realm={}&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select",
        url_encode(&return_url),
        url_encode(&realm)
    );

    open_browser(&steam_auth_url)?;

    let steam_id = tauri::async_runtime::spawn_blocking(move || wait_for_steam_openid(port, 60))
        .await
        .map_err(|e| format!("Task execution failed: {e}"))??;

    Ok(format!("Linked - SteamID: {steam_id}"))
}

#[tauri::command]
fn open_browser_link(url: String) -> Result<(), String> {
    open_browser(&url)
}

#[tauri::command]
async fn open_connection(connection: String) -> Result<String, String> {
    match connection.as_str() {
        "discord" => handle_discord_connection().await,
        "discord_invite" => {
            open_browser("https://discord.gg/8YCVeQgUVq")?;
            Ok("Opened PalOlympics Discord invite in browser!".into())
        }
        "steam" => handle_steam_connection().await,
        _ => Err("Unknown connection provider.".into()),
    }
}

#[tauri::command]
fn set_minimize_to_tray(enabled: bool, state: State<'_, LauncherState>) {
    state.minimize_to_tray.store(enabled, Ordering::Relaxed);
}

fn extract_zip_to_directory(zip_bytes: &[u8], extract_to: &Path) -> Result<(), String> {
    let reader = Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| format!("Zip error: {e}"))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let safe_name = match file.enclosed_name() {
            Some(path) => extract_to.join(path),
            None => continue,
        };
        let entry_name = file.name().replace('\\', "/");
        let relative_name = entry_name
            .find("/Pal/")
            .map(|index| &entry_name[index + 1..])
            .or_else(|| entry_name.strip_prefix("Pal/"))
            .unwrap_or(&entry_name);
        let outpath = extract_to.join(relative_name);

        if !outpath.starts_with(extract_to) || !safe_name.starts_with(extract_to) {
            continue;
        }

        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
            continue;
        }

        if let Some(parent) = outpath.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut outfile = File::create(&outpath).map_err(|e| e.to_string())?;
        std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
    }

    Ok(())
}

pub fn start_game_lifecycle_and_priority_watcher(
    app_handle: tauri::AppHandle,
    auto_priority: std::sync::Arc<AtomicBool>,
    close_on_launch: std::sync::Arc<AtomicBool>,
) {
    let _ = std::thread::Builder::new()
        .name("game-lifecycle-priority-watcher".into())
        .spawn(move || {
            let mut was_game_running = false;
            let mut boosted_pids = std::collections::HashSet::new();

            loop {
                std::thread::sleep(Duration::from_millis(1500));
                let running = win_process::find_game_pids();
                let is_running = !running.is_empty();

                if is_running {
                    if !was_game_running {
                        was_game_running = true;
                        if close_on_launch.load(Ordering::Relaxed) {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.emit("launcher-hidden-to-tray", ());
                                let _ = window.hide();
                            }
                        }
                    }

                    // Promote process priority to High for any new PID
                    if auto_priority.load(Ordering::Relaxed) {
                        boosted_pids.retain(|pid| running.contains(pid));
                        for pid in &running {
                            if !boosted_pids.contains(pid) {
                                if let Ok(()) = win_process::set_process_priority_high(*pid) {
                                    boosted_pids.insert(*pid);
                                }
                            }
                        }
                    }
                } else {
                    boosted_pids.clear();
                    if was_game_running {
                        was_game_running = false;
                        if close_on_launch.load(Ordering::Relaxed) {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                                let _ = window.emit("game-exited", ());
                                let _ = window.emit("launcher-restored-from-tray", ());
                            }
                        }
                    }
                }
            }
        });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Enable high-performance GPU rasterization for smooth hardware-accelerated UI rendering
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--enable-gpu-rasterization --ignore-gpu-blocklist --enable-zero-copy --enable-features=CanvasOopRasterization",
    );

    let (tx, rx) = mpsc::channel::<IpcCommand>();
    let client_id = get_config_var("DISCORD_CLIENT_ID")
        .unwrap_or_else(|| "1539518725978591263".to_string());
    let start_time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    start_discord_rpc_worker(client_id, start_time, rx);

    let initial_config = load_config();
    let auto_priority = std::sync::Arc::new(AtomicBool::new(initial_config.auto_process_priority));
    let close_on_launch = std::sync::Arc::new(AtomicBool::new(initial_config.close_on_game_launch));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(LauncherState {
            minimize_to_tray: AtomicBool::new(initial_config.minimize_to_tray),
            auto_process_priority: auto_priority.clone(),
            close_on_game_launch: close_on_launch.clone(),
            discord_presence_tx: Mutex::new(Some(tx)),
            start_time,
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            detect_palworld_path,
            update_modpack,
            verify_modpack,
            launch_game,
            is_game_running,
            open_connection,
            set_rich_presence,
            set_minimize_to_tray,
            get_launcher_config,
            update_launcher_config,
            set_auto_process_priority,
            run_system_maintenance,
            backup_save_files,
            open_backup_folder,
            apply_engine_optimizations,
            query_server_status,
            check_for_launcher_updates,
            download_and_install_launcher_update,
            open_browser_link,
            calibrate_hardware_profile,
            apply_calibrated_profile,
            reset_engine_ini
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();
            start_game_lifecycle_and_priority_watcher(app_handle, auto_priority.clone(), close_on_launch.clone());

            let show_item = MenuItem::with_id(app, "show", "Show Launcher", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Launcher", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
            let icon = app
                .default_window_icon()
                .cloned()
                .ok_or("Application icon is not configured")?;
            TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("PalOlympics Launcher")
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                            let _ = window.emit("launcher-restored-from-tray", ());
                        }
                    }
                })
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                            let _ = window.emit("launcher-restored-from-tray", ());
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<LauncherState>();
                if state.minimize_to_tray.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.emit("launcher-hidden-to-tray", ());
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_steam_id_percent_encoded() {
        let request = "GET /steam/callback?openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&openid.claimed_id=https%3A%2F%2Fsteamcommunity.com%2Fopenid%2Fid%2F76561198012345678&openid.identity=https%3A%2F%2Fsteamcommunity.com%2Fopenid%2Fid%2F76561198012345678 HTTP/1.1";
        assert_eq!(
            extract_steam_id_from_text(request),
            Some("76561198012345678".to_string())
        );
    }

    #[test]
    fn test_extract_steam_id_plain_url() {
        let request = "GET /steam/callback?openid.claimed_id=https://steamcommunity.com/openid/id/76561198987654321&openid.mode=id_res HTTP/1.1";
        assert_eq!(
            extract_steam_id_from_text(request),
            Some("76561198987654321".to_string())
        );
    }

    #[test]
    fn test_url_decode() {
        assert_eq!(url_decode("http%3A%2F%2F127.0.0.1%3A17832%2Fsteam%2Fcallback"), "http://127.0.0.1:17832/steam/callback");
        assert_eq!(url_decode("Hello+World%21"), "Hello World!");
    }

    #[test]
    fn test_build_discord_ipc_packet() {
        let packet = build_discord_ipc_packet(0, r#"{"v":1}"#);
        assert_eq!(&packet[0..4], &0u32.to_le_bytes());
        assert_eq!(&packet[4..8], &7u32.to_le_bytes());
        assert_eq!(&packet[8..], br#"{"v":1}"#);
    }

    #[test]
    fn test_launcher_config_serialization() {
        let config = LauncherConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        let parsed: LauncherConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(config.startup_flags, parsed.startup_flags);
        assert_eq!(config.auto_process_priority, parsed.auto_process_priority);
        assert_eq!(config.minimize_to_tray, parsed.minimize_to_tray);
        assert_eq!(config.close_on_game_launch, parsed.close_on_game_launch);
    }

    #[test]
    fn test_zip_backup_creation() {
        let temp_dir = std::env::temp_dir().join(format!("pal_test_backup_{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let save_dir = temp_dir.join("Saves");
        let backup_dir = temp_dir.join("Backups");
        fs::create_dir_all(&save_dir).unwrap();
        fs::create_dir_all(&backup_dir).unwrap();

        fs::write(save_dir.join("World.sav"), b"mock save data content").unwrap();

        let result = backup_save_files(
            Some(save_dir.to_string_lossy().to_string()),
            Some(backup_dir.to_string_lossy().to_string()),
        ).unwrap();

        assert_eq!(result.files_archived, 1);
        assert!(Path::new(&result.file_path).is_file());
        assert!(result.file_size_bytes > 0);

        let _ = fs::remove_dir_all(&temp_dir);
    }
}

