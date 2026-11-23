// Apple's Aerial server (sylvan.apple.com) on Windows and Linux (23 Nov 2026). Its certificate comes from Apple's own
// root, "Apple Root CA", which Chromium's root store and Node's bundled list both leave out, so a stream or a
// thumbnail from it fails there. On a Mac, macOS answers (wallpaper.js asks `security verify-cert`). Elsewhere this
// module checks the chain itself against that one root, carried in apple-root-ca.pem (SHA-256 fingerprint
// B0:B1:73:0E:...:F0:24, read from macOS's system roots on 23 Nov), and only for that one host.
const fs = require("fs");
const path = require("path");
const https = require("https");
const { X509Certificate } = require("crypto");

const HOST = "sylvan.apple.com";
const ROOT_PEM = fs.readFileSync(path.join(__dirname, "apple-root-ca.pem"), "utf8");
const ROOT = new X509Certificate(ROOT_PEM);
const ROOT_FP = "B0:B1:73:0E:CB:C7:FF:45:05:14:2C:49:F1:29:5E:6E:DA:6B:CA:ED:7E:2C:68:C5:BE:91:B5:A1:10:01:F0:24";
if (ROOT.fingerprint256 !== ROOT_FP) throw new Error("apple-root-ca.pem is not Apple Root CA");

const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ""; } };

// The chain as PEM strings, the server's own certificate first. True only when every certificate is in date, each
// one is signed by the next, every one past the first is a CA, the last is signed by (or is) Apple Root CA, and the
// first names this host.
function verifyChain(host, pems, now = new Date()) {
  if (host !== HOST || !Array.isArray(pems) || !pems.length || pems.length > 5) return false;
  let certs; try { certs = pems.map((p) => new X509Certificate(p)); } catch { return false; }
  if (certs[certs.length - 1].fingerprint256 === ROOT_FP) certs = certs.slice(0, -1);   // the root itself, if sent
  if (!certs.length) return false;
  const inDate = (c) => new Date(c.validFrom) <= now && now <= new Date(c.validTo);
  if (!certs.every(inDate)) return false;
  if (!certs[0].checkHost(host)) return false;
  for (let i = 0; i < certs.length; i++) {
    const issuer = certs[i + 1] || ROOT;
    if (i > 0 && !certs[i].ca) return false;
    if (!certs[i].checkIssued(issuer) || !certs[i].verify(issuer.publicKey)) return false;
  }
  return true;
}

// Electron's certificate-error hands over the server's certificate with its issuers linked by issuerCert.
function trustElectronCert(url, cert) {
  const pems = []; for (let c = cert, i = 0; c && c.data && i < 5; c = c.issuerCert, i++) pems.push(c.data);
  return verifyChain(hostOf(url), pems);
}

// A small file from Apple's server (a thumbnail), saved to out. Node checks the chain against Apple Root CA alone.
function download(url, out, { timeout = 15000, maxBytes = 4 << 20 } = {}) {
  return new Promise((resolve) => {
    if (hostOf(url) !== HOST || !url.startsWith("https://")) return resolve(null);
    const req = https.get(url, { ca: ROOT_PEM, timeout }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const parts = []; let n = 0;
      res.on("data", (b) => { n += b.length; if (n > maxBytes) req.destroy(); else parts.push(b); });
      res.on("end", () => { try { fs.writeFileSync(out + ".part", Buffer.concat(parts)); fs.renameSync(out + ".part", out); resolve(out); } catch { resolve(null); } });
      res.on("error", () => resolve(null));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}

module.exports = { verifyChain, trustElectronCert, download, HOST };
