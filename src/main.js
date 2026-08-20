const invoke = (...args) => {
  try {
    if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
      return window.__TAURI__.core.invoke(...args);
    }
    if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
      return window.__TAURI_INTERNALS__.invoke(...args);
    }
  } catch (err) {
    console.error("Invoke error:", err);
  }
  return Promise.resolve(null);
};

const getTauriWindow = () => {
  try {
    if (window.__TAURI__ && window.__TAURI__.window && window.__TAURI__.window.getCurrentWindow) {
      return window.__TAURI__.window.getCurrentWindow();
    }
  } catch (_) {}
  return null;
};

const escapeHtml = (unsafe) => {
  if (!unsafe) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

// Global Top-Level Tab Switcher (Immediately Callable)
window.switchLauncherTab = (tabId) => {
  if (!tabId) return;
  const allTabBtns = document.querySelectorAll(".tab-btn");
  const allTabPanels = document.querySelectorAll(".tab-panel");
  allTabBtns.forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tabId);
  });
  allTabPanels.forEach((p) => {
    if (p.id === `tab-${tabId}`) {
      p.classList.add("active");
      p.style.display = "block";
    } else {
      p.classList.remove("active");
      p.style.display = "none";
    }
  });
};

// Global Top-Level Audio Controller (Immediately Callable)
window._lastVolume = 100;

window.updateLauncherVolume = (val, e) => {
  if (e && e.stopPropagation) e.stopPropagation();
  const launcherMusic = document.getElementById("launcher-music") || document.querySelector("audio");
  const numVal = Math.max(0, Math.min(100, Math.round(Number(val) !== undefined ? Number(val) : 100)));
  if (numVal > 0) window._lastVolume = numVal;

  if (launcherMusic) {
    launcherMusic.volume = numVal / 100;
    if (numVal > 0) {
      launcherMusic.muted = false;
      if (launcherMusic.paused) {
        launcherMusic.play().catch(() => {});
      }
    } else {
      launcherMusic.muted = true;
    }
  }

  document.querySelectorAll("#dock-volume-slider, .audio-dock-slider, #titlebar-volume-slider").forEach((s) => {
    if (Number(s.value) !== numVal) s.value = numVal;
  });

  document.querySelectorAll("#dock-volume-text, .audio-dock-text, #titlebar-volume-text, .titlebar-volume-text").forEach((t) => {
    t.textContent = `${numVal}%`;
    t.innerText = `${numVal}%`;
  });

  const iconEmoji = numVal === 0 ? "🔇" : (numVal < 50 ? "🔉" : "🔊");
  document.querySelectorAll("#dock-mute-btn, .audio-dock-btn, #titlebar-mute-btn, .titlebar-audio-btn").forEach((b) => {
    b.textContent = iconEmoji;
    b.innerText = iconEmoji;
    b.innerHTML = iconEmoji;
    b.title = numVal === 0 ? "Click to unmute audio" : "Click to mute audio";
    b.dataset.muted = numVal === 0 ? "true" : "false";
  });
};

window.toggleLauncherMute = (e) => {
  if (e) {
    if (e.stopPropagation) e.stopPropagation();
    if (e.preventDefault) e.preventDefault();
  }
  const audio = document.getElementById("launcher-music") || document.querySelector("audio");
  const slider = document.getElementById("dock-volume-slider") || document.querySelector("#titlebar-volume-slider");
  const isMuted = audio ? (audio.muted || Number(audio.volume) === 0) : (slider && Number(slider.value) === 0);

  if (isMuted) {
    // Un-mute to previous volume level
    const targetVol = (window._lastVolume && window._lastVolume > 0) ? window._lastVolume : 100;
    window.updateLauncherVolume(targetVol);
  } else {
    // Mute to 0
    const cur = slider ? Number(slider.value) : (audio ? Math.round(audio.volume * 100) : 100);
    if (cur > 0) window._lastVolume = cur;
    window.updateLauncherVolume(0);
  }
};

window.addEventListener("DOMContentLoaded", () => {
  const detectButton = document.querySelector("#detect-btn");
  const updateButton = document.querySelector("#update-btn");
  const pathDisplay = document.querySelector("#path-display");
  const statusDisplay = document.querySelector("#status-display");
  const dockMuteBtn = document.querySelector("#dock-mute-btn") || document.querySelector("#titlebar-mute-btn");
  const dockVolumeSlider = document.querySelector("#dock-volume-slider") || document.querySelector("#titlebar-volume-slider");
  const dockVolumeText = document.querySelector("#dock-volume-text") || document.querySelector("#titlebar-volume-text");
  const animationsToggle = document.querySelector("#animations-toggle");

  function applyAnimationSetting(disabled) {
    const isDisabled = Boolean(disabled);
    animationsDisabled = isDisabled;
    document.documentElement.classList.toggle("no-animations", isDisabled);
    document.body.classList.toggle("no-animations", isDisabled);
    localStorage.setItem("disableAnimations", isDisabled);
    localStorage.setItem("palolympics_animations_disabled", isDisabled);
    if (animationsToggle) animationsToggle.checked = isDisabled;
    // applyBackgroundMode is a const arrow function defined later in this scope,
    // so it's not available during the initial synchronous call on page load.
    try { applyBackgroundMode(); } catch (_) { /* not yet defined */ }
    try { saveLauncherConfig(); } catch (_) { /* not yet defined */ }
  }

  // On load
  const savedAnimationState = localStorage.getItem("disableAnimations") === "true" || localStorage.getItem("palolympics_animations_disabled") === "true";
  let animationsDisabled = savedAnimationState;
  applyAnimationSetting(savedAnimationState);

  window.toggleAnimations = (disabled) => {
    applyAnimationSetting(disabled);
  };

  // On change
  if (animationsToggle) {
    animationsToggle.addEventListener("change", (e) => {
      applyAnimationSetting(e.target.checked);
    });
  }

  const hwAccelToggle = document.querySelector("#hw-accel-toggle");
  const trayToggle = document.querySelector("#tray-toggle");
  const launcherMusic = document.querySelector("#launcher-music");
  const startupFlagsInput = document.querySelector("#startup-flags");
  const serverAddressInput = document.querySelector("#server-address");
  const serverPasswordInput = document.querySelector("#server-password");
  const copyIpBtn = document.querySelector("#copy-ip-btn");
  const copyPassBtn = document.querySelector("#copy-pass-btn");
  const togglePasswordBtn = document.querySelector("#toggle-password-btn");
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
  const closeOnLaunchToggle = document.querySelector("#close-on-launch-toggle");
  const autoPriorityToggle = document.querySelector("#auto-priority-toggle");
  const customSavePathInput = document.querySelector("#custom-save-path");
  const backupDirPathInput = document.querySelector("#backup-dir-path");
  const cleanCacheBtn = document.querySelector("#clean-cache-btn");
  const maintenanceStatus = document.querySelector("#maintenance-status");
  const backupSavesBtn = document.querySelector("#backup-saves-btn");
  const openBackupsBtn = document.querySelector("#open-backups-btn");
  const backupStatus = document.querySelector("#backup-status");
  const presetChips = document.querySelectorAll(".preset-chip");

  // Server Live Board selectors
  const boardServerName = document.querySelector("#board-server-name");
  const boardServerIp = document.querySelector("#board-server-ip");
  const boardDiscordJoinBtn = document.querySelector("#board-discord-join-btn");
  const boardStatusPill = document.querySelector("#board-status-pill");
  const boardStatusText = document.querySelector("#board-status-text");
  const metricPing = document.querySelector("#metric-ping");
  const metricPlayers = document.querySelector("#metric-players");
  const metricUptime = document.querySelector("#metric-uptime");
  const metricRestart = document.querySelector("#metric-restart");
  const rosterCountBadge = document.querySelector("#roster-count-badge");
  const rosterTbody = document.querySelector("#roster-tbody");
  const refreshServerBtn = document.querySelector("#refresh-server-btn");

  // Personalization & Theme selectors
  const themeChips = document.querySelectorAll(".theme-chip");
  const customBgInput = document.querySelector("#custom-bg-input");
  const chooseBgBtn = document.querySelector("#choose-bg-btn");
  const resetBgBtn = document.querySelector("#reset-bg-btn");
  const customBgStatus = document.querySelector("#custom-bg-status");
  const customBgContainer = document.querySelector("#custom-bg-container");
  const customBgImage = document.querySelector("#custom-bg-image");
  const customBgVideo = document.querySelector("#custom-bg-video");
  const customBgDimmer = document.querySelector("#custom-bg-dimmer");
  const bgDimSlider = document.querySelector("#bg-dim-slider");
  const bgDimValue = document.querySelector("#bg-dim-value");
  const bgBlurSlider = document.querySelector("#bg-blur-slider");
  const bgBlurValue = document.querySelector("#bg-blur-value");
  const customAudioInput = document.querySelector("#custom-audio-input");
  const chooseAudioBtn = document.querySelector("#choose-audio-btn");
  const resetAudioBtn = document.querySelector("#reset-audio-btn");
  const customAudioStatus = document.querySelector("#custom-audio-status");

  let cachedGamePath = "";
  let modpackReady = false;
  let animatedBackgroundPath = "";
  let cloudTrackAnimation;
  let cloudOverlayAnimations = [];
  const appWindow = getTauriWindow();

  // Tab navigation is handled by inline onclick="window.switchLauncherTab(...)" in index.html
  // Preset chips and settings are initialized below in settings section

  // saveLauncherConfig and loadLauncherConfig are defined further below (after theme/customization setup)

  // Load saved preferences from localStorage fallback
  const savedHwAccel = localStorage.getItem("palolympics_hw_accel");
  if (savedHwAccel !== null && hwAccelToggle) {
    hwAccelToggle.checked = savedHwAccel === "true";
  }

  const savedAnimationsDisabled = localStorage.getItem("palolympics_animations_disabled");
  if (savedAnimationsDisabled !== null && animationsToggle) {
    animationsToggle.checked = savedAnimationsDisabled === "true";
  }
  animationsDisabled = animationsToggle ? animationsToggle.checked : false;

  let wasAudioMutedBeforeTray = false;
  let isHiddenInTray = false;

  window.handleTrayHide = () => {
    isHiddenInTray = true;
    const audio = document.getElementById("launcher-music") || document.querySelector("audio");
    if (audio) {
      wasAudioMutedBeforeTray = audio.muted || Number(audio.volume) === 0 || audio.paused;
      audio.muted = true;
      audio.pause();
    }
  };

  window.handleTrayRestore = () => {
    isHiddenInTray = false;
    const audio = document.getElementById("launcher-music") || document.querySelector("audio");
    if (audio) {
      if (!wasAudioMutedBeforeTray) {
        const targetVol = (window._lastVolume !== undefined && window._lastVolume > 0) ? window._lastVolume : 100;
        audio.volume = targetVol / 100;
        audio.muted = false;
        audio.play().catch(() => {});
      }
    }
  };

  const dragWindow = async (event) => {
    event.preventDefault();
    await appWindow.startDragging();
  };
  if (minimizeButton) {
    minimizeButton.addEventListener("pointerdown", (event) => event.stopPropagation());
    minimizeButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        const win = getTauriWindow();
        if (win) await win.minimize();
      } catch (error) {
        console.error("Failed to minimize launcher window", error);
      }
    });
  }

  if (closeButton) {
    closeButton.addEventListener("pointerdown", (event) => event.stopPropagation());
    closeButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        if (trayToggle && trayToggle.checked) {
          window.handleTrayHide();
        }
        const win = getTauriWindow();
        if (win) await win.close();
      } catch (error) {
        console.error("Failed to close launcher window", error);
      }
    });
  }

  if (trayToggle) {
    trayToggle.addEventListener("change", async () => {
      await invoke("set_minimize_to_tray", { enabled: trayToggle.checked });
    });
    invoke("set_minimize_to_tray", { enabled: trayToggle.checked });
  }

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
  let canvasTimerId = null;
  let precalcTileWidth = 0;
  let precalcTileHeight = 768;
  let precalcDoublePeriod = 0;
  let isWindowFocused = true;

  const cancelCanvasLoop = () => {
    if (canvasAnimationId) {
      cancelAnimationFrame(canvasAnimationId);
      canvasAnimationId = null;
    }
    if (canvasTimerId) {
      clearTimeout(canvasTimerId);
      canvasTimerId = null;
    }
  };

  window.addEventListener("focus", () => {
    isWindowFocused = true;
    if (interpolatedFrames.length > 0 && !canvasAnimationId && !canvasTimerId && !animationsDisabled && !document.hidden) {
      startCanvasRenderLoop();
    }
  });

  window.addEventListener("blur", () => {
    isWindowFocused = false;
    cancelCanvasLoop();
    if (fpsDisplay) {
      fpsDisplay.textContent = "0 FPS (Unfocused)";
      fpsDisplay.style.color = "#94a3b8";
    }
  });

  let fpsFrameCount = 0;
  let fpsWindowStart = performance.now();
  let lastFpsBadgeUpdate = 0;

  const trackFps = (now) => {
    fpsFrameCount++;
    if (now - lastFpsBadgeUpdate >= 500) {
      const elapsed = (now - fpsWindowStart) / 1000;
      const currentFps = elapsed > 0 ? Math.round(fpsFrameCount / elapsed) : 0;
      fpsFrameCount = 0;
      fpsWindowStart = now;
      lastFpsBadgeUpdate = now;

      if (fpsDisplay) {
        fpsDisplay.textContent = `${currentFps} FPS`;
        if (currentFps >= 60) {
          fpsDisplay.style.color = "#4ade80"; // Bright Green
        } else if (currentFps >= 25) {
          fpsDisplay.style.color = "#38bdf8"; // Sky Blue
        } else {
          fpsDisplay.style.color = "#f59e0b"; // Amber
        }
      }
    }
  };

  let scrollPosition = 0;
  const scrollSpeed = 45; // Pixels per second continuous scroll to the left
  let lastFrameTime = performance.now();
  let lastRenderTime = 0;

  const startCanvasRenderLoop = () => {
    cancelCanvasLoop();
    if (!interpolatedFrames.length || !bgCanvas || animationsDisabled || document.hidden || !isWindowFocused) return;

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
      canvasAnimationId = null;
      const isGameRunning = gameStatus && gameStatus.dataset.running === "true";
      if (document.hidden || animationsDisabled || isGameRunning || !isWindowFocused) {
        if (fpsDisplay) {
          fpsDisplay.textContent = isGameRunning ? "0 FPS (Game Running)" : (!isWindowFocused ? "0 FPS (Unfocused)" : (animationsDisabled ? "0 FPS (Off)" : "0 FPS (Idle)"));
          fpsDisplay.style.color = "#94a3b8";
        }
        cancelCanvasLoop();
        return;
      }

      const useHwAccel = hwAccelToggle ? hwAccelToggle.checked : true;
      const targetFps = useHwAccel ? 30 : 24;
      const targetInterval = 1000 / targetFps;

      const timeSinceLastRender = now - lastRenderTime;
      if (timeSinceLastRender < targetInterval - 1.0) {
        // Sleep until next frame rather than spinning
        const delay = Math.max(1, Math.floor(targetInterval - timeSinceLastRender));
        canvasTimerId = setTimeout(() => {
          canvasAnimationId = requestAnimationFrame(renderLoop);
        }, delay);
        return;
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

      const tileWidth = precalcTileWidth || 1365;
      const doubleTilePeriod = precalcDoublePeriod || (tileWidth * 2);

      scrollPosition = (scrollPosition + scrollSpeed * delta) % doubleTilePeriod;

      // Draw seamless repeating alternating mirrored base tiles (1:1 blit without scaling)
      ctx.globalAlpha = 1.0;
      for (let x = -scrollPosition; x < 1440; x += tileWidth) {
        const isMirrored = (Math.floor((x + scrollPosition) / tileWidth) % 2 + 2) % 2 === 1;
        const sourceCanvas = isMirrored ? interpolatedFrames[cur].mirroredCanvas : interpolatedFrames[cur].canvas;
        ctx.drawImage(sourceCanvas, x, 0);
      }

      // Draw smoothly blended next frame tiles
      if (blend > 0.001) {
        ctx.globalAlpha = blend;
        for (let x = -scrollPosition; x < 1440; x += tileWidth) {
          const isMirrored = (Math.floor((x + scrollPosition) / tileWidth) % 2 + 2) % 2 === 1;
          const sourceCanvas = isMirrored ? interpolatedFrames[nxt].mirroredCanvas : interpolatedFrames[nxt].canvas;
          ctx.drawImage(sourceCanvas, x, 0);
        }
      }

      // Schedule next frame with a gentle timeout throttle to prevent busy loops
      canvasTimerId = setTimeout(() => {
        canvasAnimationId = requestAnimationFrame(renderLoop);
      }, Math.max(1, Math.floor(targetInterval - 4)));
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

      const targetTileHeight = 768;

      for (let i = 0; i < count; i++) {
        const result = await decoder.decode({ frameIndex: i });
        const img = result.image;
        const durMs = img.duration ? img.duration / 1000 : 100;

        const targetTileWidth = Math.round((targetTileHeight / img.displayHeight) * img.displayWidth);

        // Pre-scaled normal canvas tile for fast 1:1 blitting
        const offCanvas = document.createElement('canvas');
        offCanvas.width = targetTileWidth;
        offCanvas.height = targetTileHeight;
        const offCtx = offCanvas.getContext('2d');
        offCtx.drawImage(img, 0, 0, targetTileWidth, targetTileHeight);

        // Pre-scaled horizontally mirrored canvas tile
        const mirroredCanvas = document.createElement('canvas');
        mirroredCanvas.width = targetTileWidth;
        mirroredCanvas.height = targetTileHeight;
        const mCtx = mirroredCanvas.getContext('2d');
        mCtx.translate(targetTileWidth, 0);
        mCtx.scale(-1, 1);
        mCtx.drawImage(img, 0, 0, targetTileWidth, targetTileHeight);

        img.close();

        frames.push({
          canvas: offCanvas,
          mirroredCanvas: mirroredCanvas,
          duration: Math.max(durMs, 30),
          width: targetTileWidth,
          height: targetTileHeight
        });
        totalTime += Math.max(durMs, 30);
      }

      if (frames.length > 0) {
        interpolatedFrames = frames;
        totalGifDuration = totalTime;
        precalcTileWidth = frames[0].width;
        precalcTileHeight = frames[0].height;
        precalcDoublePeriod = precalcTileWidth * 2;
        bgCanvas.width = 1440;
        bgCanvas.height = 768;
        cloudTrack.classList.add("has-canvas-interpolation");
        applyBackgroundMode();
      }
    } catch (err) {
      console.warn("Smooth GIF interpolation fallback:", err);
    }
  };
  initGifInterpolator();

  function applyBackgroundMode() {
    stopCloudAnimations();
    cancelCanvasLoop();

    const useHwAccel = hwAccelToggle ? hwAccelToggle.checked : true;
    document.documentElement.classList.toggle("no-hw-accel", !useHwAccel);
    document.body.classList.toggle("animations-disabled", animationsDisabled);
    cloudTrack.classList.toggle("animations-disabled", animationsDisabled);
    cloudTrack.classList.toggle("page-hidden", document.hidden);

    if (backgroundVideo) {
      if (animationsDisabled || document.hidden) {
        backgroundVideo.pause();
        backgroundVideo.style.display = "none";
        cloudTrack.style.display = "block";
      } else {
        backgroundVideo.style.display = "block";
        cloudTrack.style.display = "none";
        backgroundVideo.play().catch(() => {});
      }
    } else {
      cloudTrack.style.display = "block";
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
  }

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

  // Animations toggle change is handled by applyAnimationSetting (lines 124-136) and the inline onchange in HTML

  if (hwAccelToggle) {
    hwAccelToggle.addEventListener("change", () => {
      localStorage.setItem("palolympics_hw_accel", hwAccelToggle.checked);
      applyBackgroundMode();
      saveLauncherConfig();
    });
  }

  document.addEventListener("visibilitychange", applyBackgroundMode);

  applyBackgroundMode();

  window.updateLauncherVolume(100);

  const startLauncherMusic = () => {
    if (launcherMusic) {
      launcherMusic.volume = (window._lastVolume || 100) / 100;
      launcherMusic.muted = false;
      if (launcherMusic.paused) {
        launcherMusic.play().catch(() => {});
      }
    }
  };

  ["click", "keydown", "pointerdown", "mousedown", "touchstart"].forEach((eventName) => {
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

  const initGamePathAndModpack = async (config) => {
    let path = cachedGamePath;
    if (!path) {
      try {
        path = await invoke("detect_palworld_path");
        cachedGamePath = path;
        saveLauncherConfig();
      } catch (_) {}
    }

    if (path) {
      pathDisplay.textContent = `Path: ${path}`;
      try {
        const isVerified = await invoke("verify_modpack", { gamePath: path });
        setModpackReady(isVerified);
        updateButton.disabled = false;

        if (isVerified) {
          statusDisplay.textContent = "Modpack verified. Ready to launch.";
          if (config && config.auto_launch) {
            setTimeout(async () => {
              const isRunning = await invoke("is_game_running");
              if (!isRunning && modpackReady) {
                updateButton.click();
              }
            }, 1000);
          }
        } else {
          statusDisplay.textContent = "Installation found. Ready to update.";
          if (config && config.auto_update_modpack) {
            updateButton.click();
          }
        }
      } catch (err) {
        statusDisplay.textContent = `Modpack check: ${err}`;
      }
    } else {
      pathDisplay.textContent = "Path: Not detected";
      updateButton.disabled = true;
    }
  };

  if (detectButton) {
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
  }

  if (updateButton) {
    updateButton.addEventListener("click", async () => {
      updateButton.disabled = true;
      if (detectButton) detectButton.disabled = true;
      if (statusDisplay) statusDisplay.textContent = modpackReady ? "Launching Palworld..." : "Updating modpack...";

      try {
        if (modpackReady) {
          const sAddress = serverAddressInput ? serverAddressInput.value.trim() : "";
          const sPassword = serverPasswordInput ? serverPasswordInput.value.trim() : "";

          // Auto-copy server details to clipboard for instant pasting if needed
          if (sAddress) {
            try {
              await navigator.clipboard.writeText(sAddress);
            } catch (_) {}
          }

          const launchResult = await invoke("launch_game", {
            gamePath: cachedGamePath,
            startupFlags: startupFlagsInput ? startupFlagsInput.value : "-dx12",
            serverAddress: sAddress,
            serverPassword: sPassword,
          });
          if (statusDisplay) statusDisplay.textContent = launchResult;
        } else {
          const updateResult = await invoke("update_modpack", {
            gamePath: cachedGamePath,
          });
          if (statusDisplay) statusDisplay.textContent = updateResult;
          setModpackReady(true);
        }
      } catch (error) {
        if (statusDisplay) statusDisplay.textContent = `Error: ${error}`;
      } finally {
        updateButton.disabled = !cachedGamePath;
        if (detectButton) detectButton.disabled = false;
      }
    });
  }

  // Window bar dragging (unique — minimize/close/preset handlers are already bound above)
  if (windowBar) {
    windowBar.addEventListener("mousedown", async (e) => {
      // Strictly ignore clicks on audio controls, buttons, sliders, or window controls
      if (e.target.closest(".titlebar-audio-control") || e.target.closest(".window-controls") || e.target.tagName === "BUTTON" || e.target.tagName === "INPUT") {
        return;
      }
      if (e.buttons === 1 && (e.target.closest(".window-bar-left") || e.target.id === "drag-window-btn" || e.target === windowBar)) {
        try {
          const appWindow = getTauriWindow();
          if (appWindow) await appWindow.startDragging();
        } catch (_) {}
      }
    });
  }

  // Server Live Board Logic
  const formatUptime = (seconds) => {
    if (!seconds || seconds <= 0) return "Active";
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hrs}h ${mins}m`;
  };

  const updateServerBoard = async () => {
    if (document.hidden) return;
    if (refreshServerBtn) refreshServerBtn.classList.add("spinning");
    try {
      const sAddress = serverAddressInput ? serverAddressInput.value.trim() : "beoul.duckdns.org:8211";
      const sPassword = serverPasswordInput ? serverPasswordInput.value.trim() : "0331BAZEEY";

      const status = await invoke("query_server_status", {
        serverAddress: sAddress,
        password: sPassword,
      });

      if (boardServerName && status.server_name) {
        boardServerName.textContent = status.server_name;
      }
      if (boardServerIp) {
        boardServerIp.textContent = `🌐 ${status.address || sAddress}`;
      }
      // boardServerPass element removed — password is hidden and not displayed on the board

      if (boardStatusPill && boardStatusText) {
        if (status.online) {
          boardStatusPill.className = "server-status-pill online";
          boardStatusText.textContent = "ONLINE";
        } else {
          boardStatusPill.className = "server-status-pill offline";
          boardStatusText.textContent = "OFFLINE";
        }
      }

      if (metricPing) {
        metricPing.textContent = status.online ? `${status.ping_ms} ms` : "Offline";
        metricPing.style.color = status.online ? (status.ping_ms < 60 ? "#166534" : "#b45309") : "#991b1b";
      }

      if (metricPlayers) {
        metricPlayers.textContent = status.online ? `${status.player_count} / ${status.max_players}` : "0 / 32";
      }

      if (metricUptime) {
        metricUptime.textContent = status.online ? (status.uptime_seconds > 0 ? formatUptime(status.uptime_seconds) : "Active") : "Offline";
      }

      if (metricRestart) {
        metricRestart.textContent = status.online ? (status.next_restart_seconds ? formatUptime(status.next_restart_seconds) : "4h Cycle") : "--";
      }

      if (rosterCountBadge) {
        rosterCountBadge.textContent = `${status.players.length} Online`;
      }

      if (rosterTbody) {
        if (status.players && status.players.length > 0) {
          rosterTbody.innerHTML = status.players.map(p => `
            <tr>
              <td><strong>${escapeHtml(p.name)}</strong></td>
              <td><span class="player-level-badge">Lv. ${p.level}</span></td>
              <td><span class="player-ping-badge">${p.ping} ms</span></td>
              <td><span style="color: #166534; font-weight: 600;">🟢 In-Game</span></td>
            </tr>
          `).join("");
        } else {
          rosterTbody.innerHTML = `
            <tr>
              <td colspan="4" class="roster-empty-cell">
                <div class="empty-roster-msg">
                  <span>🎮 No players currently on the server. Ready for you to explore!</span>
                </div>
              </td>
            </tr>
          `;
        }
      }
    } catch (err) {
      console.warn("Failed to update server board:", err);
    } finally {
      if (refreshServerBtn) {
        setTimeout(() => refreshServerBtn.classList.remove("spinning"), 500);
      }
    }
  };

  // Endpoint 1-click clipboard copy & discord handlers
  if (boardServerIp) {
    boardServerIp.addEventListener("click", async () => {
      const sAddress = serverAddressInput ? serverAddressInput.value.trim() : "beoul.duckdns.org:8211";
      try {
        await navigator.clipboard.writeText(sAddress);
        boardServerIp.textContent = "✓ Copied IP!";
        boardServerIp.classList.add("copied");
        setTimeout(() => {
          boardServerIp.textContent = `🌐 ${sAddress}`;
          boardServerIp.classList.remove("copied");
        }, 2000);
      } catch (_) {}
    });
  }

  if (boardDiscordJoinBtn) {
    boardDiscordJoinBtn.addEventListener("click", async () => {
      try {
        await invoke("open_connection", { connection: "discord_invite" });
      } catch (_) {
        window.open("https://discord.gg/8YCVeQgUVq", "_blank");
      }
    });
  }

  if (refreshServerBtn) {
    refreshServerBtn.addEventListener("click", updateServerBoard);
  }

  // Initial update and periodic 20s refresh
  updateServerBoard();
  window.setInterval(updateServerBoard, 20000);

  // Personalization & Theme Logic
  const applyTheme = (themeName) => {
    document.body.classList.remove("theme-gold", "theme-violet", "theme-emerald", "theme-crimson");
    if (themeName && themeName !== "cyan") {
      document.body.classList.add(`theme-${themeName}`);
    }
    themeChips.forEach(chip => {
      chip.classList.toggle("active", chip.dataset.theme === themeName);
    });
  };

  themeChips.forEach(chip => {
    chip.addEventListener("click", () => {
      applyTheme(chip.dataset.theme);
      saveLauncherConfig();
    });
  });

  if (chooseBgBtn && customBgInput) {
    chooseBgBtn.addEventListener("click", () => customBgInput.click());
  }

  if (customBgInput) {
    customBgInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const isVideo = file.type.startsWith("video/") || file.name.endsWith(".mp4");
      const url = URL.createObjectURL(file);

      if (customBgContainer) customBgContainer.style.display = "block";

      if (isVideo) {
        if (customBgImage) customBgImage.style.display = "none";
        if (customBgVideo) {
          customBgVideo.src = url;
          customBgVideo.style.display = "block";
          customBgVideo.play().catch(() => {});
        }
      } else {
        if (customBgVideo) {
          customBgVideo.style.display = "none";
          customBgVideo.pause();
        }
        if (customBgImage) {
          customBgImage.src = url;
          customBgImage.style.display = "block";
        }
      }

      if (customBgStatus) {
        customBgStatus.textContent = `Custom: ${file.name}`;
      }
    });
  }

  if (resetBgBtn) {
    resetBgBtn.addEventListener("click", () => {
      if (customBgContainer) customBgContainer.style.display = "none";
      if (customBgVideo) {
        customBgVideo.pause();
        customBgVideo.src = "";
        customBgVideo.style.display = "none";
      }
      if (customBgImage) {
        customBgImage.src = "";
        customBgImage.style.display = "none";
      }
      if (customBgStatus) {
        customBgStatus.textContent = "Current: Animated Realm Sky (Default)";
      }
      if (customBgInput) customBgInput.value = "";
    });
  }

  if (bgDimSlider && customBgDimmer && bgDimValue) {
    bgDimSlider.addEventListener("input", () => {
      const val = bgDimSlider.value;
      bgDimValue.textContent = `${val}%`;
      customBgDimmer.style.backgroundColor = `rgba(0, 0, 0, ${val / 100})`;
      saveLauncherConfig();
    });
  }

  if (bgBlurSlider && customBgDimmer && bgBlurValue) {
    bgBlurSlider.addEventListener("input", () => {
      const val = bgBlurSlider.value;
      bgBlurValue.textContent = `${val}px`;
      customBgDimmer.style.backdropFilter = `blur(${val}px)`;
      saveLauncherConfig();
    });
  }

  // Custom Audio Track Loader
  if (chooseAudioBtn && customAudioInput) {
    chooseAudioBtn.addEventListener("click", () => customAudioInput.click());
  }

  if (customAudioInput) {
    customAudioInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const url = URL.createObjectURL(file);
      launcherMusic.src = url;
      launcherMusic.play().catch(() => {});

      if (customAudioStatus) {
        customAudioStatus.textContent = `Custom Track: ${file.name}`;
      }
    });
  }

  if (resetAudioBtn) {
    resetAudioBtn.addEventListener("click", () => {
      launcherMusic.src = "./assets/launcher-music.mp3";
      launcherMusic.play().catch(() => {});
      if (customAudioStatus) {
        customAudioStatus.textContent = "Current: Palworld Orchestral Theme (Default)";
      }
      if (customAudioInput) customAudioInput.value = "";
    });
  }

  const saveLauncherConfig = async () => {
    try {
      const activeThemeChip = document.querySelector(".theme-chip.active");
      const currentTheme = activeThemeChip ? activeThemeChip.dataset.theme : "cyan";
      const dimVal = bgDimSlider ? parseFloat(bgDimSlider.value) : 0.0;
      const blurVal = bgBlurSlider ? parseFloat(bgBlurSlider.value) : 0.0;

      const config = {
        game_path: cachedGamePath || "",
        startup_flags: startupFlagsInput ? startupFlagsInput.value : "-dx12",
        server_address: serverAddressInput ? serverAddressInput.value : "beoul.duckdns.org:8211",
        server_password: serverPasswordInput ? serverPasswordInput.value : "0331BAZEEY",
        auto_connect: true,
        minimize_to_tray: trayToggle ? trayToggle.checked : true,
        close_on_game_launch: closeOnLaunchToggle ? closeOnLaunchToggle.checked : false,
        hardware_acceleration: hwAccelToggle ? hwAccelToggle.checked : true,
        disable_animations: animationsToggle ? animationsToggle.checked : false,
        auto_process_priority: autoPriorityToggle ? autoPriorityToggle.checked : true,
        auto_launch: autoLaunchToggle ? autoLaunchToggle.checked : false,
        auto_update_modpack: autoUpdateToggle ? autoUpdateToggle.checked : false,
        save_backup_directory: backupDirPathInput ? backupDirPathInput.value : "",
        custom_save_path: customSavePathInput ? customSavePathInput.value : "",
        optimize_engine_ini: true,
        custom_background_path: "",
        custom_audio_path: "",
        theme_accent: currentTheme,
        bg_dim_opacity: dimVal,
        bg_blur_radius: blurVal,
      };

      await invoke("update_launcher_config", { config });
    } catch (err) {
      console.warn("Failed to save launcher config:", err);
    }
  };

  const loadLauncherConfig = async () => {
    try {
      const config = await invoke("get_launcher_config");
      if (!config) {
        await initGamePathAndModpack(null);
        return;
      }

      if (config.game_path && !cachedGamePath) {
        cachedGamePath = config.game_path;
        pathDisplay.textContent = `Path: ${cachedGamePath}`;
        updateButton.disabled = false;
        try {
          setModpackReady(await invoke("verify_modpack", { gamePath: cachedGamePath }));
        } catch (_) {}
      }

      // Automatically auto-detect game path if not set yet
      if (!cachedGamePath) {
        try {
          const detected = await invoke("detect_palworld_path");
          if (detected) {
            cachedGamePath = detected;
            pathDisplay.textContent = `Path: ${cachedGamePath}`;
            updateButton.disabled = false;
            try {
              setModpackReady(await invoke("verify_modpack", { gamePath: cachedGamePath }));
            } catch (_) {}
            saveLauncherConfig();
          }
        } catch (_) {}
      }

      if (startupFlagsInput && config.startup_flags) {
        startupFlagsInput.value = config.startup_flags;
      }
      if (serverAddressInput && config.server_address) {
        serverAddressInput.value = config.server_address;
      }
      if (serverPasswordInput && config.server_password) {
        serverPasswordInput.value = config.server_password;
      }
      if (trayToggle) trayToggle.checked = config.minimize_to_tray;
      if (closeOnLaunchToggle && config.close_on_game_launch !== undefined) {
        closeOnLaunchToggle.checked = config.close_on_game_launch;
      }
      if (hwAccelToggle) hwAccelToggle.checked = config.hardware_acceleration;
      if (animationsToggle) {
        animationsToggle.checked = config.disable_animations;
        animationsDisabled = config.disable_animations;
        if (config.disable_animations) applyBackgroundMode();
      }
      if (autoPriorityToggle) autoPriorityToggle.checked = config.auto_process_priority;
      if (autoLaunchToggle) autoLaunchToggle.checked = config.auto_launch;
      if (autoUpdateToggle) autoUpdateToggle.checked = config.auto_update_modpack;
      if (backupDirPathInput && config.save_backup_directory) backupDirPathInput.value = config.save_backup_directory;
      if (customSavePathInput && config.custom_save_path) customSavePathInput.value = config.custom_save_path;

      if (config.theme_accent) {
        applyTheme(config.theme_accent);
      }
      if (bgDimSlider && config.bg_dim_opacity !== undefined) {
        bgDimSlider.value = config.bg_dim_opacity;
        if (bgDimValue) bgDimValue.textContent = `${config.bg_dim_opacity}%`;
        if (customBgDimmer) customBgDimmer.style.backgroundColor = `rgba(0, 0, 0, ${config.bg_dim_opacity / 100})`;
      }
      if (bgBlurSlider && config.bg_blur_radius !== undefined) {
        bgBlurSlider.value = config.bg_blur_radius;
        if (bgBlurValue) bgBlurValue.textContent = `${config.bg_blur_radius}px`;
        if (customBgDimmer) customBgDimmer.style.backdropFilter = `blur(${config.bg_blur_radius}px)`;
      }

      // Update Preset Chips
      updatePresetChipStates();

      // Silent Auto-Calibration on Initial Run if generic/empty flags
      if (!config.startup_flags || config.startup_flags === "-dx12" || config.startup_flags.trim() === "") {
        try {
          const profile = await invoke("calibrate_hardware_profile");
          if (profile && profile.recommended_flags) {
            activeCalibratedProfile = profile;
            if (startupFlagsInput) startupFlagsInput.value = profile.recommended_flags;
            updatePresetChipStates();
            await invoke("apply_calibrated_profile", { profile });
            populateCalibrationCard(profile);
            saveLauncherConfig();
          }
        } catch (_) {}
      }

      await initGamePathAndModpack(config);
    } catch (err) {
      console.warn("Failed to load launcher config:", err);
      await initGamePathAndModpack(null);
    }
  };

  function updatePresetChipStates() {
    if (!startupFlagsInput) return;
    const currentFlags = (startupFlagsInput.value || "").split(/\s+/).filter(Boolean);
    const chips = document.querySelectorAll(".preset-chip");
    chips.forEach((chip) => {
      const flag = chip.dataset.flag;
      if (!flag) return;
      const isActive = currentFlags.includes(flag);
      chip.classList.toggle("active", isActive);
      chip.textContent = isActive ? `✓ ${flag}` : `+ ${flag}`;
    });
  }

  // Preset Chips Click Handler
  document.querySelectorAll(".preset-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      if (!startupFlagsInput) return;
      const targetFlag = chip.dataset.flag;
      if (!targetFlag) return;

      let currentFlags = (startupFlagsInput.value || "").split(/\s+/).filter(Boolean);
      if (currentFlags.includes(targetFlag)) {
        currentFlags = currentFlags.filter((f) => f !== targetFlag);
      } else {
        // Prevent DX11 and DX12 renderer conflicts
        if (targetFlag === "-dx11") {
          currentFlags = currentFlags.filter((f) => f !== "-dx12");
        } else if (targetFlag === "-dx12") {
          currentFlags = currentFlags.filter((f) => f !== "-dx11");
        }
        currentFlags.push(targetFlag);
      }

      startupFlagsInput.value = currentFlags.join(" ");
      updatePresetChipStates();
      saveLauncherConfig();
    });
  });

  if (startupFlagsInput) {
    startupFlagsInput.addEventListener("input", () => {
      updatePresetChipStates();
      saveLauncherConfig();
    });
  }

  if (autoPriorityToggle) {
    autoPriorityToggle.addEventListener("change", () => {
      invoke("set_auto_process_priority", { enabled: autoPriorityToggle.checked });
      saveLauncherConfig();
    });
  }

  function populateCalibrationCard(profile) {
    if (!profile) return;
    if (calibrationCard) calibrationCard.style.display = "block";
    if (calibrationTierBadge) calibrationTierBadge.textContent = profile.tier_badge || "OPTIMIZED";
    if (calibrationTierTitle) calibrationTierTitle.textContent = profile.tier || "System Profile";
    if (calCpuName) calCpuName.textContent = profile.cpu_name || "--";
    if (calCpuThreads) calCpuThreads.textContent = `${profile.cpu_threads || "--"} Logical Cores`;
    if (calRamSize) calRamSize.textContent = `${profile.ram_gb || "--"} GB RAM`;
    if (calGpuName) calGpuName.textContent = profile.gpu_name || "--";
    if (calibrationSummary) calibrationSummary.textContent = `${profile.summary} (Streaming Pool: ${profile.recommended_pool_mb}MB | Startup Flags: ${profile.recommended_flags})`;
    if (calibrationStatus) calibrationStatus.textContent = "✓ Optimized Engine.ini & startup flags calibrated for your system.";
  }

  // Self-Calibrating System Optimizer
  const autoCalibrateBtn = document.querySelector("#auto-calibrate-btn");
  const quickAutoCalibrateBtn = document.querySelector("#quick-auto-calibrate-btn");
  const calibrationCard = document.querySelector("#calibration-card");
  const calibrationTierBadge = document.querySelector("#calibration-tier-badge");
  const calibrationTierTitle = document.querySelector("#calibration-tier-title");
  const calCpuName = document.querySelector("#cal-cpu-name");
  const calCpuThreads = document.querySelector("#cal-cpu-threads");
  const calRamSize = document.querySelector("#cal-ram-size");
  const calGpuName = document.querySelector("#cal-gpu-name");
  const calibrationSummary = document.querySelector("#calibration-summary");
  const calibrationStatus = document.querySelector("#calibration-status");
  const applyCalibrationBtn = document.querySelector("#apply-calibration-btn");

  let activeCalibratedProfile = null;

  const performAutoCalibration = async (btn) => {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "⏳ Scanning Hardware...";
    }
    if (calibrationCard) calibrationCard.style.display = "block";
    if (calibrationTierBadge) calibrationTierBadge.textContent = "ANALYZING...";
    if (calibrationTierTitle) calibrationTierTitle.textContent = "Scanning System Architecture...";
    if (calibrationStatus) calibrationStatus.textContent = "Probing CPU cores, RAM, and GPU capabilities...";

    try {
      const profile = await invoke("calibrate_hardware_profile");
      activeCalibratedProfile = profile;
      populateCalibrationCard(profile);

      // Auto-apply recommended startup flags and Engine.ini optimizations
      if (profile.recommended_flags && startupFlagsInput) {
        startupFlagsInput.value = profile.recommended_flags;
        updatePresetChipStates();
      }
      const msg = await invoke("apply_calibrated_profile", { profile });
      if (calibrationStatus) calibrationStatus.textContent = `✓ ${msg}`;
      saveLauncherConfig();
    } catch (err) {
      if (calibrationStatus) calibrationStatus.textContent = `Calibration error: ${err}`;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn === quickAutoCalibrateBtn ? "⚡ Auto-Detect Preset" : "⚡ Auto-Calibrate for My Hardware";
      }
    }
  };

  if (autoCalibrateBtn) {
    autoCalibrateBtn.addEventListener("click", () => performAutoCalibration(autoCalibrateBtn));
  }

  if (quickAutoCalibrateBtn) {
    quickAutoCalibrateBtn.addEventListener("click", () => performAutoCalibration(quickAutoCalibrateBtn));
  }

  if (applyCalibrationBtn) {
    applyCalibrationBtn.addEventListener("click", async () => {
      if (!activeCalibratedProfile) {
        try {
          activeCalibratedProfile = await invoke("calibrate_hardware_profile");
        } catch (e) {
          if (calibrationStatus) calibrationStatus.textContent = `Error: ${e}`;
          return;
        }
      }

      applyCalibrationBtn.disabled = true;
      if (calibrationStatus) calibrationStatus.textContent = "Applying calibrated profile...";

      try {
        const msg = await invoke("apply_calibrated_profile", { profile: activeCalibratedProfile });
        if (startupFlagsInput && activeCalibratedProfile.recommended_flags) {
          startupFlagsInput.value = activeCalibratedProfile.recommended_flags;
          updatePresetChipStates();
          saveLauncherConfig();
        }
        if (calibrationStatus) calibrationStatus.textContent = `✓ ${msg}`;
      } catch (err) {
        if (calibrationStatus) calibrationStatus.textContent = `Failed to apply profile: ${err}`;
      } finally {
        applyCalibrationBtn.disabled = false;
      }
    });
  }

  const resetEngineIniBtn = document.querySelector("#reset-engine-ini-btn");
  if (resetEngineIniBtn) {
    resetEngineIniBtn.addEventListener("click", async () => {
      resetEngineIniBtn.disabled = true;
      if (calibrationStatus) calibrationStatus.textContent = "Reverting Engine.ini...";
      try {
        const msg = await invoke("reset_engine_ini");
        if (calibrationStatus) calibrationStatus.textContent = `✓ ${msg}`;
      } catch (err) {
        if (calibrationStatus) calibrationStatus.textContent = `Reset failed: ${err}`;
      } finally {
        resetEngineIniBtn.disabled = false;
      }
    });
  }

  [autoLaunchToggle, autoUpdateToggle, closeOnLaunchToggle, trayToggle, serverAddressInput, serverPasswordInput, customSavePathInput, backupDirPathInput].forEach((el) => {
    if (el) {
      el.addEventListener("change", saveLauncherConfig);
      el.addEventListener("input", saveLauncherConfig);
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

  // Launcher Updater Integration (In-App Download & Relaunch)
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

  let activeUpdateObj = null;

  const executeInAppUpdate = async () => {
    if (updateInstallBtn) updateInstallBtn.disabled = true;
    if (updateProgressContainer) updateProgressContainer.style.display = "block";
    if (updateProgressFill) updateProgressFill.style.width = "40%";
    if (updateProgressText) updateProgressText.textContent = "Downloading update silently and patching binaries...";

    try {
      if (activeUpdateObj && typeof activeUpdateObj.downloadAndInstall === "function") {
        await activeUpdateObj.downloadAndInstall();
        if (updateProgressFill) updateProgressFill.style.width = "100%";
        if (updateProgressText) updateProgressText.textContent = "✓ Update patched successfully. Restarting...";

        // Restart launcher automatically into updated version
        try {
          if (window.__TAURI__?.process?.relaunch) {
            await window.__TAURI__.process.relaunch();
          } else {
            await invoke("plugin:process|restart");
          }
        } catch (_) {
          await invoke("download_and_install_launcher_update");
        }
        return;
      }

      // Check via plugin updater or invoke
      if (window.__TAURI__?.updater?.check) {
        const update = await window.__TAURI__.updater.check();
        if (update) {
          if (updateProgressFill) updateProgressFill.style.width = "60%";
          await update.downloadAndInstall();
          if (updateProgressFill) updateProgressFill.style.width = "100%";
          if (updateProgressText) updateProgressText.textContent = "✓ Patched successfully. Restarting...";
          if (window.__TAURI__?.process?.relaunch) {
            await window.__TAURI__.process.relaunch();
          } else {
            await invoke("plugin:process|restart");
          }
          return;
        }
      }

      // Native backend in-app updater fallback
      const msg = await invoke("download_and_install_launcher_update");
      if (updateProgressFill) updateProgressFill.style.width = "100%";
      if (updateProgressText) updateProgressText.textContent = `✓ ${msg}`;
    } catch (err) {
      console.error("Auto-updater failed:", err);
      if (updateProgressText) updateProgressText.textContent = `Error: ${err}`;
      if (updateInstallBtn) updateInstallBtn.disabled = false;
    }
  };

  const checkForLauncherUpdates = async (silent = true) => {
    if (launcherUpdateStatus && !silent) {
      launcherUpdateStatus.textContent = "Checking for updates...";
      launcherUpdateStatus.dataset.state = "pending";
    }

    try {
      // 1. Try plugin-updater check API first
      if (window.__TAURI__?.updater?.check) {
        const update = await window.__TAURI__.updater.check();
        if (update) {
          activeUpdateObj = update;
          if (updateVersionText) {
            updateVersionText.textContent = `New Version: v${update.version} (Current: v${update.currentVersion || "0.1.4"})`;
          }
          if (updateNotes) {
            updateNotes.textContent = update.body || "A new update for PalOlympics Launcher is ready to install.";
          }
          if (updateModal) {
            updateModal.style.display = "flex";
          }
          if (launcherUpdateStatus && !silent) {
            launcherUpdateStatus.textContent = `Update available: v${update.version}`;
            launcherUpdateStatus.dataset.state = "success";
          }
          return;
        }
      }

      // 2. Query backend check_for_launcher_updates
      const result = await invoke("check_for_launcher_updates");
      if (result && result.current_version) {
        const brandVersionEl = document.querySelector(".version");
        if (brandVersionEl) {
          brandVersionEl.textContent = `VER. ${result.current_version}`;
        }
      }
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
    updateInstallBtn.addEventListener("click", executeInAppUpdate);
  }

  // Load config from backend
  loadLauncherConfig();

  // Check for updates automatically on startup (non-blocking)
  checkForLauncherUpdates(true);

  const listenEvent = (eventName, callback) => {
    try {
      if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen) {
        return window.__TAURI__.event.listen(eventName, callback);
      }
    } catch (_) {}
    return Promise.resolve(() => {});
  };

  listenEvent("game-exited", () => {
    refreshGameStatus();
  });

  listenEvent("launcher-hidden-to-tray", () => {
    window.handleTrayHide();
  });

  listenEvent("launcher-restored-from-tray", () => {
    window.handleTrayRestore();
  });

  let statusInterval = window.setInterval(refreshGameStatus, 10000);
  document.addEventListener("visibilitychange", () => {
    applyBackgroundMode();
    if (document.hidden) {
      window.clearInterval(statusInterval);
      if (trayToggle && trayToggle.checked) {
        window.handleTrayHide();
      }
      return;
    }

    if (isHiddenInTray) {
      window.handleTrayRestore();
    }
    refreshGameStatus();
    statusInterval = window.setInterval(refreshGameStatus, 10000);
  });
  refreshGameStatus();
});
