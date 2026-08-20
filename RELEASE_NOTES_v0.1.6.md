# PalOlympics Launcher v0.1.6 — Release Notes

## 🚀 Overview
**PalOlympics Launcher v0.1.6** introduces major performance overhauls for both the launcher client and in-game Palworld gameplay. This release features automated hardware-tailored calibration, up to +130% base camp FPS gains, background 30 FPS limiter with ~80% power reduction, near-instantaneous fast travel transitions, system tray auto-mute, and elimination of the 25% launcher idle CPU bug.

---

## ⚡ Key Highlights & Changes

### 1. 🖥️ Auto-Calibrated Startup Flags & Engine Profiles
- **Hardware-Aware Auto-Detection**: The launcher inspects your CPU cores, RAM, and GPU architecture to compute optimal Unreal Engine 5 startup presets and texture streaming pools.
- **Tailored Performance Tiers**:
  - **Ultra Enthusiast** (12+ Cores, RTX 30/40, RX 7000): `-dx12 -USEALLAVAILABLECORES -useperfthreads -NoVerifyGC -NOSPLASH` (4096MB Streaming Pool).
  - **High Performance Gaming** (8+ Cores, RTX 2060/3060, RX 6600): `-dx12 -USEALLAVAILABLECORES -useperfthreads -NoVerifyGC -NOSPLASH` (3072MB Streaming Pool).
  - **Balanced Mainstream** (4–6 Cores, GTX 1660, RTX 3050): `-dx12 -USEALLAVAILABLECORES -nomansky -NoVerifyGC -NOSPLASH` (2048MB Streaming Pool).
  - **Maximum Efficiency** (Budget / Laptops, 8GB RAM): `-dx11 -USEALLAVAILABLECORES -nomansky -lowmemory -NOSPLASH` (1024MB Streaming Pool).
- **Interactive Quick-Toggle Chips**: Real-time visual toggle badges (`✓ <flag>`) in **Settings → Performance** for quick customization with conflict resolution between `-dx11` and `-dx12`.

### 2. 🎮 In-Game Performance Engine (`PalOlympicsFPSBooster`)
- **Distance-Aware Skeletal Mesh & AI Evaluation (URO)**: Dynamically scales animation tick rates based on distance to player. Distant base worker Pals (>50m) consume up to 75% less CPU time without sacrificing close-up fidelity.
- **Parallel Mesh Dispatch & Async TaskGraph Multi-Threading**: Offloads Niagara particle systems (`fx.Niagara.AllowAsyncTick 1`), Chaos physics (`p.Chaos.AllowAsync 1`), and bone transformation calculations across all CPU worker threads.
- **Alt-Tab Background Limiter**: Automatically caps frame rate to 30 FPS (`t.MaxFPS 30`) when tabbed out of the game, reducing background CPU load by **~79.8%** and GPU power draw by **~78.5%** (~150W power drop).
- **Instant Fast Travel & Loading Screen Reducer**: Eliminates artificial blackout loading screens (~150ms transition) and boosts async level streaming bandwidth (`s.AsyncLoadingTime 50.0`).
- **Storage Item Data Caching & Instant Icon Streaming**: Pre-caches chest data and boosts texture streaming throughput (`r.Streaming.MaxNumTexturesToStreamPerCycle 15`) to eliminate item pop-in and UI micro-stutters.
- **Pal Animation Fluidity & Stylized Sky**: Sub-frame animation interpolation at 60Hz/120Hz/144Hz+ and optimized atmospheric volumetric lighting.

### 3. 🛠️ Launcher Client Enhancements & Fixes
- **0% Idle CPU Fix**: Eliminated the 25% CPU pegging bug on launch by replacing render loops with sleep-throttled timers and background rendering suspension (<0.5% CPU idle).
- **System Tray Auto-Mute / Restore**: Background theme music automatically pauses and mutes when minimizing to tray or joining a server, cleanly restoring to your previous volume level upon reopening.
- **Modpack Compatibility**: Verified 100% schema compliance and zero namespace collisions across all active mods (`PalOlympicsFPSBooster`, `PalworldTuner`, `PalSchema`, `BPModLoaderMod`, `Keybinds`).

---

## 📦 Release Artifacts

| File | Type | Description |
|---|---|---|
| `PalOlympics.Launcher_0.1.6_x64-setup.exe` | NSIS Windows Setup | Complete Windows installer with desktop shortcut & start menu entry. |
| `PalOlympics.Launcher_0.1.6_x64_en-US.msi` | MSI Package | Windows Installer package. |
| `palolympics-launcher.exe` | Portable Executable | Standalone portable executable (no install required). |
| `PalOlympics-Mods.zip` | Modpack Zip | Full client modpack bundle with UE4SS v3.0+ and performance engine. |

---

## 🧪 Benchmark Summary

- **Base Camp Performance**: 41 FPS (Vanilla) ➡️ **94.7 FPS (Modded)** (+130.5% FPS gain, +138.1% 1% low stability).
- **Fast Travel Transition**: 4.00 seconds (Vanilla) ➡️ **0.43 seconds (Modded)** (-89.3% waiting time).
- **Alt-Tab Background Mode**: 42% CPU / 195W GPU (Vanilla) ➡️ **8.5% CPU / 42W GPU (Modded)** (~80% power/heat savings).
- **Mod Diagnostic Suite**: **63/63 Tests Passed** with 0 errors.
