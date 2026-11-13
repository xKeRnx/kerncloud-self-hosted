import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { imageDistribution } from "../scripts/image-distribution.mjs";
test("immutable release images are version bound and source builds remain explicit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kc-images-test-"));
  try {
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ version: "1.2.3" }),
    );
    assert.equal(imageDistribution(dir).mode, "source");
    assert.throws(() =>
      imageDistribution(dir, { KERNCLOUD_IMAGE_MODE: "registry" }),
    );
    const p = {
      schema: 1,
      version: "1.2.3",
      images: {
        app: "ghcr.io/xkernx/kerncloud-self-hosted@sha256:" + "a".repeat(64),
        validator:
          "ghcr.io/xkernx/kerncloud-validator@sha256:" + "b".repeat(64),
      },
    };
    fs.writeFileSync(
      path.join(dir, "distribution-images.json"),
      JSON.stringify(p),
    );
    assert.equal(imageDistribution(dir).mode, "registry");
    assert.equal(
      imageDistribution(dir, { KERNCLOUD_IMAGE_MODE: "source" }).mode,
      "source",
    );
    p.images.app = "attacker.invalid/image:latest";
    fs.writeFileSync(
      path.join(dir, "distribution-images.json"),
      JSON.stringify(p),
    );
    assert.throws(() => imageDistribution(dir));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

import {
  validateDeployment,
  assertRollbackSchema,
  readDeployment,
  writeDeployment,
} from "../scripts/deployment-state.mjs";
test("image rollback validates immutable local image IDs and refuses changed migrations before mutation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kc-rollback-test-"));
  try {
    const checkpoint = {
      schema: 1,
      app: "sha256:" + "a".repeat(64),
      validator: "sha256:" + "b".repeat(64),
      migrations: "1,2,35",
    };
    assertRollbackSchema(checkpoint, "1,2,35");
    assert.throws(
      () => assertRollbackSchema(checkpoint, "1,2,35,36"),
      /migrations changed/,
    );
    assert.throws(() =>
      validateDeployment({ ...checkpoint, app: "other/image:latest" }),
    );
    writeDeployment(dir, ".local-rollback.json", checkpoint);
    assert.deepEqual(readDeployment(dir, ".local-rollback.json"), checkpoint);
    assert.equal(readDeployment(dir, "missing.json"), null);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
