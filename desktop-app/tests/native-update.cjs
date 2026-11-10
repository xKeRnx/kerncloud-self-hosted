'use strict';
// Test-only Electron entry point, executed on disposable GitHub VMs. It drives
// the real native download/installer against an owner-signed candidate release.
const {app} = require('electron');
const fs = require('node:fs'), path = require('node:path'), {spawnSync} = require('node:child_process');
if (process.env.CI !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') throw Error('Disposable GitHub runner required');
const source = process.env.GITHUB_WORKSPACE, temporary = process.env.RUNNER_TEMP;
if (!source || !temporary || !/^v\d+\.\d+\.\d+$/.test(process.env.RELEASE_TAG ?? '')) throw Error('Invalid fixture configuration');
const {DesktopUpdates, nativeUpdater, REPOSITORY, verifyManifest} = require(path.join(source, 'desktop-app/updates.cjs'));
const trust = require(path.join(source, 'desktop-app/update-trust.json'));
const proof = path.join(temporary, 'native-updater-proof.json');
app.setPath('userData', path.join(temporary, 'native-updater-profile'));
app.whenReady().then(async () => {
  const response = await fetch(REPOSITORY + '/releases/download/' + process.env.RELEASE_TAG + '/desktop-update.json');
  if (!response.ok) throw Error('Candidate manifest unavailable');
  const envelope = await response.json(); verifyManifest(envelope, trust);
  const phases = [];
  const manager = new DesktopUpdates({app, trust, format: process.platform === 'win32' ? 'exe' : 'deb',
    fetcher: async () => new Response(JSON.stringify(envelope)),
    createNative(options) {
      const native = nativeUpdater(options); native.forceDevUpdateConfig = true;
      if (process.platform === 'win32') native.installDirectory = path.join(temporary, 'KeRnCloud-upgrade-test');
      else {
        // A headless VM has no polkit dialog. Substitute only its permission
        // broker; the production dpkg installation path and real package run.
        const child = require('node:child_process');
        child.spawnSync = function(command, args, options) {
          return command === '/usr/bin/pkexec' ? spawnSync('/usr/bin/sudo', args, options) : spawnSync(command, args, options);
        };
        native.app.relaunch = () => {};
      }
      return native;
    }, onChange: state => phases.push(state.phase),
    beforeInstall: async () => fs.writeFileSync(proof, JSON.stringify({verified: true, nativeDownload: true, phases, version: manager.state.availableVersion, linuxHeadlessPermissionBroker: process.platform === 'linux'})),
  });
  await manager.init();
  const state = await manager.check({manual: true});
  if (state.phase !== 'ready') throw Error('Native update did not reach verified readiness');
  await manager.install();
}).catch(error => {fs.writeFileSync(proof, JSON.stringify({verified: false, error: error.message})); app.exit(1);});
