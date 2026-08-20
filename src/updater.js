import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

/**
 * Executes the in-app update sequence:
 * 1. Checks for updates using native Tauri plugin updater
 * 2. Downloads and patches the binary in place internally (zero browser prompts)
 * 3. Restarts the launcher into the updated version automatically
 */
export async function handleInAppUpdate(callbacks = {}) {
  try {
    if (typeof callbacks.onChecking === 'function') callbacks.onChecking();
    const update = await check();

    if (update) {
      if (typeof callbacks.onUpdateFound === 'function') {
        callbacks.onUpdateFound(update);
      }
      if (typeof callbacks.onProgress === 'function') {
        callbacks.onProgress('Downloading update silently and patching binaries...');
      }

      // Downloads and patches the binary in place internally
      await update.downloadAndInstall((event) => {
        if (typeof callbacks.onDownloadEvent === 'function') {
          callbacks.onDownloadEvent(event);
        }
      });

      if (typeof callbacks.onInstalled === 'function') {
        callbacks.onInstalled();
      }

      // Restarts the launcher into the updated version
      await relaunch();
      return true;
    } else {
      if (typeof callbacks.onUpToDate === 'function') {
        callbacks.onUpToDate();
      }
      console.log('App is up to date.');
      return false;
    }
  } catch (error) {
    console.error('Auto-updater failed:', error);
    if (typeof callbacks.onError === 'function') {
      callbacks.onError(error);
    }
    throw error;
  }
}

export { check, relaunch };
