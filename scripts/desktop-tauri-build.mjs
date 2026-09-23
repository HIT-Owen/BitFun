#!/usr/bin/env node
/** Runs `tauri build` from src/apps/desktop with CI=true. */
import { spawnSync, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'path';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs';
import { ensureFlashgrepBinary } from './prepare-flashgrep-resource.mjs';
import { extractProductConfigArg } from './product-customization/cli.mjs';
import { productBuildEnvironment } from './product-customization/projections.mjs';
import { resolveProductDefinition } from './product-customization/resolver.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LINUX_FLASHGREP_BINARIES = [
  'flashgrep-x86_64-unknown-linux-musl',
  'flashgrep-x86_64-unknown-linux-gnu',
  'flashgrep-aarch64-unknown-linux-musl',
  'flashgrep-aarch64-unknown-linux-gnu',
];

function tauriBuildArgsFromArgv() {
  const args = process.argv.slice(2);
  // `node script.mjs -- --foo` leaves a leading `--`; strip so `tauri build` sees the same argv as before.
  let i = 0;
  while (i < args.length && args[i] === '--') {
    i += 1;
  }
  return args.slice(i);
}

async function main() {
  const { productConfig, forwardArgs: forward } = extractProductConfigArg(tauriBuildArgsFromArgv());
  const resolution = resolveProductDefinition({ rootDir: ROOT, productConfig, member: 'desktop' });
  Object.assign(process.env, productBuildEnvironment(resolution));
  console.log(`[product] ${resolution.assembly.member} ${resolution.assembly.assemblyDigest}`);

  const flashgrepBinary = ensureFlashgrepBinary();
  process.env.FLASHGREP_DAEMON_BIN = flashgrepBinary;

  const desktopDir = join(ROOT, 'src', 'apps', 'desktop');
  // Tauri CLI reads CI and rejects numeric "1" (common in CI providers).
  process.env.CI = 'true';

  const tauriConfig = prepareTauriConfig(join(desktopDir, 'tauri.conf.json'), {
    desktopDir,
    flashgrepBinary,
    resolution,
  });
  const tauriBin = join(ROOT, 'node_modules', '.bin', 'tauri');
  const tauriArgs = ['build', '--config', tauriConfig, ...forward];
  const buildStartedAtMs = Date.now();
  let r = runTauriBuild(tauriBin, tauriArgs, desktopDir);

  if (!r.error && shouldRetryMacDmgBuild(r, forward, desktopDir, buildStartedAtMs)) {
    console.warn(
      '[tauri-build] DMG bundling failed after the macOS app bundle was created; retrying once in 10 seconds.'
    );
    await new Promise((resolveRetry) => setTimeout(resolveRetry, 10_000));
    r = runTauriBuild(tauriBin, tauriArgs, desktopDir);
  }

  if (r.error) {
    console.error(r.error);
    process.exit(1);
  }

  if (r.status === 0 && process.platform === 'darwin') {
    patchDmgExtras(ROOT);
  }

  if (r.status === 0) {
    try {
      stampLocalBundleArtifacts({
        args: forward,
        buildStartedAtMs,
        desktopDir,
      });
    } catch (error) {
      console.warn(`[tauri-build] bundle stamping skipped: ${error.message || String(error)}`);
    }
  }

  // Keep only the latest useful Cargo caches for this build profile after tauri build ends.
  try {
    const { profileFromTauriBuildArgs, runGcBestEffort, targetFromTauriBuildArgs } = await import(
      './cargo-target-gc.mjs'
    );
    runGcBestEffort({
      rootDir: ROOT,
      profile: profileFromTauriBuildArgs(forward),
      triple: targetFromTauriBuildArgs(forward),
    });
  } catch (error) {
    console.warn(`[target-gc] skipped: ${error.message || String(error)}`);
  }

  process.exit(r.status ?? 1);
}

function runTauriBuild(tauriBin, args, desktopDir) {
  return spawnSync(tauriBin, args, {
    cwd: desktopDir,
    env: process.env,
    stdio: 'inherit',
    shell: true,
  });
}

export function shouldRetryMacDmgBuild(
  result,
  args,
  desktopDir,
  buildStartedAtMs,
  runtime = {}
) {
  const platform = runtime.platform ?? process.platform;
  const githubActions = runtime.githubActions ?? process.env.GITHUB_ACTIONS;
  if (
    result.status === 0 ||
    platform !== 'darwin' ||
    githubActions !== 'true' ||
    args.includes('--no-bundle') ||
    !requestsDmgBundle(args)
  ) {
    return false;
  }

  const configuredTargetDir = runtime.cargoTargetDir ?? process.env.CARGO_TARGET_DIR;
  const targetDir = configuredTargetDir
    ? isAbsolute(configuredTargetDir)
      ? configuredTargetDir
      : resolve(desktopDir, configuredTargetDir)
    : join(runtime.root ?? ROOT, 'target');
  const target = optionValue(args, '--target');
  const profile = args.includes('--debug') ? 'debug' : optionValue(args, '--profile') || 'release';
  const bundleDir = join(
    targetDir,
    ...(target ? [target] : []),
    profile,
    'bundle',
    'macos'
  );

  try {
    return readdirSync(bundleDir, { withFileTypes: true }).some(
      (entry) =>
        entry.isDirectory() &&
        entry.name.endsWith('.app') &&
        statSync(join(bundleDir, entry.name)).mtimeMs >= buildStartedAtMs - 1_000
    );
  } catch {
    return false;
  }
}

function requestsDmgBundle(args) {
  const bundles = optionValue(args, '--bundles');
  return bundles === undefined || bundles.split(',').some((bundle) => bundle.trim() === 'dmg');
}

function optionValue(args, option) {
  const inlinePrefix = `${option}=`;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === option) {
      return args[i + 1];
    }
    if (args[i].startsWith(inlinePrefix)) {
      return args[i].slice(inlinePrefix.length);
    }
  }
  return undefined;
}

// Installer artifact extensions that receive a local build stamp
// (`_<YYYYMMDD>_<commit>` before the extension). CI (GitHub Actions) and
// updater-artifact builds are excluded: release staging and the updater
// manifests match the canonical Tauri names (`BitFun_<version>_<platform>-setup.exe`).
const STAMPED_BUNDLE_ARTIFACT_EXTENSIONS = new Set([
  '.exe',
  '.msi',
  '.dmg',
  '.AppImage',
  '.deb',
  '.rpm',
]);

export function buildStampBundleName(fileName, stamp) {
  const lower = fileName.toLowerCase();
  const extension = [...STAMPED_BUNDLE_ARTIFACT_EXTENSIONS]
    .filter((candidate) => lower.endsWith(candidate.toLowerCase()))
    .sort((left, right) => right.length - left.length)[0];
  if (!extension) {
    return null;
  }
  const stampSuffix = `_${stamp.dateStamp}_${stamp.commitId}`;
  if (fileName.endsWith(`${stampSuffix}${extension}`)) {
    return null;
  }
  const stem = fileName.slice(0, -extension.length);
  return `${stem}${stampSuffix}${extension}`;
}

export function resolveBuildStamp(runtime = {}) {
  const now = runtime.now ? new Date(runtime.now) : new Date();
  const dateStamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');
  const commitId = runtime.commitId ?? readGitCommitId();
  return { dateStamp, commitId: commitId || 'nogit' };
}

function readGitCommitId() {
  try {
    return execSync('git rev-parse --short=7 HEAD', {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

export function collectBundleArtifacts(bundleRootDir, buildStartedAtMs) {
  const artifacts = [];
  const visit = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      const lower = entry.name.toLowerCase();
      const matched = [...STAMPED_BUNDLE_ARTIFACT_EXTENSIONS]
        .some((extension) => lower.endsWith(extension.toLowerCase()));
      if (!matched) {
        continue;
      }
      try {
        if (statSync(fullPath).mtimeMs >= buildStartedAtMs - 1_000) {
          artifacts.push(fullPath);
        }
      } catch {
        // ignore unreadable entries
      }
    }
  };
  visit(bundleRootDir);
  return artifacts;
}

/**
 * Renames freshly produced installer bundles so local artifacts carry the
 * build date and current commit id, e.g.
 * `BitFun_0.2.17_20260922_d78c2cc_x64-setup.exe`. Skipped on GitHub Actions
 * and when updater artifacts are enabled, because the release staging and
 * updater manifest flows depend on the canonical Tauri bundle names.
 */
export function stampLocalBundleArtifacts(options = {}) {
  const runtime = options.runtime ?? {};
  const githubActions = runtime.githubActions ?? process.env.GITHUB_ACTIONS;
  const updaterArtifactsEnabled = ['1', 'true', 'yes'].includes(
    String(runtime.updaterArtifactsEnabled ?? process.env.BITFUN_ENABLE_UPDATER_ARTIFACTS ?? '').toLowerCase()
  );
  const args = options.args ?? [];
  if (
    githubActions === 'true' ||
    updaterArtifactsEnabled ||
    args.includes('--no-bundle')
  ) {
    return [];
  }

  const buildStartedAtMs = options.buildStartedAtMs ?? Date.now();
  const desktopDir = options.desktopDir ?? join(ROOT, 'src', 'apps', 'desktop');
  const configuredTargetDir = runtime.cargoTargetDir ?? process.env.CARGO_TARGET_DIR;
  const targetDir = configuredTargetDir
    ? (isAbsolute(configuredTargetDir)
      ? configuredTargetDir
      : resolve(desktopDir, configuredTargetDir))
    : join(runtime.root ?? ROOT, 'target');
  const triple = optionValue(args, '--target');
  const profile = args.includes('--debug') ? 'debug' : optionValue(args, '--profile') || 'release';
  const bundleRootDir = join(targetDir, ...(triple ? [triple] : []), profile, 'bundle');
  const stamp = resolveBuildStamp(runtime);

  const renamed = [];
  for (const artifactPath of collectBundleArtifacts(bundleRootDir, buildStartedAtMs, runtime)) {
    const nextName = buildStampBundleName(basename(artifactPath), stamp);
    if (!nextName) {
      continue;
    }
    const nextPath = join(dirname(artifactPath), nextName);
    try {
      renameSync(artifactPath, nextPath);
      console.log(`[tauri-build] Stamped bundle: ${basename(artifactPath)} -> ${nextName}`);
      renamed.push(nextPath);
    } catch (error) {
      console.warn(`[tauri-build] Failed to stamp ${basename(artifactPath)}: ${error.message || String(error)}`);
    }
  }
  return renamed;
}

export function prepareTauriConfig(
  baseConfigPath,
  { desktopDir, flashgrepBinary, resolution }
) {
  const config = JSON.parse(readFileSync(baseConfigPath, 'utf8'));
  if (resolution) {
    const productName =
      resolution.productNames[resolution.assembly.fallbackLocale]
      ?? resolution.productNames[resolution.assembly.defaultLocale];
    config.productName = productName;
    config.mainBinaryName = resolution.assembly.binaryName;
    config.identifier = resolution.assembly.bundleId;
  }
  injectTargetFlashgrepResource(config, desktopDir, flashgrepBinary);

  const enabled = ['1', 'true', 'yes'].includes(
    String(process.env.BITFUN_ENABLE_UPDATER_ARTIFACTS || '').toLowerCase()
  );

  if (enabled) {
    const pubkey = process.env.TAURI_UPDATER_PUBKEY;
    if (!pubkey) {
      console.error('BITFUN_ENABLE_UPDATER_ARTIFACTS is set, but TAURI_UPDATER_PUBKEY is missing.');
      process.exit(1);
    }
    if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
      console.error('BITFUN_ENABLE_UPDATER_ARTIFACTS is set, but TAURI_SIGNING_PRIVATE_KEY is missing.');
      process.exit(1);
    }

    const primaryEndpoint =
      process.env.TAURI_UPDATER_ENDPOINT ||
      'https://github.com/GCWing/BitFun/releases/latest/download/latest.json';
    // Fallback endpoint used when GitHub is unreachable (not when no update is found).
    // Tauri updater iterates endpoints and only falls through on network/HTTP errors;
    // a 204 (no update) or a successfully parsed manifest stops the loop.
    const fallbackEndpoint =
      process.env.TAURI_UPDATER_FALLBACK_ENDPOINT ||
      'https://openbitfun.com/release/latest.json';

    config.bundle = {
      ...(config.bundle || {}),
      createUpdaterArtifacts: true,
    };
    config.plugins = {
      ...(config.plugins || {}),
      updater: {
        endpoints: [primaryEndpoint, fallbackEndpoint],
        pubkey,
        windows: {
          installMode: 'quiet',
        },
      },
    };
    console.log(
      `[tauri-build] Updater artifacts enabled: ${primaryEndpoint} (fallback: ${fallbackEndpoint})`
    );
  }

  const generatedDir = join(desktopDir, 'gen');
  mkdirSync(generatedDir, { recursive: true });
  const generatedConfig = join(
    generatedDir,
    resolution
      ? `tauri.${resolution.assembly.assemblyDigest}.generated.conf.json`
      : 'tauri.generated.conf.json',
  );
  writeFileSync(generatedConfig, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return generatedConfig;
}

function injectTargetFlashgrepResource(config, desktopDir, flashgrepBinary) {
  const resources = { ...(config.bundle?.resources || {}) };
  delete resources['../../../resources/flashgrep'];

  for (const binaryPath of bundledFlashgrepResources(flashgrepBinary)) {
    const source = toTauriPath(relative(desktopDir, binaryPath));
    resources[source] = `flashgrep/${basename(binaryPath)}`;
  }
  config.bundle = {
    ...(config.bundle || {}),
    resources,
  };
}

function bundledFlashgrepResources(primaryBinary) {
  const binaries = [primaryBinary];

  if (process.platform === 'win32') {
    for (const binaryName of LINUX_FLASHGREP_BINARIES) {
      const binaryPath = join(ROOT, 'resources', 'flashgrep', binaryName);
      if (existsSync(binaryPath)) {
        binaries.push(binaryPath);
      }
    }
  }

  return [...new Set(binaries)];
}

function toTauriPath(value) {
  return value.split(sep).join('/');
}

// Find all .dmg files under target/ and inject the helper TXT files
// (quarantine removal instructions) into each one.
function patchDmgExtras(root) {
  const patchScript = join(root, 'scripts', 'patch-dmg-extras.sh');
  const targetDir = join(root, 'target');

  const dmgFiles = findDmgFiles(targetDir);
  if (dmgFiles.length === 0) {
    console.log('[patch-dmg] No .dmg files found — skipping.');
    return;
  }

  for (const dmg of dmgFiles) {
    console.log(`[patch-dmg] Patching ${dmg}`);
    const p = spawnSync('bash', [patchScript, dmg], {
      stdio: 'inherit',
      shell: false,
    });
    if (p.status !== 0) {
      console.error(`[patch-dmg] Failed to patch ${dmg}`);
      process.exit(1);
    }
  }
}

function findDmgFiles(dir) {
  const results = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findDmgFiles(full));
      } else if (entry.name.endsWith('.dmg')) {
        results.push(full);
      }
    }
  } catch {
    // directory may not exist for some targets
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
