// What the app needs from the learner's machine: their shell's PATH, Python 3,
// and the tutor's command (claude or codex). An app opened from the Dock gets a
// bare PATH, so `claude` in ~/.local/bin or Python from Homebrew would look
// missing without asking the login shell first.

const { execFile, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const isWin = process.platform === "win32";

function loginShell() {
  if (isWin) return process.env.ComSpec || "cmd.exe";
  return process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
}

// The PATH an interactive login shell would have. Falls back to the app's own
// PATH plus the usual install folders if the shell is slow or prints noise.
function shellPath() {
  const fallback = [process.env.PATH, path.join(os.homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"]
    .filter(Boolean).join(path.delimiter);
  if (isWin) return Promise.resolve(process.env.PATH || "");
  return new Promise((resolve) => {
    const marker = "__FLASH_PATH__";
    execFile(loginShell(), ["-ilc", `printf '${marker}%s${marker}' "$PATH"`], { timeout: 5000, env: process.env },
      (error, stdout) => {
        const m = String(stdout || "").match(new RegExp(`${marker}(.*)${marker}`));
        resolve(m && m[1] ? m[1] : fallback);
      });
  });
}

function which(name, PATH) {
  const exts = isWin ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of String(PATH || "").split(path.delimiter)) {
    for (const ext of exts) {
      const full = path.join(dir, name + ext);
      try {
        if (fs.statSync(full).isFile()) return full;
      } catch { /* not here */ }
    }
  }
  return null;
}

function pythonRuns(file, PATH) {
  try {
    const out = execFileSync(file, ["-c", "import sys; print(sys.version_info[0] * 100 + sys.version_info[1])"], { env: { ...process.env, PATH }, timeout: 8000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    return Number(String(out).trim()) >= 308;
  } catch { return false; }
}

// Each missing piece names what is missing and how to install it.
function checkTools(PATH, host) {
  const problems = [];
  // A file named python3 is not enough: a fresh Mac has a stub that only opens Apple's installer, and Windows has a
  // Store alias that opens the Store. Python counts once it runs and is 3.8 or newer (what the vault's hooks need).
  const python = ["python3", "python"].map((n) => which(n, PATH)).find((f) => f && pythonRuns(f, PATH)) || null;
  if (!python) {
    problems.push({
      what: "Python 3 is not installed",
      fix: process.platform === "darwin"
        ? "Open Terminal, run xcode-select --install, and accept the install (or install Python from python.org). Then click Check again."
        : isWin ? "Install Python 3 from python.org and tick \"Add python.exe to PATH\" in its installer. Then click Check again."
        : "Install Python 3 with your package manager (for example sudo apt install python3). Then click Check again.",
    });
  }
  const tutor = which(host, PATH);
  if (!tutor) {
    problems.push({
      what: host === "codex" ? "The codex command is not installed" : "The claude command is not installed",
      fix: host === "codex"
        ? "Install Codex with npm install -g @openai/codex (this needs Node.js from nodejs.org), run codex login once in a terminal, then click Check again."
        : "Install Claude Code from claude.com/claude-code, run claude once in a terminal and sign in, then click Check again.",
    });
  }
  return { python, tutor, problems };
}

// A folder is a vault if it holds the records and the status script.
function checkVault(dir) {
  if (!dir) return "No folder chosen.";
  if (!fs.existsSync(path.join(dir, "learn"))) return "This folder has no learn/ folder, so it is not a learning vault.";
  if (!fs.existsSync(path.join(dir, ".claude", "hooks", "learn-status.py"))) {
    return "This folder has no .claude/hooks/learn-status.py. Use a copy of the learning vault repo.";
  }
  return null;
}

module.exports = { shellPath, which, checkTools, checkVault, loginShell };
