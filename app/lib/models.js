// Which models the tutor can run on, for Settings > Tutor > Model (19 Nov, Edison: the options "actually reflect what
// models the user has available").
//
// Codex keeps the list its server sent for the signed-in account in ~/.codex/models_cache.json (or $CODEX_HOME), and
// refreshes it when it starts. Hok offers one choice per family (Sol, Astra, Terra, Luna), each the newest model of that
// family the account lists, and saves the family, so "Sol" moves to a new Sol when Codex lists one, the way Claude Code's
// `sonnet` alias does. Without the file (Codex never started yet), the families fall back to the models Codex listed on
// 18 Nov 2026.
const fs = require("fs");
const os = require("os");
const path = require("path");

const FAMILIES = ["sol", "astra", "terra", "luna"];
const FALLBACK = { sol: "gpt-6.2-sol", astra: "gpt-6.2-astra", terra: "gpt-6.1-terra", luna: "gpt-6-luna" };
const familyOf = (slug) => FAMILIES.find((f) => new RegExp(`(^|[-.])${f}$`).test(String(slug || "")));

function readCodexCache(home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex")) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(home, "models_cache.json"), "utf8"));
    return Array.isArray(data.models) ? data.models : null;
  } catch { return null; }
}

// [{ id: family, slug, name, description }], newest of each family first by Codex's own priority, in family order.
function codexModels(cache = readCodexCache()) {
  if (!cache) return FAMILIES.map((f) => ({ id: f, slug: FALLBACK[f], name: null, description: null }));
  const listed = cache.filter((m) => m && m.slug && m.visibility === "list").sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
  return FAMILIES.map((f) => listed.find((m) => familyOf(m.slug) === f)).filter(Boolean)
    .map((m) => ({ id: familyOf(m.slug), slug: m.slug, name: m.display_name || m.slug, description: m.description || null }));
}

// A saved choice from before families (0.2.6 saved "gpt-6.1-sol") still means its family.
const codexChoice = (saved) => (FAMILIES.includes(saved) ? saved : familyOf(saved) || "sol");

// Claude Code has no command that lists an account's models (its docs, checked 19 Nov 2026). Every plan that runs
// Claude Code gets Sonnet and Opus by default, and "Haiku models are always available and can't be disabled". What can
// narrow the list is an `availableModels` or `deniedModels` setting: an organization's managed settings, or the
// learner's own settings.json. An entry names a family ("opus"), a version prefix ("claude-opus-5") or a full model id.
const CLAUDE = ["sonnet", "opus", "haiku"];
const MANAGED = { darwin: "/Library/Application Support/ClaudeCode/managed-settings.json", linux: "/etc/claude-code/managed-settings.json",
  win32: "C:\\Program Files\\ClaudeCode\\managed-settings.json" };
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function claudeSettings(platform = process.platform, home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude")) {
  return [readJson(MANAGED[platform] || MANAGED.linux), readJson(path.join(home, "settings.json"))].filter(Boolean);
}
const names = (entry, family) => typeof entry === "string" && entry.toLowerCase().includes(family);
function claudeModels(settings = claudeSettings()) {
  return CLAUDE.filter((family) => {
    if (family === "haiku") return true;
    for (const s of settings) {
      if (Array.isArray(s.deniedModels) && s.deniedModels.some((e) => String(e).toLowerCase() === family)) return false;
      if (Array.isArray(s.availableModels) && !s.availableModels.some((e) => names(e, family))) return false;
    }
    return true;
  }).map((id) => ({ id }));
}

module.exports = { codexModels, codexChoice, claudeModels, familyOf, readCodexCache, FAMILIES };
