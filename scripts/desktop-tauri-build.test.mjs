import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildStampBundleName,
  collectBundleArtifacts,
  prepareTauriConfig,
  resolveBuildStamp,
  shouldRetryMacDmgBuild,
  stampLocalBundleArtifacts,
} from './desktop-tauri-build.mjs';
import { resolveProductDefinition } from './product-customization/resolver.mjs';

const FAILED_BUILD = { status: 1 };
const DMG_ARGS = ['--target', 'x86_64-apple-darwin', '--bundles', 'app,dmg'];
const ROOT = join(import.meta.dirname, '..');

function retryFixture() {
  const root = join(tmpdir(), `bitfun-dmg-retry-${process.pid}-${Date.now()}`);
  const desktopDir = join(root, 'src', 'apps', 'desktop');
  const targetDir = join(root, 'target');
  const appDir = join(
    targetDir,
    'x86_64-apple-darwin',
    'release',
    'bundle',
    'macos',
    'BitFun.app'
  );
  mkdirSync(desktopDir, { recursive: true });
  mkdirSync(appDir, { recursive: true });

  return {
    appDir,
    desktopDir,
    runtime: {
      cargoTargetDir: targetDir,
      githubActions: 'true',
      platform: 'darwin',
      root,
    },
    cleanup: () => rmSync(root, { force: true, recursive: true }),
  };
}

test('retries a failed GitHub Actions DMG bundle after a fresh app bundle', () => {
  const fixture = retryFixture();
  try {
    assert.equal(
      shouldRetryMacDmgBuild(
        FAILED_BUILD,
        DMG_ARGS,
        fixture.desktopDir,
        Date.now(),
        fixture.runtime
      ),
      true
    );
  } finally {
    fixture.cleanup();
  }
});

test('does not retry failures outside the narrow DMG bundling boundary', () => {
  const fixture = retryFixture();
  try {
    const cases = [
      [{ status: 0 }, DMG_ARGS, fixture.runtime],
      [FAILED_BUILD, DMG_ARGS, { ...fixture.runtime, platform: 'linux' }],
      [FAILED_BUILD, DMG_ARGS, { ...fixture.runtime, githubActions: 'false' }],
      [FAILED_BUILD, ['--no-bundle'], fixture.runtime],
      [FAILED_BUILD, ['--bundles=app'], fixture.runtime],
      [
        FAILED_BUILD,
        DMG_ARGS,
        { ...fixture.runtime, cargoTargetDir: join(fixture.runtime.root, 'missing') },
      ],
    ];
    for (const [result, args, runtime] of cases) {
      assert.equal(
        shouldRetryMacDmgBuild(result, args, fixture.desktopDir, Date.now(), runtime),
        false
      );
    }

    const staleTime = new Date(Date.now() - 60_000);
    utimesSync(fixture.appDir, staleTime, staleTime);
    assert.equal(
      shouldRetryMacDmgBuild(
        FAILED_BUILD,
        DMG_ARGS,
        fixture.desktopDir,
        Date.now(),
        fixture.runtime
      ),
      false
    );
  } finally {
    fixture.cleanup();
  }
});

test('Desktop Tauri projection consumes only the resolved member identity', () => {
  const fixture = join(tmpdir(), `bitfun-tauri-product-${process.pid}-${Date.now()}`);
  mkdirSync(fixture, { recursive: true });
  const baseConfig = join(fixture, 'tauri.conf.json');
  writeFileSync(baseConfig, JSON.stringify({
    productName: 'BitFun',
    identifier: 'com.bitfun.desktop',
    bundle: { resources: {} },
  }));
  try {
    const resolution = resolveProductDefinition({
      rootDir: ROOT,
      productConfig: join(ROOT, 'products', 'fixtures', 'acme', 'product.jsonc'),
      member: 'desktop',
    });
    const generated = prepareTauriConfig(baseConfig, {
      desktopDir: fixture,
      flashgrepBinary: join(fixture, 'flashgrep'),
      resolution,
    });
    const config = JSON.parse(readFileSync(generated, 'utf8'));
    assert.equal(config.productName, 'Acme Desktop');
    assert.equal(config.mainBinaryName, 'acme-desktop');
    assert.equal(config.identifier, 'com.acme.desktop');
    assert.equal(config.bundle.icon, undefined);
  } finally {
    rmSync(fixture, { force: true, recursive: true });
  }
});

test('Windows updater installs NSIS packages without showing its progress window', () => {
  const fixture = join(tmpdir(), `bitfun-tauri-updater-${process.pid}-${Date.now()}`);
  const baseConfig = join(fixture, 'tauri.conf.json');
  const updaterEnv = {
    BITFUN_ENABLE_UPDATER_ARTIFACTS: process.env.BITFUN_ENABLE_UPDATER_ARTIFACTS,
    TAURI_SIGNING_PRIVATE_KEY: process.env.TAURI_SIGNING_PRIVATE_KEY,
    TAURI_UPDATER_PUBKEY: process.env.TAURI_UPDATER_PUBKEY,
  };
  mkdirSync(fixture, { recursive: true });
  writeFileSync(baseConfig, JSON.stringify({ bundle: { resources: {} } }));
  process.env.BITFUN_ENABLE_UPDATER_ARTIFACTS = 'true';
  process.env.TAURI_SIGNING_PRIVATE_KEY = 'test-private-key';
  process.env.TAURI_UPDATER_PUBKEY = 'test-public-key';

  try {
    const generated = prepareTauriConfig(baseConfig, {
      desktopDir: fixture,
      flashgrepBinary: join(fixture, 'flashgrep'),
    });
    const config = JSON.parse(readFileSync(generated, 'utf8'));
    assert.equal(config.plugins.updater.windows.installMode, 'quiet');
  } finally {
    for (const [name, value] of Object.entries(updaterEnv)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    rmSync(fixture, { force: true, recursive: true });
  }
});

test('Desktop release config bundles models.dev notices and provenance', () => {
  const config = JSON.parse(
    readFileSync(join(ROOT, 'src', 'apps', 'desktop', 'tauri.conf.json'), 'utf8')
  );
  assert.equal(
    config.bundle.resources['../../../THIRD_PARTY_NOTICES.md'],
    'THIRD_PARTY_NOTICES.md'
  );
  assert.equal(
    config.bundle.resources[
      '../../crates/services/services-integrations/assets/models-dev.LICENSE.txt'
    ],
    'third-party/models.dev/LICENSE.txt'
  );
  assert.equal(
    config.bundle.resources[
      '../../crates/services/services-integrations/assets/models-dev.provenance.json'
    ],
    'third-party/models.dev/provenance.json'
  );
});

test('local bundle stamping inserts date and commit id before the artifact extension', () => {
  const stamp = { dateStamp: '20260922', commitId: 'd78c2cc' };
  assert.equal(
    buildStampBundleName('BitFun_0.2.17_x64-setup.exe', stamp),
    'BitFun_0.2.17_x64-setup_20260922_d78c2cc.exe'
  );
  assert.equal(
    buildStampBundleName('BitFun_0.2.17_x64_en-US.msi', stamp),
    'BitFun_0.2.17_x64_en-US_20260922_d78c2cc.msi'
  );
  assert.equal(
    buildStampBundleName('BitFun_0.2.17_aarch64.dmg', stamp),
    'BitFun_0.2.17_aarch64_20260922_d78c2cc.dmg'
  );
  assert.equal(buildStampBundleName('BitFun_0.2.17.tar.gz', stamp), null);
  assert.equal(
    buildStampBundleName('BitFun_0.2.17_x64-setup_20260922_d78c2cc.exe', stamp),
    null
  );
});

test('resolveBuildStamp uses the provided runtime values and falls back to nogit', () => {
  assert.deepEqual(resolveBuildStamp({ now: '2026-09-22T10:00:00', commitId: 'abc1234' }), {
    dateStamp: '20260922',
    commitId: 'abc1234',
  });
  assert.equal(resolveBuildStamp({ commitId: '' }).commitId, 'nogit');
  const resolvedFromGit = resolveBuildStamp({ now: '2026-09-22T10:00:00' });
  assert.match(resolvedFromGit.commitId, /^[0-9a-f]{7,}$/);
});

function stampFixture() {
  const root = join(tmpdir(), `bitfun-bundle-stamp-${process.pid}-${Date.now()}`);
  const desktopDir = join(root, 'src', 'apps', 'desktop');
  const bundleDir = join(root, 'target', 'release', 'bundle', 'nsis');
  mkdirSync(desktopDir, { recursive: true });
  mkdirSync(bundleDir, { recursive: true });
  const freshInstaller = join(bundleDir, 'BitFun_0.2.17_x64-setup.exe');
  writeFileSync(freshInstaller, 'installer');
  const staleInstaller = join(bundleDir, 'BitFun_0.2.16_x64-setup.exe');
  writeFileSync(staleInstaller, 'stale');
  const staleTime = new Date(Date.now() - 60_000);
  utimesSync(staleInstaller, staleTime, staleTime);
  return {
    bundleDir,
    desktopDir,
    freshInstaller,
    staleInstaller,
    runtime: {
      cargoTargetDir: join(root, 'target'),
      commitId: 'd78c2cc',
      now: '2026-09-22T10:00:00',
      root,
    },
    cleanup: () => rmSync(root, { force: true, recursive: true }),
  };
}

test('stamps only fresh local bundle artifacts and skips CI and updater builds', () => {
  const fixture = stampFixture();
  try {
    const renamed = stampLocalBundleArtifacts({
      args: [],
      buildStartedAtMs: Date.now(),
      desktopDir: fixture.desktopDir,
      runtime: fixture.runtime,
    });
    assert.deepEqual(renamed, [join(fixture.bundleDir, 'BitFun_0.2.17_x64-setup_20260922_d78c2cc.exe')]);
    assert.equal(
      readFileSync(renamed[0], 'utf8'),
      'installer'
    );
    assert.equal(
      collectBundleArtifacts(fixture.bundleDir, Date.now()).length,
      1,
      'the stale artifact is filtered by the build-start mtime guard'
    );

    const ciFixture = stampFixture();
    try {
      assert.deepEqual(
        stampLocalBundleArtifacts({
          args: [],
          buildStartedAtMs: Date.now(),
          desktopDir: ciFixture.desktopDir,
          runtime: { ...ciFixture.runtime, githubActions: 'true' },
        }),
        []
      );
      assert.deepEqual(
        stampLocalBundleArtifacts({
          args: ['--no-bundle'],
          buildStartedAtMs: Date.now(),
          desktopDir: ciFixture.desktopDir,
          runtime: ciFixture.runtime,
        }),
        []
      );
      assert.deepEqual(
        stampLocalBundleArtifacts({
          args: [],
          buildStartedAtMs: Date.now(),
          desktopDir: ciFixture.desktopDir,
          runtime: { ...ciFixture.runtime, updaterArtifactsEnabled: 'true' },
        }),
        []
      );
    } finally {
      ciFixture.cleanup();
    }
  } finally {
    fixture.cleanup();
  }
});
