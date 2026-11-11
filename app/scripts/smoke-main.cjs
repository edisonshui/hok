// Loaded into the app's main process by scripts/smoke.mjs only. The tutor's terminal is a stub (no tutor is started
// and nothing is spent), and the folder dialog answers with SMOKE_PARENT, so a test can press "Make a new vault".
const { ipcMain, dialog } = require("electron");
const handle = ipcMain.handle.bind(ipcMain), on = ipcMain.on.bind(ipcMain);
ipcMain.handle = (ch, fn) => handle(ch, ch === "pty:start" ? () => ({ running: true }) : ch === "pty:running" ? () => true : ch === "pty:stop" ? () => true : fn);
ipcMain.on = (ch, fn) => on(ch, ch === "pty:write" || ch === "pty:resize" ? () => {} : fn);
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [process.env.SMOKE_PARENT] });
