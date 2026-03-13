const { Client } = require('ssh2');
const { decrypt } = require('./crypto');

function buildConfig(machine) {
  const config = {
    host: machine.ssh_host,
    port: machine.ssh_port,
    username: machine.ssh_username,
    readyTimeout: 15000,
  };

  if (machine.ssh_auth_type === 'key') {
    const key = decrypt(machine.ssh_private_key_enc);
    config.privateKey = key || undefined;
    const passphrase = decrypt(machine.ssh_passphrase_enc);
    if (passphrase) config.passphrase = passphrase;
  } else {
    const password = decrypt(machine.ssh_password_enc);
    config.password = password || undefined;
  }

  return config;
}

function execCommand(machine, command) {
  return new Promise((resolve) => {
    const conn = new Client();
    let stdout = '';
    let stderr = '';
    let exitCode = null;

    conn.on('ready', () => {
      conn.exec(command, { pty: true }, (err, stream) => {
        if (err) {
          stderr = err.message;
          conn.end();
          return resolve({ ok: false, stdout, stderr, exitCode: -1 });
        }
        stream
          .on('close', (code) => {
            exitCode = code;
            conn.end();
            resolve({ ok: code === 0, stdout, stderr, exitCode });
          })
          .on('data', (data) => {
            stdout += data.toString('utf8');
          });
        stream.stderr.on('data', (data) => {
          stderr += data.toString('utf8');
        });
      });
    });

    conn.on('error', (err) => {
      resolve({ ok: false, stdout, stderr: err.message, exitCode: -1 });
    });

    conn.connect(buildConfig(machine));
  });
}

module.exports = {
  buildConfig,
  execCommand,
};

