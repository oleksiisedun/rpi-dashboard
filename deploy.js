require("dotenv").config();
const path = require("path");
const { NodeSSH } = require("node-ssh");

const EXCLUDED = new Set(["node_modules", ".git", ".env"]);

/**
 * Reads and validates the Pi connection settings from process.env.
 * @returns {{ host: string, username: string, password: string, remotePath: string }}
 */
function loadConfig() {
  const { PI_HOST, PI_USER, PI_PASSWORD, PI_PATH } = process.env;
  if (!PI_HOST || !PI_USER || !PI_PASSWORD) {
    throw new Error(
      "PI_HOST, PI_USER and PI_PASSWORD must be set in .env (see .env.example)"
    );
  }
  return {
    host: PI_HOST,
    username: PI_USER,
    password: PI_PASSWORD,
    remotePath: PI_PATH || "/home/pi/rpi-dashboard",
  };
}

/**
 * Decides whether a local file/directory should be uploaded.
 * @param {string} localPath
 * @returns {boolean}
 */
function shouldUpload(localPath) {
  return !EXCLUDED.has(path.basename(localPath));
}

/**
 * Runs a remote command and logs its output, throwing if it exits non-zero.
 * @param {import("node-ssh").NodeSSH} ssh
 * @param {string} command
 * @param {string} cwd
 * @param {string} [stdin]
 * @returns {Promise<void>}
 */
async function runRemote(ssh, command, cwd, stdin) {
  console.log(`$ ${command}`);
  const result = await ssh.execCommand(command, { cwd, stdin });
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  if (result.code !== 0) {
    throw new Error(`Remote command failed (${result.code}): ${command}`);
  }
}

/**
 * Uploads the local project to the Pi, installs dependencies, and restarts the service.
 * @returns {Promise<void>}
 */
async function main() {
  const { host, username, password, remotePath } = loadConfig();
  const ssh = new NodeSSH();

  try {
    console.log(`Connecting to ${username}@${host}...`);
    await ssh.connect({ host, username, password });

    console.log(`Uploading project to ${remotePath}...`);
    let uploadedCount = 0;
    const ok = await ssh.putDirectory(__dirname, remotePath, {
      recursive: true,
      validate: shouldUpload,
      tick: (localFile, remoteFile, error) => {
        if (error) {
          console.error(`Failed to upload ${localFile}: ${error.message}`);
        } else {
          uploadedCount += 1;
        }
      },
    });
    if (!ok) {
      throw new Error("One or more files failed to upload");
    }
    console.log(`Uploaded ${uploadedCount} files.`);

    console.log("Installing dependencies on the Pi...");
    await runRemote(ssh, "npm install --production", remotePath);

    console.log("Restarting rpi-dashboard service...");
    await runRemote(
      ssh,
      "sudo -S systemctl restart rpi-dashboard",
      remotePath,
      `${password}\n`
    );

    console.log("Deploy complete.");
  } finally {
    ssh.dispose();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
