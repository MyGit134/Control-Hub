const SftpClient = require('ssh2-sftp-client');
const { buildConfig } = require('./ssh');

async function withSftp(machine, fn) {
  const sftp = new SftpClient();
  await sftp.connect(buildConfig(machine));
  try {
    return await fn(sftp);
  } finally {
    await sftp.end();
  }
}

module.exports = {
  withSftp,
};

