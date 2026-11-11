// The app was called Obsidian Learning until 11 Nov 2026, when Edison named it Hok (學, "learn" in Cantonese). The
// computer keeps the app's settings, wallpaper copies, speech model and page storage in a folder named after the app,
// so the first launch as Hok takes that folder over. It moves only the default profile (a test's --user-data-dir is
// never touched), never over a profile Hok already has, and copies instead of moving while the old app is open.
const fs = require("fs");
const path = require("path");

const OLD_NAME = "Obsidian Learning";
const present = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };   // lstat: the lock is a symlink, often dangling

function moveOldData(appData, userData) {
  if (path.dirname(path.resolve(userData)) !== path.resolve(appData)) return "custom profile";
  const old = path.join(appData, OLD_NAME);
  if (path.resolve(old) === path.resolve(userData)) return "same folder";
  if (present(path.join(userData, "config.json"))) return "already has settings";
  if (!present(path.join(old, "config.json"))) return "nothing to move";
  const open = ["SingletonLock", "SingletonSocket", "SingletonCookie"].some((f) => present(path.join(old, f)));
  if (open || present(userData)) {
    fs.cpSync(old, userData, { recursive: true, force: false, errorOnExist: false, filter: (s) => !/^Singleton/.test(path.basename(s)) });
    return "copied";
  }
  fs.renameSync(old, userData);
  return "moved";
}

module.exports = { moveOldData, OLD_NAME };
