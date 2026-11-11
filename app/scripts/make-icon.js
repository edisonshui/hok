// Renders Hok's icon from the stone lantern (build/icon-night.svg and build/icon-day.svg, teal, from the icon round
// Edison picked on 9 Nov). build/icon.png is the classic 1024 px icon (the night lantern on its tile), from which
// electron-builder makes the .icns and .ico. build/Hok.icon holds the same lantern full-bleed by day and by night, so
// macOS 26 shows the night lantern in Dark Mode and the day one in Light Mode, even while the app is closed.
// Run: npx electron scripts/make-icon.js
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const build = path.join(__dirname, "..", "build");
let win = null;
// full-bleed art is backed by its tile's own gradient, so no clear sliver shows inside the shape macOS cuts
const bgOf = (svg) => { const t = fs.readFileSync(path.join(build, svg), "utf8"), m = t.match(/<linearGradient id="bg"[^>]*>\s*<stop[^>]*stop-color="([^"]+)"[^>]*\/>\s*<stop[^>]*stop-color="([^"]+)"/); return m ? `linear-gradient(${m[1]},${m[2]})` : "transparent"; };
app.on("window-all-closed", () => {});   // one hidden window draws all three; closing it must not quit early
async function shot(svg, fullBleed) {
  win = win || new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  // full-bleed: the tile (98 to 926 px of the 1024 canvas) is scaled to fill it; macOS cuts its own rounded shape
  const s = fullBleed ? 1024 / 828 : 1, off = fullBleed ? -98 * s : 0;
  const page = path.join(build, ".icon-page.html");   // a page beside the art, so it may load it
  fs.writeFileSync(page, `<!doctype html><style>html,body{margin:0;width:1024px;height:1024px;overflow:hidden;background:${fullBleed ? bgOf(svg) : "transparent"}}img{position:absolute;left:${off}px;top:${off}px;width:${1024 * s}px;height:${1024 * s}px}</style><img src="${svg}">`);
  await win.loadFile(page);
  await new Promise((r) => setTimeout(r, 600));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.rmSync(page, { force: true });
  return image.resize({ width: 1024, height: 1024 }).toPNG();
}
app.whenReady().then(async () => {
  fs.writeFileSync(path.join(build, "icon.png"), await shot("icon-night.svg", false));
  const assets = path.join(build, "Hok.icon", "Assets"); fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(assets, "lantern-day.png"), await shot("icon-day.svg", true));
  fs.writeFileSync(path.join(assets, "lantern-night.png"), await shot("icon-night.svg", true));
  app.quit();
});
