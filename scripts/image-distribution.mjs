import fs from 'node:fs';
import path from 'node:path';
export function imageDistribution(root, config = {}) {
  const {version} = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid release version');
  const source = {mode:'source', app:`kerncloud-selfhost:${version}`, validator:`kerncloud-selfhost-validator:${version}`};
  if (config.KERNCLOUD_IMAGE_MODE === 'source') return source;
  const file = path.join(root, 'distribution-images.json');
  if (!fs.existsSync(file)) {
    if (config.KERNCLOUD_IMAGE_MODE === 'registry') throw Error('This source checkout has no verified image manifest. Select source build explicitly.');
    return source;
  }
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (p.schema !== 1 || p.version !== version) throw Error('Container image manifest does not match this release');
  for (const [name, image] of Object.entries(p.images ?? {})) {
    const repository = name === 'app' ? 'kerncloud-self-hosted' : name === 'validator' ? 'kerncloud-validator' : null;
    if (!repository || !new RegExp(`^ghcr\\.io/xkernx/${repository}@sha256:[a-f0-9]{64}$`).test(image)) throw Error('Invalid immutable container reference');
  }
  if (!p.images?.app || !p.images?.validator) throw Error('Incomplete image manifest');
  return {mode:'registry', ...p.images};
}
