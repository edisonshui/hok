// apple-trust.js: the check that lets Windows and Linux stream the Aerials from Apple's server (23 Nov 2026).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { verifyChain } = require("../lib/apple-trust");

// sylvan.apple.com's chain as served on 23 Nov 2026: its own certificate, then Apple Server Authentication CA
const chain = fs.readFileSync(path.join(__dirname, "fixtures", "sylvan-chain.pem"), "utf8").match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
const when = new Date("2026-12-01T00:00:00Z");   // inside the server certificate's dates (Jul 2026 to Jan 2027)

test("Apple's real chain for its Aerial server passes", () => {
  assert.equal(chain.length, 2);
  assert.equal(verifyChain("sylvan.apple.com", chain, when), true);
});
test("the same chain for another host fails", () => {
  assert.equal(verifyChain("example.com", chain, when), false);
});
test("the server certificate alone fails: Apple Root CA did not sign it directly", () => {
  assert.equal(verifyChain("sylvan.apple.com", chain.slice(0, 1), when), false);
});
test("the chain in the wrong order fails", () => {
  assert.equal(verifyChain("sylvan.apple.com", [chain[1], chain[0]], when), false);
});
test("an expired chain fails", () => {
  assert.equal(verifyChain("sylvan.apple.com", chain, new Date("2027-06-01T00:00:00Z")), false);
});
test("every Aerial pick carries Apple's stream and preview links", () => {
  const picks = require("../lib/wallpaper-picks.json");
  for (const p of picks) {
    assert.match(p.url, /^https:\/\/sylvan\.apple\.com\/.+\.mov$/, p.name);
    assert.match(p.preview, /^https:\/\/sylvan\.apple\.com\/.+\.(png|jpg)$/, p.name);
  }
});
