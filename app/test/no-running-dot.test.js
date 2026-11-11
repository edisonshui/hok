// The sidebar's "running" dot came back once after it was taken out (Edison flagged it on 7 Nov twice). The app draws
// no dot beside a subject: this fails if its markup or its style returns.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", "renderer", f), "utf8");

test("no running dot in the sidebar markup", () => {
  assert.doesNotMatch(read("app.js"), /<i class="live"|class=\\?"live\\?"|aria-label="Session running"/);
});
test("no style for a running dot", () => {
  assert.doesNotMatch(read("styles.css"), /(^|[\s,}])\.live\s*\{/m);
});
