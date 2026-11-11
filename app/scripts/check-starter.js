// Run before a build for friends (npm run dist:friends): that build carries starter-vault/ so setup can offer Make a
// new vault. It stops here if there is no starter, or if the starter is older than its review, which a person reads
// first (scripts/make-starter-vault.js writes both).
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const starter = path.join(root, "starter-vault"), review = path.join(root, "starter-vault-review.md");
if (!fs.existsSync(path.join(starter, ".starter-vault"))) {
  console.error("No starter vault. Make one first: node scripts/make-starter-vault.js <your vault>");
  process.exit(1);
}
if (!fs.existsSync(review)) {
  console.error("The starter has no review file next to it; rebuild it with scripts/make-starter-vault.js.");
  process.exit(1);
}
const lines = (fs.readFileSync(review, "utf8").match(/^- \d+:/gm) || []).length;
console.log(`Packing the starter vault. Its review lists ${lines} lines that name its owner: ${path.relative(root, review)}`);
