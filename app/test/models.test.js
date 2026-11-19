// The model choices in Settings come from the learner's account (lib/models.js).
const test = require("node:test");
const assert = require("node:assert");
const { codexModels, codexChoice, claudeModels } = require("../lib/models");

const m = (slug, priority, visibility = "list") => ({ slug, priority, visibility, display_name: slug, description: `${slug} says hi` });

test("Codex: the newest listed model of each family, hidden ones skipped", () => {
  const cache = [m("gpt-6.1-sol", 6), m("gpt-6.2-sol", 2), m("gpt-reserve", 5, "hide"), m("gpt-6-luna", 9), m("gpt-6.3-astra", 1, "hide")];
  assert.deepStrictEqual(codexModels(cache).map((x) => [x.id, x.slug]), [["sol", "gpt-6.2-sol"], ["luna", "gpt-6-luna"]]);
});

test("Codex: no cache file means the built-in list", () => {
  assert.deepStrictEqual(codexModels(null).map((x) => x.id), ["sol", "astra", "terra", "luna"]);
});

test("Codex: a 0.2.6 saved slug still means its family", () => {
  assert.strictEqual(codexChoice("gpt-6.1-sol"), "sol");
  assert.strictEqual(codexChoice("gpt-6-luna"), "luna");
  assert.strictEqual(codexChoice(undefined), "sol");
});

test("Claude: availableModels and deniedModels narrow the list, Haiku always stays", () => {
  assert.deepStrictEqual(claudeModels([]).map((x) => x.id), ["sonnet", "opus", "haiku"]);
  assert.deepStrictEqual(claudeModels([{ availableModels: ["claude-sonnet-5"] }]).map((x) => x.id), ["sonnet", "haiku"]);
  assert.deepStrictEqual(claudeModels([{ deniedModels: ["opus"] }, {}]).map((x) => x.id), ["sonnet", "haiku"]);
});
