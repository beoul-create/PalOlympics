const { invoke } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;

window.addEventListener("DOMContentLoaded", () => {
  const detectButton = document.querySelector("#detect-btn");
  const updateButton = document.querySelector("#update-btn");
  const pathDisplay = document.querySelector("#path-display");
  const statusDisplay = document.querySelector("#status-display");
  const volumeSlider = document.querySelector("#volume-slider");
  const volumeValue = document.querySelector("#volume-value");
  const muteToggle = document.querySelector("#mute-toggle");
  const animationsToggle = document.querySelector("#animations-toggle");
  const hwAccelToggle = document.querySelector("#hw-accel-toggle");
  const trayToggle = document.querySelector("#tray-toggle");
  const launcherMusic = document.querySelector("#launcher-music");
  const startupFlagsInput = document.querySelector("#startup-flags");
  const serverAddressInput = document.querySelector("#server-address");
  const gameStatus = document.querySelector("#game-status");
  const connectionButtons = document.querySelectorAll("[data-connection]");
  const windowBar = document.querySelector("#window-bar");
  const dragWindowButton = document.querySelector("#drag-window-btn");
  const minimizeButton = document.querySelector("#minimize-btn");
  const closeButton = document.querySelector("#close-btn");
  const cloudTrack = document.querySelector(".cloud-track");
  const cloudOverlays = document.querySelectorAll(".cloud-overlay");
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabPanels = document.querySelectorAll(".tab-panel");
  const autoLaunchToggle = document.querySelector("#auto-launch-toggle");
  const autoUpdateToggle = document.querySelector("#auto-update-toggle");
  const autoPriorityToggle = document.querySelector("#auto-priority-toggle");
  const customSavePathInput = document.querySelector("#custom-save-path");
  const backupDirPathInput = document.querySelector("#backup-dir-path");
  const cleanCacheBtn = document.querySelector("#clean-cache-btn");
  const maintenanceStatus = document.querySelector("#maintenance-status");
  const backupSavesBtn = document.querySelector("#backup-saves-btn");
  const openBackupsBtn = document.querySelector("#open-backups-btn");
  const backupStatus = document.querySelector("#backup-status");
  const presetChips = document.querySelectorAll(".preset-chip");

  let cachedGamePath = "";
  let modpackReady = false;
  let animatedBackgroundPath = "";
  let cloudTrackAnimation;
  let cloudOverlayAnimations = [];
  const appWindow = getCurrentWindow();

  // Tab navigation
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      tabButtons.forEach((b) => b.classList.remove("active"));
      tabPanels.forEach((p) => p.classList.remove("active"));
      button.classList.add("active");
      const tabId = button.dataset.tab;
      const targetPanel = document.querySelector(`#tab-${tabId}`);
      if (targetPanel) {
        targetPanel.classList.add("active");
      }
    });
  });

  const updatePresetChipStates = () => {
    if (!startupFlagsInput) return;
    const current = startupFlagsInput.value;
    presetChips.forEach((chip) => {
      const flag = chip.dataset.flag;
      if (current.includes(flag)) {
        chip.classList.add("active");
        chip.textContent = `✓ ${flag}`;
      } else {
        chip.classList.remove("active");
        chip.textContent = `+ ${flag}`;
      }
    });
  };

  presetChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const flag = chip.dataset.flag;
      let val = startupFlagsInput.value.trim();
      if (val.includes(flag)) {
        val = val.replace(flag, "").replace(/\s+/g, " ").trim();
      } else {
        val = `${val} ${flag}`.trim();
      }
      startupFlagsInput.value = val;
      updatePresetChipStates();
      saveLauncherConfig();
    });
  });

  const saveLauncherConfig = async () => {
    try {
      const config = {
        game_path: cachedGamePath || "",
        startup_flags: startupFlagsInput ? startupFlagsInput.value : "",
        server_address: serverAddressInput ? serverAddressInput.value : "",
        minimize_to_tray: trayToggle ? trayToggle.checked : true,
        hardware_acceleration: hwAccelToggle ? hwAccelToggle.checked : true,
        disable_animations: animationsToggle ? animationsToggle.checked : false,
        auto_process_priority: autoPriorityToggle ? autoPriorityToggle.checked : true,
        auto_launch: autoLaunchToggle ? autoLaunchToggle.checked : false,
        auto_update_modpack: autoUpdateToggle ? autoUpdateToggle.checked : false,
        save_backup_directory: backupDirPathInput ? backupDirPathInput.value : "",
        custom_save_path: customSavePathInput ? customSavePathInput.value : "",
      };
      await invoke("update_launcher_config", { config });
    } catch (e) {
      console.warn("Failed to save launcher config:", e);
    }
  };

  const loadLauncherConfig = async () => {
    try {
      const config = await invoke("get_launcher_config");
      if (config) {
        if (config.server_address && serverAddressInput) serverAddressInput.value = config.server_address;
        if (config.startup_flags && startupFlagsInput) startupFlagsInput.value = config.startup_flags;
        if (autoLaunchToggle) autoLaunchToggle.checked = config.auto_launch;
        if (autoUpdateToggle) autoUpdateToggle.checked = config.auto_update_modpack;
        if (trayToggle) trayToggle.checked = config.minimize_to_tray;
        if (animationsToggle) animationsToggle.checked = config.disable_animations;
        if (hwAccelToggle) hwAccelToggle.checked = config.hardware_acceleration;
        if (autoPriorityToggle) autoPriorityToggle.checked = config.auto_process_priority;
        if (customSavePathInput && config.custom_save_path) customSavePathInput.value = config.custom_save_path;
        if (backupDirPathInput && config.save_backup_directory) backupDirPathInput.value = config.save_backup_directory;

        animationsDisabled = config.disable_animations;
        applyBackgroundMode();
        updatePresetChipStates();
      }
    } catch (e) {
      console.warn("Failed to load launcher config:", e);
    }
  };

  // Load saved preferences from localStorage fallback
  const savedHwAccel = localStorage.getItem("palolympics_hw_accel");
  if (savedHwAccel !== null && hwAccelToggle) {
    hwAccelToggle.checked = savedHwAccel === "true";
  }

  const savedAnimationsDisabled = localStorage.getItem("palolympics_animations_disabled");
  if (savedAnimationsDisabled !== null && animationsToggle) {
    animationsToggle.checked = savedAnimationsDisabled === "true";
  }
  let animationsDisabled = animationsToggle ? animationsToggle.checked : false;

  const dragWindow = async (event) => {
    event.preventDefault();
    await appWindow.startDragging();
  };
  dragWindowButton.addEventListener("pointerdown", dragWindow);
  windowBar.addEventListener("pointerdown", (event) => {
    if (event.button === 0 && !event.target.closest("button")) {
      dragWindow(event);
    }
  });
  minimizeButton.addEventListener("pointerdown", (event) => event.stopPropagation());
  closeButton.addEventListener("pointerdown", (event) => event.stopPropagation());
  minimizeButton.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await appWindow.minimize();
    } catch (error) {
      console.error("Failed to minimize launcher window", error);
    }
  });
  closeButton.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await appWindow.close();
    } catch (error) {
      console.error("Failed to close launcher window", error);
    }
  });
  trayToggle.addEventListener("change", async () => {
    await invoke("set_minimize_to_tray", { enabled: trayToggle.checked });
  });
  invoke("set_minimize_to_tray", { enabled: trayToggle.checked });

  const stopCloudAnimations = () => {
    cloudTrackAnimation?.cancel();
    cloudTrackAnimation = undefined;
    cloudOverlayAnimations.forEach((animation) => animation.cancel());
    cloudOverlayAnimations = [];
    cloudTrack.classList.remove("js-cloud-motion");
  };

  const startCloudAnimations = () => {
    if (animationsDisabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const useHwAccel = hwAccelToggle ? hwAccelToggle.checked : true;
    const transformStart = useHwAccel ? "translate3d(0, 0, 0)" : "translateX(0)";
    const transformEnd = useHwAccel ? "translate3d(-50%, 0, 0)" : "translateX(-50%)";

    cloudTrack.classList.add("js-cloud-motion");
    cloudTrackAnimation = cloudTrack.animate(
      [
        { transform: transformStart },
        { transform: transformEnd }
      ],
      {
        duration: 32000,
        iterations: Infinity,
        easing: "linear"
      }
    );
    cloudOverlayAnimations = [...cloudOverlays].map((overlay, index) => overlay.animate(
      [
        { transform: useHwAccel ? "translate3d(0, 0, 0) scale(1.03)" : "translateX(0) scale(1.03)" },
        { transform: useHwAccel ? "translate3d(-50%, 0, 0) scale(1.03)" : "translateX(-50%) scale(1.03)" }
      ],
      {
        duration: index === 0 ? 38000 : 58000,
        iterations: Infinity,
        easing: "linear"
      }
    ));
  };

  let backgroundVideo = document.querySelector("#background-video");
  const bgCanvas = document.querySelector("#background-canvas");
  const fpsDisplay = document.querySelector("#fps-display");
  let interpolatedFrames = [];
  let totalGifDuration = 0;
  let canvasAnimationId = null;

  let frameTimestamps = [];
  let lastFpsBadgeUpdate = 0;

  const trackFps = (now) => {
    frameTimestamps.push(now);
    while (frameTimestamps.length > 0 && frameTimestamps[0] <= now - 1000) {
      frameTimestamps.shift();
    }
    if (now - lastFpsBadgeUpdate >= 250 && fpsDisplay) {
      lastFpsBadgeUpdate = now;
      const currentFps = frameTimestamps.length;
      fpsDisplay.textContent = `${currentFps} FPS`;
      if (currentFps >= 100) {
        fpsDisplay.style.color = "#4ade80"; // Bright Green for 100+ FPS
      } else if (currentFps >= 60) {
        fpsDisplay.style.color = "#38bdf8"; // Sky Blue for 60-99 FPS
      } else {
        fpsDisplay.style.color = "#f59e0b"; // Amber
      }
    }
  };

  let scrollPosition = 0;
  const scrollSpeed = 45; // Pixels per second continuous scroll to the left
  let lastFrameTime = performance.now();
  let lastRenderTime = 0;

  const startCanvasRenderLoop = () => {
    if (canvasAnimationId) cancelAnimationFrame(canvasAnimationId);
    if (!interpolatedFrames.length || !bgCanvas || animationsDisabled || document.hidden) return;

    bgCanvas.width = 1440;
    bgCanvas.height = 768;

    const useHwAccel = hwAccelToggle ? hwAccelToggle.checked : true;
    const ctx = bgCanvas.getContext('2d', {
      alpha: false,
      desynchronized: useHwAccel
    });
    let startTimestamp = performance.now();
    lastFrameTime = performance.now();
    lastRenderTime = 0;

    const renderLoop = (now) => {
      if (document.hidden || animationsDisabled) {
        if (fpsDisplay) {
          fpsDisplay.textContent = animationsDisabled ? "0 FPS (Off)" : "0 FPS (Idle)";
          fpsDisplay.style.color = "#94a3b8";
        }
        canvasAnimationId = null;
        return;
      }

      const useHwAccel = hwAccelToggle ? hwAccelToggle.checked : true;
      // When HW Accel is ON: Uncapped monitor refresh rate (165Hz+)
      // When HW Accel is OFF: Capped at standard 60 FPS (16.6ms interval) for power saving
      const targetInterval = useHwAccel ? 0 : (1000 / 60);

      if (targetInterval > 0) {
        const timeSinceLastRender = now - lastRenderTime;
        if (timeSinceLastRender < targetInterval - 1.5) {
          canvasAnimationId = requestAnimationFrame(renderLoop);
          return;
        }
      }
      lastRenderTime = now;
      trackFps(now);

      const delta = Math.min((now - lastFrameTime) / 1000, 0.1);
      lastFrameTime = now;

      const elapsed = (now - startTimestamp) % totalGifDuration;
      let accum = 0;
      let cur = 0;
      let nxt = 0;
      let progress = 0;

      for (let i = 0; i < interpolatedFrames.length; i++) {
        const d = interpolatedFrames[i].duration;
        if (elapsed >= accum && elapsed < accum + d) {
          cur = i;
          nxt = (i + 1) % interpolatedFrames.length;
          progress = (elapsed - accum) / d;
          break;
        }
        accum += d;
      }

      const blend = progress * progress * (3 - 2 * progress);

      // Continuous infinite scroll to the left with mirrored seamless edges
      const tileWidth = Math.round((bgCanvas.height / interpolatedFrames[0].height) * interpolatedFrames[0].width);
      const tileHeight = bgCanvas.height;
      const doubleTilePeriod = tileWidth * 2;

      scrollPosition = (scrollPosition + scrollSpeed * delta) % doubleTilePeriod;

      // Draw seamless repeating alternating mirrored base tiles
      ctx.globalAlpha = 1.0;
      for (let x = -scrollPosition; x < bgCanvas.width; x += tileWidth) {
        const isMirrored = (Math.floor((x + scrollPosition) / tileWidth) % 2 + 2) % 2 === 1;
        const sourceCanvas = isMirrored ? interpolatedFrames[cur].mirroredCanvas : interpolatedFrames[cur].canvas;
        ctx.drawImage(sourceCanvas, x, 0, tileWidth + 1, tileHeight);
      }

      // Draw smoothly blended next frame tiles for 60fps+ liquid motion
      if (blend > 0.001) {
        ctx.globalAlpha = blend;
        for (let x = -scrollPosition; x < bgCanvas.width; x += tileWidth) {
          const isMirrored = (Math.floor((x + scrollPosition) / tileWidth) % 2 + 2) % 2 === 1;
          const sourceCanvas = isMirrored ? interpolatedFrames[nxt].mirroredCanvas : interpolatedFrames[nxt].canvas;
          ctx.drawImage(sourceCanvas, x, 0, tileWidth + 1, tileHeight);
        }
      }

      canvasAnimationId = requestAnimationFrame(renderLoop);
    };

    canvasAnimationId = requestAnimationFrame(renderLoop);
  };

  const initGifInterpolator = async () => {
    if (!('ImageDecoder' in window) || !bgCanvas) {
      return;
    }

    try {
      const response = await fetch('./assets/launcher-bg.gif');
      if (!response.ok) return;
      const buffer = await response.arrayBuffer();

      const decoder = new ImageDecoder({ data: buffer, type: 'image/gif' });
      await decoder.tracks.ready;
      const track = decoder.tracks.selectedTrack;
      if (!track || track.frameCount <= 1) return;

      // Cut GIF in half so motion strictly moves to the left (eliminating the rightward ping-pong turnaround)
      const totalFrames = track.frameCount;
      const count = Math.max(2, Math.floor(totalFrames / 2));
      const frames = [];
      let totalTime = 0;

      for (let i = 0; i < count; i++) {
        const result = await decoder.decode({ frameIndex: i });
        const img = result.image;
        const durMs = img.duration ? img.duration / 1000 : 100;

        // Normal canvas tile
        const offCanvas = document.createElement('canvas');
        offCanvas.width = img.displayWidth;
        offCanvas.height = img.displayHeight;
        const offCtx = offCanvas.getContext('2d');
        offCtx.drawImage(img, 0, 0);

        // Horizontally mirrored canvas tile (creates seamless, line-free connected edges)
        const mirroredCanvas = document.createElement('canvas');
        mirroredCanvas.width = img.displayWidth;
        mirroredCanvas.height = img.displayHeight;
        const mCtx = mirroredCanvas.getContext('2d');
        mCtx.translate(mirroredCanvas.width, 0);
        mCtx.scale(-1, 1);
        mCtx.drawImage(img, 0, 0);

        img.close();

        frames.push({
          canvas: offCanvas,
          mirroredCanvas: mirroredCanvas,
          duration: Math.max(durMs, 30),
          width: offCanvas.width,
          height: offCanvas.height
        });
        totalTime += Math.max(durMs, 30);
      }

      if (frames.length > 0) {
        interpolatedFrames = frames;
        totalGifDuration = totalTime;
        bgCanvas.width = 1440;
        bgCanvas.height = 768;
        cloudTrack.classList.add("has-canvas-interpolation");
        applyBackgroundMode();
      }
    } catch (err) {
      console.warn("Smooth 60fps GIF interpolation fallback:", err);
    }
  };
  initGifInterpolator();

  const applyBackgroundMode = () => {
    stopCloudAnimations();
    if (canvasAnimationId) {
      cancelAnimationFrame(canvasAnimationId);
      canvasAnimationId = null;
    }

    const useHwAccel = hwAccelToggle ? hwAccelToggle.checked : true;
    document.documentElement.classList.toggle("no-hw-accel", !useHwAccel);
    cloudTrack.classList.toggle("animations-disabled", animationsDisabled);
    cloudTrack.classList.toggle("page-hidden", document.hidden);

    if (backgroundVideo) {
      if (animationsDisabled || document.hidden) {
        backgroundVideo.pause();
      } else {
        backgroundVideo.play().catch(() => {});
      }
    }

    if (animationsDisabled) {
      if (fpsDisplay) {
        fpsDisplay.textContent = "0 FPS (Off)";
        fpsDisplay.style.color = "#94a3b8";
      }
      // Switch image tags to completely static PNG artwork with zero movement
      cloudTrack.querySelectorAll(".launcher-background").forEach((image) => {
        image.src = "./assets/launcher-bg.png";
      });
      return;
    }

    if (document.hidden) {
      if (fpsDisplay) {
        fpsDisplay.textContent = "0 FPS (Idle)";
        fpsDisplay.style.color = "#94a3b8";
      }
      return;
    }

    const backgroundPath = "./assets/launcher-bg.gif";
    cloudTrack.querySelectorAll(".launcher-background").forEach((image) => {
      image.src = backgroundPath;
    });

    if (interpolatedFrames.length > 0) {
      startCanvasRenderLoop();
    } else {
      startCloudAnimations();
    }
  };

  // Check if a 60fps MP4/WebM video loop is available in assets
  const candidateVideos = ["./assets/launcher-bg.mp4", "./assets/launcher-bg.webm"];
  const checkVideoBackground = (index = 0) => {
    if (index >= candidateVideos.length) return;
    const testVideo = document.createElement("video");
    testVideo.src = candidateVideos[index];
    testVideo.oncanplay = () => {
      if (!backgroundVideo) {
        backgroundVideo = document.createElement("video");
        backgroundVideo.id = "background-video";
        backgroundVideo.autoplay = true;
        backgroundVideo.loop = true;
        backgroundVideo.muted = true;
        backgroundVideo.playsInline = true;
        backgroundVideo.className = "launcher-background-video";
        backgroundVideo.src = candidateVideos[index];
        cloudTrack.parentElement.insertBefore(backgroundVideo, cloudTrack);
        cloudTrack.style.display = "none";
      }
    };
    testVideo.onerror = () => checkVideoBackground(index + 1);
  };
  checkVideoBackground();

  if (animationsToggle) {
    animationsToggle.addEventListener("change", () => {
      animationsDisabled = animationsToggle.checked;
      localStorage.setItem("palolympics_animations_disabled", animationsDisabled);
      applyBackgroundMode();
    });
  }

  if (hwAccelToggle) {
    hwAccelToggle.addEventListener("change", () => {
      localStorage.setItem("palolympics_hw_accel", hwAccelToggle.checked);
      applyBackgroundMode();
    });
  }

  document.addEventListener("visibilitychange", applyBackgroundMode);

  applyBackgroundMode();

  launcherMusic.volume = Number(volumeSlider.value) / 100;

  const startLauncherMusic = () => {
    launcherMusic.play().catch(() => {
      // Browsers and WebView may require a user gesture before audio can start.
    });
  };

  ["click", "keydown", "pointerdown"].forEach((eventName) => {
    window.addEventListener(eventName, startLauncherMusic, { once: true });
  });
  startLauncherMusic();

  const refreshGameStatus = async () => {
    if (document.hidden) {
      return;
    }

    try {
      const running = await invoke("is_game_running");
      gameStatus.textContent = running ? "Game: Running" : "Game: Not running";
      gameStatus.dataset.running = running ? "true" : "false";
    } catch (error) {
      gameStatus.textContent = "Game: Status unavailable";
      delete gameStatus.dataset.running;
    }
  };

  const setModpackReady = (ready) => {
    modpackReady = ready;
    updateButton.textContent = ready ? "Launch Game" : "Download & Update";
  };

  detectButton.addEventListener("click", async () => {
    detectButton.disabled = true;
    pathDisplay.textContent = "Path: Searching...";

    try {
      cachedGamePath = await invoke("detect_palworld_path");
      pathDisplay.textContent = `Path: ${cachedGamePath}`;
      setModpackReady(await invoke("verify_modpack", { gamePath: cachedGamePath }));
      updateButton.disabled = false;
      statusDisplay.textContent = modpackReady
        ? "Modpack verified. Ready to launch."
        : "Installation found. Ready to update.";
    } catch (error) {
      cachedGamePath = "";
      setModpackReady(false);
      pathDisplay.textContent = `Error: ${error}`;
      updateButton.disabled = true;
      statusDisplay.textContent = "Could not find a Palworld installation.";
    } finally {
      detectButton.disabled = false;
    }
  });

  updateButton.addEventListener("click", async () => {
    updateButton.disabled = true;
    detectButton.disabled = true;
    statusDisplay.textContent = modpackReady ? "Launching Palworld..." : "Updating modpack...";

    try {
      if (modpackReady) {
        statusDisplay.textContent = await invoke("launch_game", {
          gamePath: cachedGamePath,
          startupFlags: startupFlagsInput.value,
          serverAddress: serverAddressInput.value,
        });
      } else {
        statusDisplay.textContent = await invoke("update_modpack", {
          gamePath: cachedGamePath,
        });
        setModpackReady(true);
      }
    } catch (error) {
      statusDisplay.textContent = `Error: ${error}`;
    } finally {
      updateButton.disabled = !cachedGamePath;
      detectButton.disabled = false;
    }
  });

  volumeSlider.addEventListener("input", () => {
    launcherMusic.volume = Number(volumeSlider.value) / 100;
    volumeValue.value = `${volumeSlider.value}%`;
    volumeValue.textContent = `${volumeSlider.value}%`;
  });

  muteToggle.addEventListener("change", () => {
    launcherMusic.muted = muteToggle.checked;
  });

  if (autoPriorityToggle) {
    autoPriorityToggle.addEventListener("change", () => {
      invoke("set_auto_process_priority", { enabled: autoPriorityToggle.checked });
      saveLauncherConfig();
    });
  }

  [autoLaunchToggle, autoUpdateToggle, trayToggle, serverAddressInput, customSavePathInput, backupDirPathInput].forEach((el) => {
    if (el) {
      el.addEventListener("change", saveLauncherConfig);
    }
  });

  if (cleanCacheBtn) {
    cleanCacheBtn.addEventListener("click", async () => {
      cleanCacheBtn.disabled = true;
      maintenanceStatus.textContent = "Cleaning shader cache and temporary logs...";
      maintenanceStatus.dataset.state = "pending";
      try {
        const report = await invoke("run_system_maintenance");
        maintenanceStatus.textContent = `✓ ${report.summary}`;
        maintenanceStatus.dataset.state = "success";
      } catch (err) {
        maintenanceStatus.textContent = `Error: ${err}`;
        maintenanceStatus.dataset.state = "error";
      } finally {
        cleanCacheBtn.disabled = false;
      }
    });
  }

  if (backupSavesBtn) {
    backupSavesBtn.addEventListener("click", async () => {
      backupSavesBtn.disabled = true;
      backupStatus.textContent = "Archiving save files into zip...";
      backupStatus.dataset.state = "pending";
      try {
        const customSaveDir = customSavePathInput ? customSavePathInput.value.trim() : "";
        const targetBackupDir = backupDirPathInput ? backupDirPathInput.value.trim() : "";
        const result = await invoke("backup_save_files", {
          customSaveDir: customSaveDir || null,
          targetBackupDir: targetBackupDir || null,
        });
        const mb = (result.file_size_bytes / (1024 * 1024)).toFixed(2);
        backupStatus.textContent = `✓ Created ${result.file_name} (${mb} MB, ${result.files_archived} files)`;
        backupStatus.dataset.state = "success";
      } catch (err) {
        backupStatus.textContent = `Error: ${err}`;
        backupStatus.dataset.state = "error";
      } finally {
        backupSavesBtn.disabled = false;
      }
    });
  }

  if (openBackupsBtn) {
    openBackupsBtn.addEventListener("click", async () => {
      const targetBackupDir = backupDirPathInput ? backupDirPathInput.value.trim() : "";
      try {
        await invoke("open_backup_folder", {
          targetBackupDir: targetBackupDir || null,
        });
      } catch (err) {
        backupStatus.textContent = `Could not open folder: ${err}`;
        backupStatus.dataset.state = "error";
      }
    });
  }

  connectionButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const connection = button.dataset.connection;
      const status = document.querySelector(`#${connection}-status`);
      status.textContent = connection === "discord" ? "Status: Authorizing in browser..." : "Status: Opening...";
      status.dataset.state = "pending";

      try {
        const message = await invoke("open_connection", { connection });
        status.textContent = `Status: ${message}`;
        const isLinked = message.toLowerCase().includes("linked") || message.toLowerCase().includes("opened");
        status.dataset.state = isLinked ? "success" : "warning";
      } catch (error) {
        status.textContent = `Status: Could not connect to ${connection}: ${error}`;
        status.dataset.state = "error";
      }
    });
  });

  // Launcher Updater Integration
  const updateModal = document.querySelector("#update-modal");
  const updateVersionText = document.querySelector("#update-version-text");
  const updateNotes = document.querySelector("#update-notes");
  const updateInstallBtn = document.querySelector("#update-install-btn");
  const updateDismissBtn = document.querySelector("#update-dismiss-btn");
  const updateProgressContainer = document.querySelector("#update-progress-container");
  const updateProgressFill = document.querySelector("#update-progress-fill");
  const updateProgressText = document.querySelector("#update-progress-text");
  const checkUpdatesBtn = document.querySelector("#check-updates-btn");
  const launcherUpdateStatus = document.querySelector("#launcher-update-status");

  const checkForLauncherUpdates = async (silent = true) => {
    if (launcherUpdateStatus && !silent) {
      launcherUpdateStatus.textContent = "Checking for updates...";
      launcherUpdateStatus.dataset.state = "pending";
    }

    try {
      const result = await invoke("check_for_launcher_updates");
      if (result && result.should_update) {
        if (updateVersionText) {
          updateVersionText.textContent = `New Version: v${result.version} (Current: v${result.current_version})`;
        }
        if (updateNotes) {
          updateNotes.textContent = result.body || "A new update for PalOlympics Launcher is ready to install.";
        }
        if (updateModal) {
          updateModal.style.display = "flex";
        }
        if (launcherUpdateStatus && !silent) {
          launcherUpdateStatus.textContent = `Update available: v${result.version}`;
          launcherUpdateStatus.dataset.state = "success";
        }
      } else {
        if (launcherUpdateStatus && !silent) {
          launcherUpdateStatus.textContent = `✓ Launcher is up to date (v${result.current_version})`;
          launcherUpdateStatus.dataset.state = "success";
        }
      }
    } catch (err) {
      console.warn("Update check failed:", err);
      if (launcherUpdateStatus && !silent) {
        launcherUpdateStatus.textContent = `Update check failed: ${err}`;
        launcherUpdateStatus.dataset.state = "error";
      }
    }
  };

  if (checkUpdatesBtn) {
    checkUpdatesBtn.addEventListener("click", () => {
      checkForLauncherUpdates(false);
    });
  }

  if (updateDismissBtn) {
    updateDismissBtn.addEventListener("click", () => {
      if (updateModal) {
        updateModal.style.display = "none";
      }
    });
  }

  if (updateInstallBtn) {
    updateInstallBtn.addEventListener("click", async () => {
      updateInstallBtn.disabled = true;
      if (updateProgressContainer) {
        updateProgressContainer.style.display = "block";
      }
      if (updateProgressFill) {
        updateProgressFill.style.width = "40%";
      }
      if (updateProgressText) {
        updateProgressText.textContent = "Downloading update silently in background...";
      }

      try {
        const msg = await invoke("download_and_install_launcher_update");
        if (updateProgressFill) {
          updateProgressFill.style.width = "100%";
        }
        if (updateProgressText) {
          updateProgressText.textContent = `✓ ${msg}`;
        }
      } catch (err) {
        if (updateProgressText) {
          updateProgressText.textContent = `Error: ${err}`;
        }
        updateInstallBtn.disabled = false;
      }
    });
  }

  // Load config from backend
  loadLauncherConfig();

  // Check for updates automatically on startup (non-blocking)
  checkForLauncherUpdates(true);

  let statusInterval = window.setInterval(refreshGameStatus, 10000);
  document.addEventListener("visibilitychange", () => {
    applyBackgroundMode();
    if (document.hidden) {
      window.clearInterval(statusInterval);
      return;
    }

    refreshGameStatus();
    statusInterval = window.setInterval(refreshGameStatus, 10000);
  });
  refreshGameStatus();
});
