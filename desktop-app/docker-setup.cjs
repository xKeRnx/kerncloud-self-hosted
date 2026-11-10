"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { spawnSync, spawn } = require("node:child_process"),
  crypto = require("node:crypto");
const urls = {
  win32:
    "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe",
  darwinArm: "https://desktop.docker.com/mac/main/arm64/Docker.dmg",
  darwinIntel: "https://desktop.docker.com/mac/main/amd64/Docker.dmg",
};
function dockerPaths() {
  if (process.platform === "win32")
    return [
      path.join(
        process.env.ProgramFiles ?? "C:/Program Files",
        "Docker/Docker/Docker Desktop.exe",
      ),
      path.join(
        process.env.LOCALAPPDATA ?? "",
        "Programs/DockerDesktop/Docker Desktop.exe",
      ),
    ];
  if (process.platform === "darwin") return ["/Applications/Docker.app"];
  return [];
}
function configureDockerPath() {
  if (process.platform !== "win32") return;
  for (const folder of [
    path.join(
      process.env.ProgramFiles ?? "C:/Program Files",
      "Docker/Docker/resources/bin",
    ),
    path.join(
      process.env.LOCALAPPDATA ?? "",
      "Programs/DockerDesktop/resources/bin",
    ),
  ])
    if (
      fs.existsSync(path.join(folder, "docker.exe")) &&
      !process.env.PATH?.includes(folder)
    )
      process.env.PATH = folder + path.delimiter + (process.env.PATH ?? "");
}
function checkDocker(args, timeout) {
  return new Promise((resolve) => {
    require("node:child_process").execFile(
      "docker",
      args,
      { encoding: "utf8", windowsHide: true, timeout },
      (error, stdout) =>
        resolve({ status: error ? 1 : 0, stdout: stdout ?? "" }),
    );
  });
}
async function detectDocker() {
  configureDockerPath();
  const cli = await checkDocker(["--version"], 10000),
    engine =
      cli.status === 0
        ? await checkDocker(["version", "--format", "{{.Server.Os}}"], 12000)
        : null;
  return {
    installed: cli.status === 0,
    running: engine?.status === 0 && engine.stdout.trim() === "linux",
    desktopInstalled: dockerPaths().some((p) => fs.existsSync(p)),
    platform: process.platform,
  };
}
async function startDocker(shell) {
  configureDockerPath();
  if ((await detectDocker()).running) return;
  const desktop = dockerPaths().find((p) => fs.existsSync(p));
  if (!desktop)
    throw Error(
      "Docker is not running. Start Docker Engine or use Set up Docker.",
    );
  if (process.platform === "darwin") await shell.openPath(desktop);
  else
    spawn(desktop, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
  for (let n = 0; n < 90; n++) {
    await new Promise((r) => setTimeout(r, 2000));
    if ((await detectDocker()).running) return;
  }
  throw Error("Complete Docker’s setup/permission prompts, then try again.");
}
async function installDocker({ shell, directory, resources, log }) {
  const state = await detectDocker();
  if (state.installed || state.desktopInstalled) {
    await startDocker(shell);
    return { message: "Docker is ready." };
  }
  fs.mkdirSync(directory, { recursive: true });
  if (process.platform === "linux") {
    const script = path.join(resources, "docker-install-linux.sh");
    const args =
      process.getuid?.() === 0 ? [script] : ["pkexec", "/bin/sh", script];
    const command = process.getuid?.() === 0 ? "/bin/sh" : args.shift();
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.on("data", (v) => log(v.toString()));
      child.stderr.on("data", (v) => log(v.toString()));
      child.on("error", () =>
        reject(
          Error(
            "Install Docker Engine using your distribution’s administrator tools.",
          ),
        ),
      );
      child.on("exit", (c) =>
        c === 0
          ? resolve()
          : reject(
              Error(
                "Docker setup was canceled or failed. Existing Docker data was not removed.",
              ),
            ),
      );
    });
    return {
      message:
        "Docker packages installed. Start the daemon and confirm local access in your operating system if required.",
    };
  }
  const url =
    process.platform === "win32"
      ? urls.win32
      : process.arch === "arm64"
        ? urls.darwinArm
        : urls.darwinIntel;
  const destination = path.join(
    directory,
    process.platform === "win32"
      ? "Docker-Desktop-Installer.exe"
      : "Docker.dmg",
  );
  log("Downloading the official Docker installer…\n");
  const response = await fetch(url, { signal: AbortSignal.timeout(600000) });
  if (!response.ok || new URL(response.url).hostname !== "desktop.docker.com")
    throw Error("Official Docker download failed.");
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length < 10000000 || data.length > 2000000000)
    throw Error("Unexpected Docker installer size.");
  fs.writeFileSync(destination, data, { mode: 0o600 });
  if (process.platform === "win32") {
    const literal = destination.replaceAll("'", "''");
    const proof = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$s=Get-AuthenticodeSignature -LiteralPath '${literal}'; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'Docker Inc'){exit 1}`,
      ],
      { windowsHide: true, timeout: 30000 },
    );
    if (proof.status !== 0)
      throw Error(
        "The official Docker publisher signature could not be verified. The installer was not started.",
      );
  }
  fs.writeFileSync(
    destination + ".sha256",
    crypto.createHash("sha256").update(data).digest("hex") + "\n",
  );
  const error = await shell.openPath(destination);
  if (error) throw Error("Could not open the Docker installer.");
  return {
    message:
      "Complete the official Docker installer, license and OS prompts. Then select Start locally.",
  };
}
module.exports = {
  detectDocker,
  configureDockerPath,
  startDocker,
  installDocker,
  urls,
};
