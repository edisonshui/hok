// Renders build/icon.png (1024 px) from scripts/icon.html (the lantern in build/icon.svg); was the app's own
// fonts and light. electron-builder makes the .icns and .ico from it.
// Run: npx electron scripts/make-icon.js
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await win.loadFile(path.join(__dirname, "icon.html"));
  await new Promise((r) => setTimeout(r, 800));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.mkdirSync(path.join(__dirname, "..", "build"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "..", "build", "icon.png"), image.resize({ width: 1024, height: 1024 }).toPNG());
  app.quit();
});
