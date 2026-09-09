// sp-env name resolver — THE one algorithm that turns logical names into URLs/paths.
// Used by all tools (provision, verify, deploy, run-harness). CommonJS, no deps.
//
// Algorithm:
//   1. env comes from env.local.json ("dev" | "prod"). env.local.json is REQUIRED.
//   2. Site: env.json's "site" alias (only "primary" is defined; default "primary")
//      resolves to tenants.local.json[env].siteUrl when the global skill is present
//      (dev machines — authoritative). On machines without tenants.local.json
//      (prod), env.local.json must supply siteUrl and roots.
//   3. Empty-string / empty-object / null local values are treated as OMITTED.
//      Where tenants.local.json exists it is AUTHORITATIVE: any explicitly
//      supplied local siteUrl/root/mirror that disagrees with it (or adds an
//      unknown key) is a hard error — locals never silently override.
//   4. Roots AND manifest paths must be safe relative paths: no URLs, no drive
//      letters, no leading slash, no "..", no percent-encoding (rejected outright
//      after stable decode), no backslashes.
//   5. Mirrors: authoritative global per-root paths; locals only fill gaps when
//      no global skill exists.
//   6. Containment is enforced on the WHATWG-URL-normalized result: same origin,
//      and pathname inside the site path on a segment boundary.
'use strict';
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

function stripSlash(u) { return String(u || '').replace(/\/+$/, ''); }

function decodeStable(p, label) {
  let cur = String(p);
  for (let i = 0; i < 10; i++) {
    let next;
    try { next = decodeURIComponent(cur); } catch (e) { throw new Error(label + ': malformed percent-encoding in "' + p + '"'); }
    if (next === cur) return cur;
    cur = next;
  }
  throw new Error(label + ': percent-encoding does not stabilize in "' + p + '"');
}

function assertSafeRelPath(p, label) {
  if (typeof p !== 'string' || p.length === 0) throw new Error(label + ': path must be a non-empty string');
  // Manifest/config paths are plain names: any percent character is rejected
  // outright (encoded separators/dot segments have no legitimate use here).
  if (/%/.test(p)) throw new Error(label + ': percent characters not allowed in manifest paths: "' + p + '"');
  // Control characters are rejected outright: the WHATWG URL parser STRIPS
  // tab/CR/LF, so ".\n." would normalize to ".." after our segment checks ran.
  if (/[\x00-\x1f\x7f]/.test(p)) throw new Error(label + ': control characters not allowed in manifest paths: ' + JSON.stringify(p));
  // ? and # would be parsed as query/fragment and silently dropped from the
  // resolved URL — an aliasing hazard, so they are rejected too.
  if (/[?#]/.test(p)) throw new Error(label + ': "?" and "#" not allowed in manifest paths: "' + p + '"');
  const decoded = decodeStable(p, label); // defense-in-depth; also catches malformed input
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded)) throw new Error(label + ': absolute URL/scheme not allowed: "' + p + '"');
  if (/^[a-zA-Z]:[\\/]/.test(decoded)) throw new Error(label + ': drive path not allowed: "' + p + '"');
  if (/\\/.test(decoded)) throw new Error(label + ': backslashes not allowed; use forward slashes: "' + p + '"');
  if (/^\//.test(decoded)) throw new Error(label + ': leading slash not allowed; paths are root-relative: "' + p + '"');
  const segs = decoded.split('/');
  if (segs.some((s) => s === '..' || s === '.')) throw new Error(label + ': path traversal not allowed: "' + p + '"');
  if (segs.some((s) => s.length === 0)) throw new Error(label + ': empty path segment in "' + p + '"');
  return decoded;
}

// Treat '' / null / {} / _comment keys as "not supplied".
function pruneEmpty(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === '_comment') continue;
    if (v === null || v === undefined || v === '') continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

// Where an authoritative map exists, explicit local entries must agree with it.
function mergeAuthoritative(globalMap, localMap, what, comparator) {
  const g = pruneEmpty(globalMap);
  const l = pruneEmpty(localMap);
  if (g && l) {
    for (const [k, v] of Object.entries(l)) {
      if (!(k in g)) throw new Error('Conflict: env.local.json ' + what + '.' + k + ' is not defined in authoritative tenants.local.json — remove it or fix the global file.');
      if (!comparator(g[k], v)) throw new Error('Conflict: env.local.json ' + what + '.' + k + ' ("' + v + '") differs from authoritative tenants.local.json ("' + g[k] + '") — locals never override; refusing to guess.');
    }
    return g;
  }
  return g || l;
}

const eqPath = (a, b) => String(a).replace(/[\\/]+$/, '').toLowerCase() === String(b).replace(/[\\/]+$/, '').toLowerCase();

function resolveTarget(envJson, envLocal, tenants /* may be null on prod machines */) {
  if (!envLocal || typeof envLocal !== 'object') throw new Error('env.local.json is required (gitignored, per machine) — refusing to run without it.');
  const env = envLocal.env;
  if (env !== 'dev' && env !== 'prod') throw new Error('env.local.json "env" must be "dev" or "prod", got: ' + JSON.stringify(env));

  const tEnv = tenants ? tenants[env] : null;
  if (tenants && !tEnv) throw new Error('tenants.local.json has no "' + env + '" section');

  const siteAlias = envJson.site === undefined ? 'primary' : envJson.site;
  if (siteAlias !== 'primary') throw new Error('env.json "site" must be the alias "primary" (got "' + siteAlias + '"); real URLs never appear in manifests.');

  let siteUrl;
  const localSite = envLocal.siteUrl && envLocal.siteUrl !== '' ? envLocal.siteUrl : null;
  if (tEnv) {
    siteUrl = stripSlash(tEnv.siteUrl);
    if (localSite && stripSlash(localSite).toLowerCase() !== siteUrl.toLowerCase()) {
      throw new Error('Conflict: env.local.json siteUrl (' + localSite + ') differs from tenants.local.json ' + env + ' siteUrl — fix one; refusing to guess.');
    }
  } else {
    if (!localSite) throw new Error('No tenants.local.json on this machine — env.local.json must supply siteUrl.');
    siteUrl = stripSlash(localSite);
  }

  const roots = mergeAuthoritative(tEnv && tEnv.roots, envLocal.roots, 'roots', eqPath);
  if (!roots) throw new Error('No roots available (tenants.local.json ' + env + '.roots or env.local.json roots).');
  for (const [k, v] of Object.entries(roots)) assertSafeRelPath(v, 'roots.' + k);

  const mirrors = mergeAuthoritative(tenants && tenants.mirrors, envLocal.mirrors, 'mirrors', eqPath) || {};

  const siteBase = new URL(siteUrl + '/');

  function resolveEntry(entry, label, defaultRoot) {
    const rootKey = entry.root || defaultRoot;
    if (!rootKey) throw new Error(label + ': no "root" specified and no default applies');
    const rootPath = roots[rootKey];
    if (rootPath === undefined) {
      throw new Error(label + ': unknown root "' + rootKey + '" (known: ' + Object.keys(roots).join(', ') + ')');
    }
    const rel = assertSafeRelPath(entry.path, label);
    // Build via WHATWG URL so any normalization the transport would apply is applied
    // BEFORE containment is checked. Containment is enforced at BOTH boundaries:
    // the site (origin + pathname prefix) and the selected root — a normalized
    // result may not escape either.
    const rootBase = new URL(stripSlash(rootPath) + '/', siteBase);
    const target = new URL(stripSlash(rootPath) + '/' + rel, siteBase);
    if (target.origin !== siteBase.origin) throw new Error(label + ': resolved URL left the site origin — refusing.');
    if (!(target.pathname + '/').startsWith(siteBase.pathname)) throw new Error(label + ': resolved URL escaped the selected environment site — refusing.');
    if (rootBase.origin !== siteBase.origin || !(rootBase.pathname + '/').startsWith(siteBase.pathname)) throw new Error(label + ': configured root escaped the site — refusing.');
    if (!(target.pathname + '/').startsWith(rootBase.pathname)) throw new Error(label + ': resolved URL escaped the "' + rootKey + '" root — refusing.');
    const out = { root: rootKey, path: rel, url: target.origin + target.pathname };
    if (mirrors[rootKey]) out.mirror = path.win32.join(mirrors[rootKey], rel.replace(/\//g, '\\'));
    return out;
  }

  const libraries = {};
  for (const [name, entry] of Object.entries(envJson.libraries || {})) {
    libraries[name] = resolveEntry(entry, 'libraries.' + name, null);
  }
  const pages = {};
  for (const [name, entry] of Object.entries(envJson.pages || {})) {
    // loader is appended to the scripts-library URL and lands in executable
    // page markup — it gets the same validation as every manifest path.
    if (entry.loader !== undefined) assertSafeRelPath(entry.loader, 'pages.' + name + '.loader');
    pages[name] = Object.assign({}, entry, resolveEntry(entry, 'pages.' + name, 'sitePages'));
  }

  return { project: envJson.project || '', env: env, siteUrl: siteUrl, roots: roots, mirrors: mirrors, libraries: libraries, pages: pages, lists: envJson.lists || {}, flows: envJson.flows || [], deploy: envJson.deploy || {} };
}

function defaultSpEnvDir() {
  // Works both from the installed skill (scripts/..) and from a copy stamped
  // into a repo's tools/sp/ — falls back to the installed global skill.
  const os = require('os');
  const candidates = [path.resolve(__dirname, '..'), path.join(os.homedir(), '.claude', 'skills', 'sp-env')];
  for (const c of candidates) { if (fs.existsSync(path.join(c, 'tenants.local.json'))) return c; }
  return candidates[0];
}

function loadAndResolve(repoDir, spEnvDir) {
  spEnvDir = spEnvDir || defaultSpEnvDir();
  const envJsonPath = path.join(repoDir, 'env.json');
  const envLocalPath = path.join(repoDir, 'env.local.json');
  if (!fs.existsSync(envJsonPath)) throw new Error('env.json missing at ' + envJsonPath);
  if (!fs.existsSync(envLocalPath)) throw new Error('env.local.json missing at ' + envLocalPath + ' — refusing to run (copy env.local.example.json and fill it in).');
  const envJson = JSON.parse(fs.readFileSync(envJsonPath, 'utf8'));
  const envLocal = JSON.parse(fs.readFileSync(envLocalPath, 'utf8'));
  const tenantsPath = path.join(spEnvDir, 'tenants.local.json');
  const tenants = fs.existsSync(tenantsPath) ? JSON.parse(fs.readFileSync(tenantsPath, 'utf8')) : null;
  return resolveTarget(envJson, envLocal, tenants);
}

module.exports = { resolveTarget, loadAndResolve, assertSafeRelPath };

if (require.main === module) {
  const repoDir = process.argv[2] || process.cwd();
  try {
    console.log(JSON.stringify(loadAndResolve(repoDir), null, 2));
  } catch (e) {
    console.error('RESOLVE-FAIL ' + String(e && e.message ? e.message : e));
    process.exit(1);
  }
}
