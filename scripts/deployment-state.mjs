import fs from "node:fs";
import path from "node:path";
const imageId = /^sha256:[a-f0-9]{64}$/;
export function validateDeployment(value) {
  if (
    value?.schema !== 1 ||
    !imageId.test(value.app) ||
    !imageId.test(value.validator) ||
    !/^\d+(?:,\d+)*$/.test(value.migrations)
  )
    throw Error("Invalid local deployment checkpoint");
  return value;
}
export function readDeployment(root, name) {
  const file = path.join(root, name);
  return fs.existsSync(file)
    ? validateDeployment(JSON.parse(fs.readFileSync(file, "utf8")))
    : null;
}
export function writeDeployment(root, name, value) {
  validateDeployment(value);
  const file = path.join(root, name),
    temp = file + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}
export function assertRollbackSchema(saved, current) {
  validateDeployment(saved);
  if (saved.migrations !== current)
    throw Error(
      "Database migrations changed. Image rollback is blocked; restore a verified database/object backup with its matching configuration instead. No data was modified.",
    );
}
