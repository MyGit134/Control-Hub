require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const cookie = require('cookie');
const multer = require('multer');
const WebSocket = require('ws');
const httpProxy = require('http-proxy');
const net = require('net');

const db = require('./db');
const { encrypt } = require('./crypto');
const {
  signToken,
  verifyToken,
  setAuthCookie,
  clearAuthCookie,
  authRequired,
  adminOnly,
  hashPassword,
  verifyPassword,
  getUserById,
} = require('./auth');
const { execCommand, buildConfig } = require('./ssh');
const { withSftp } = require('./sftp');
const { Client } = require('ssh2');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });
const proxy = httpProxy.createProxyServer({ ws: true, xfwd: true });

const upload = multer({ dest: path.join(__dirname, '..', 'tmp') });

const WEB_DIR = path.join(__dirname, '..', '..', 'web');
const XTERM_DIR = path.join(__dirname, '..', 'node_modules', 'xterm');
const XTERM_FIT_DIR = path.join(__dirname, '..', 'node_modules', 'xterm-addon-fit');

app.use(express.json({ limit: '2mb' }));
app.use((req, _res, next) => {
  req.cookies = cookie.parse(req.headers.cookie || '');
  next();
});

app.use('/vendor/xterm', express.static(path.join(XTERM_DIR, 'lib')));
app.use('/vendor/xterm', express.static(path.join(XTERM_DIR, 'css')));
app.use('/vendor/xterm-addon-fit', express.static(path.join(XTERM_FIT_DIR, 'lib')));

proxy.on('error', (err, _req, res) => {
  console.error('Proxy error:', err.message);
  if (res && typeof res.writeHead === 'function') {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad gateway');
    return;
  }
  if (res && typeof res.end === 'function') {
    res.end();
  }
});

function ensureBootstrapAdmin() {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get();
  if (count.c > 0) return;
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'change-me';
  hashPassword(password).then((hash) => {
    db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)').run(email, hash, 'admin');
    console.log('Bootstrap admin created:', email);
  });
}

ensureBootstrapAdmin();

function sanitizeMachine(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    owner_id: row.owner_id,
    owner_email: row.owner_email,
    visibility: row.visibility,
    group_id: row.group_id,
    group_name: row.group_name || null,
    ssh_host: row.ssh_host,
    ssh_port: row.ssh_port,
    ssh_username: row.ssh_username,
    ssh_auth_type: row.ssh_auth_type,
    notes: row.notes,
    created_at: row.created_at,
  };
}

function canAccessMachine(user, machine) {
  if (user.role === 'admin') return true;
  if (machine.owner_id === user.id) return true;
  return machine.visibility === 'shared';
}

function fetchMachine(id) {
  return db.prepare(`
    SELECT m.*, u.email as owner_email, g.name as group_name
    FROM machines m
    JOIN users u ON u.id = m.owner_id
    LEFT JOIN groups g ON g.id = m.group_id
    WHERE m.id = ?
  `).get(id);
}

function canUseGroup(user, groupId) {
  if (!groupId) return true;
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  if (!group) return false;
  if (user.role === 'admin') return true;
  return group.owner_id === user.id;
}

function checkPort(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

function cleanupUpload(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

app.post('/api/auth/register', async (req, res) => {
  const { email, password, inviteToken } = req.body || {};
  if (!email || !password || !inviteToken) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const tokenRow = db.prepare('SELECT * FROM invite_tokens WHERE token = ?').get(inviteToken);
  if (!tokenRow || tokenRow.uses_left <= 0) {
    return res.status(400).json({ error: 'Invalid token' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(400).json({ error: 'Email already used' });
  }

  const hash = await hashPassword(password);
  const insert = db.transaction(() => {
    db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)').run(email, hash, 'user');
    db.prepare('UPDATE invite_tokens SET uses_left = uses_left - 1 WHERE id = ?').run(tokenRow.id);
  });
  insert();

  const user = db.prepare('SELECT id, email, role FROM users WHERE email = ?').get(email);
  const token = signToken(user);
  setAuthCookie(res, token);
  return res.json(user);
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = signToken(user);
  setAuthCookie(res, token);
  return res.json({ id: user.id, email: user.email, role: user.role });
});

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', authRequired, (req, res) => {
  res.json(req.user);
});

app.get('/api/admin/users', authRequired, adminOnly, (_req, res) => {
  const users = db.prepare('SELECT id, email, role, can_run_multi, created_at FROM users ORDER BY id DESC').all();
  res.json(users);
});

app.post('/api/admin/users', authRequired, adminOnly, async (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
  const hash = await hashPassword(password);
  db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)').run(email, hash, role || 'user');
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', authRequired, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'Not found' });
  if (target.role === 'admin') return res.status(400).json({ error: 'Cannot delete admin' });
  if (req.user.id === id) return res.status(400).json({ error: 'Cannot delete self' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.patch('/api/admin/users/:id', authRequired, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'Not found' });
  if (target.role === 'admin') return res.status(400).json({ error: 'Cannot modify admin permissions' });
  const canRunMulti = req.body?.can_run_multi ? 1 : 0;
  db.prepare('UPDATE users SET can_run_multi = ? WHERE id = ?').run(canRunMulti, id);
  res.json({ ok: true });
});

app.get('/api/admin/invite-tokens', authRequired, adminOnly, (_req, res) => {
  const tokens = db.prepare('SELECT * FROM invite_tokens ORDER BY id DESC').all();
  res.json(tokens);
});

app.post('/api/admin/invite-tokens', authRequired, adminOnly, (req, res) => {
  const uses = Math.max(1, Number(req.body?.uses || 1));
  const token = `token-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
  db.prepare('INSERT INTO invite_tokens (token, uses_left, created_by) VALUES (?, ?, ?)').run(token, uses, req.user.id);
  res.json({ token, uses_left: uses });
});

app.delete('/api/admin/invite-tokens/:id', authRequired, adminOnly, (req, res) => {
  db.prepare('DELETE FROM invite_tokens WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/machines', authRequired, (req, res) => {
  let rows;
  if (req.user.role === 'admin') {
    rows = db.prepare(`
      SELECT m.*, u.email as owner_email, g.name as group_name
      FROM machines m
      JOIN users u ON u.id = m.owner_id
      LEFT JOIN groups g ON g.id = m.group_id
      ORDER BY m.id DESC
    `).all();
  } else {
    rows = db.prepare(`
      SELECT m.*, u.email as owner_email, g.name as group_name
      FROM machines m
      JOIN users u ON u.id = m.owner_id
      LEFT JOIN groups g ON g.id = m.group_id
      WHERE m.owner_id = ? OR m.visibility = 'shared'
      ORDER BY m.id DESC
    `).all(req.user.id);
  }
  res.json(rows.map(sanitizeMachine));
});

app.get('/api/groups', authRequired, (req, res) => {
  let rows;
  if (req.user.role === 'admin') {
    rows = db.prepare('SELECT * FROM groups ORDER BY name').all();
  } else {
    rows = db.prepare(`
      SELECT g.*
      FROM groups g
      WHERE g.owner_id = ?
      OR g.id IN (
        SELECT DISTINCT group_id FROM machines WHERE visibility = 'shared' AND group_id IS NOT NULL
      )
      ORDER BY g.name
    `).all(req.user.id);
  }
  res.json(rows);
});

app.post('/api/groups', authRequired, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Missing name' });
  try {
    const result = db.prepare('INSERT INTO groups (name, owner_id) VALUES (?, ?)').run(name, req.user.id);
    res.json({ id: result.lastInsertRowid, name });
  } catch (err) {
    res.status(400).json({ error: 'Group already exists' });
  }
});

app.patch('/api/groups/:id', authRequired, (req, res) => {
  const id = Number(req.params.id);
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Missing name' });
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
  if (!group) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && group.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, id);
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: 'Group already exists' });
  }
});

app.delete('/api/groups/:id', authRequired, (req, res) => {
  const id = Number(req.params.id);
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
  if (!group) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && group.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  db.prepare('UPDATE machines SET group_id = NULL WHERE group_id = ?').run(id);
  db.prepare('DELETE FROM groups WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.post('/api/machines', authRequired, (req, res) => {
  const payload = req.body || {};
  if (!payload.name || !payload.ssh_host || !payload.ssh_username) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  if (!canUseGroup(req.user, payload.group_id)) {
    return res.status(400).json({ error: 'Invalid group' });
  }

  const stmt = db.prepare(`
    INSERT INTO machines (
      name, owner_id, visibility, group_id, ssh_host, ssh_port, ssh_username,
      ssh_auth_type, ssh_password_enc, ssh_private_key_enc, ssh_passphrase_enc, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    payload.name,
    req.user.id,
    payload.visibility || 'private',
    payload.group_id || null,
    payload.ssh_host,
    Number(payload.ssh_port || 22),
    payload.ssh_username,
    payload.ssh_auth_type || 'password',
    encrypt(payload.ssh_password || ''),
    encrypt(payload.ssh_private_key || ''),
    encrypt(payload.ssh_passphrase || ''),
    payload.notes || ''
  );

  res.json({ ok: true });
});

app.patch('/api/machines/:id', authRequired, (req, res) => {
  const id = Number(req.params.id);
  const machine = fetchMachine(id);
  if (!machine) return res.status(404).json({ error: 'Not found' });
  if (!canAccessMachine(req.user, machine) || (req.user.role !== 'admin' && machine.owner_id !== req.user.id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const payload = req.body || {};
  if (!canUseGroup(req.user, payload.group_id)) {
    return res.status(400).json({ error: 'Invalid group' });
  }
  db.prepare(`
    UPDATE machines SET
      name = ?,
      visibility = ?,
      group_id = ?,
      ssh_host = ?,
      ssh_port = ?,
      ssh_username = ?,
      ssh_auth_type = ?,
      ssh_password_enc = COALESCE(?, ssh_password_enc),
      ssh_private_key_enc = COALESCE(?, ssh_private_key_enc),
      ssh_passphrase_enc = COALESCE(?, ssh_passphrase_enc),
      notes = ?
    WHERE id = ?
  `).run(
    payload.name || machine.name,
    payload.visibility || machine.visibility,
    payload.group_id === undefined ? machine.group_id : payload.group_id,
    payload.ssh_host || machine.ssh_host,
    Number(payload.ssh_port || machine.ssh_port),
    payload.ssh_username || machine.ssh_username,
    payload.ssh_auth_type || machine.ssh_auth_type,
    payload.ssh_password ? encrypt(payload.ssh_password) : null,
    payload.ssh_private_key ? encrypt(payload.ssh_private_key) : null,
    payload.ssh_passphrase ? encrypt(payload.ssh_passphrase) : null,
    payload.notes ?? machine.notes,
    id
  );

  res.json({ ok: true });
});

app.delete('/api/machines/:id', authRequired, (req, res) => {
  const id = Number(req.params.id);
  const machine = fetchMachine(id);
  if (!machine) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && machine.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  db.prepare('DELETE FROM services WHERE machine_id = ?').run(id);
  db.prepare('DELETE FROM machines WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.get('/api/machines/:id/services', authRequired, (req, res) => {
  const id = Number(req.params.id);
  const machine = fetchMachine(id);
  if (!machine || !canAccessMachine(req.user, machine)) {
    return res.status(404).json({ error: 'Not found' });
  }
  const services = db.prepare('SELECT * FROM services WHERE machine_id = ? ORDER BY id DESC').all(id);
  res.json(services);
});

app.post('/api/machines/:id/services', authRequired, (req, res) => {
  const id = Number(req.params.id);
  const machine = fetchMachine(id);
  if (!machine) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && machine.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const payload = req.body || {};
  db.prepare(`
    INSERT INTO services (machine_id, type, name, target_host, target_port, target_path, protocol)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    payload.type || 'custom',
    payload.name || 'Service',
    payload.target_host || '127.0.0.1',
    Number(payload.target_port || 80),
    payload.target_path || '/',
    payload.protocol || 'http'
  );
  res.json({ ok: true });
});

app.delete('/api/services/:id', authRequired, (req, res) => {
  const id = Number(req.params.id);
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
  if (!service) return res.status(404).json({ error: 'Not found' });
  const machine = fetchMachine(service.machine_id);
  if (!machine) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && machine.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  db.prepare('DELETE FROM services WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.post('/api/ssh/exec', authRequired, async (req, res) => {
  if (req.user.role !== 'admin' && !req.user.can_run_multi) {
    return res.status(403).json({ error: 'Permission denied' });
  }
  const { machineIds, command } = req.body || {};
  if (!Array.isArray(machineIds) || !command) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const results = [];
  for (const id of machineIds) {
    const machine = fetchMachine(id);
    if (!machine || !canAccessMachine(req.user, machine)) {
      results.push({ machine: { id }, ok: false, stdout: '', stderr: 'No access', exitCode: -1 });
      continue;
    }
    const result = await execCommand(machine, command);
    results.push({ machine: sanitizeMachine(machine), ...result });
  }

  res.json(results);
});

app.get('/api/sftp/list', authRequired, async (req, res) => {
  const machineId = Number(req.query.machineId);
  const remotePath = String(req.query.path || '/');
  const machine = fetchMachine(machineId);
  if (!machine || !canAccessMachine(req.user, machine)) {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    const data = await withSftp(machine, (sftp) => sftp.list(remotePath));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sftp/download', authRequired, async (req, res) => {
  const machineId = Number(req.query.machineId);
  const remotePath = String(req.query.path || '/');
  const machine = fetchMachine(machineId);
  if (!machine || !canAccessMachine(req.user, machine)) {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    const filename = path.basename(remotePath) || 'download';
    const safeName = filename.replace(/["\\]/g, '_');
    const encoded = encodeURIComponent(filename);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${encoded}`);
    res.setHeader('Content-Type', 'application/octet-stream');
    await withSftp(machine, (sftp) => sftp.get(remotePath, res));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sftp/upload', authRequired, upload.single('file'), async (req, res) => {
  const machineId = Number(req.query.machineId);
  const remoteDir = String(req.query.path || '/');
  const machine = fetchMachine(machineId);
  if (!machine || !canAccessMachine(req.user, machine)) {
    cleanupUpload(req.file?.path);
    return res.status(404).json({ error: 'Not found' });
  }
  if (!req.file) return res.status(400).json({ error: 'Missing file' });
  const localPath = req.file.path;
  const normalizedDir = remoteDir.trim() || '/';
  const remotePath = path.posix.join(normalizedDir, req.file.originalname);
  try {
    await withSftp(machine, (sftp) => sftp.put(localPath, remotePath, { flags: 'w' }));
    cleanupUpload(localPath);
    res.json({ ok: true });
  } catch (err) {
    cleanupUpload(localPath);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sftp/delete', authRequired, async (req, res) => {
  const machineId = Number(req.query.machineId);
  const remotePath = String(req.query.path || '/');
  const machine = fetchMachine(machineId);
  if (!machine || !canAccessMachine(req.user, machine)) {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    await withSftp(machine, (sftp) => sftp.delete(remotePath));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/machines/status', authRequired, async (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map((val) => Number(val))
    .filter((val) => Number.isFinite(val));
  const results = await Promise.all(
    ids.map(async (id) => {
      const machine = fetchMachine(id);
      if (!machine || !canAccessMachine(req.user, machine)) {
        return { id, online: false };
      }
      const online = await checkPort(machine.ssh_host, machine.ssh_port);
      return { id, online };
    })
  );
  res.json(results);
});

app.use('/proxy/:serviceId', authRequired, (req, res) => {
  const serviceId = Number(req.params.serviceId);
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
  if (!service) return res.status(404).json({ error: 'Not found' });
  const machine = fetchMachine(service.machine_id);
  if (!machine || !canAccessMachine(req.user, machine)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const target = `${service.protocol}://${service.target_host}:${service.target_port}`;
  const prefix = `/proxy/${serviceId}`;
  const basePath = (service.target_path || '/').replace(/\/$/, '');
  const tail = req.url.replace(prefix, '') || '/';
  req.url = `${basePath}${tail}`;
  proxy.web(req, res, { target, changeOrigin: true });
});

app.use(express.static(WEB_DIR));

app.get('*', (_req, res) => {
  res.sendFile(path.join(WEB_DIR, 'index.html'));
});

function getUserFromRequest(req) {
  try {
    const cookies = cookie.parse(req.headers.cookie || '');
    const token = cookies.auth_token;
    if (!token) return null;
    const payload = verifyToken(token);
    return getUserById(payload.id);
  } catch {
    return null;
  }
}

server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/ws/ssh/')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
    return;
  }

  if (req.url.startsWith('/proxy/')) {
    const match = req.url.match(/^\/proxy\/(\d+)/);
    if (!match) return socket.destroy();
    const serviceId = Number(match[1]);
    const user = getUserFromRequest(req);
    if (!user) return socket.destroy();
    const service = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
    if (!service) return socket.destroy();
    const machine = fetchMachine(service.machine_id);
    if (!machine || !canAccessMachine(user, machine)) return socket.destroy();
    const target = `${service.protocol}://${service.target_host}:${service.target_port}`;
    const prefix = `/proxy/${serviceId}`;
    const basePath = (service.target_path || '/').replace(/\/$/, '');
    const tail = req.url.replace(prefix, '') || '/';
    req.url = `${basePath}${tail}`;
    proxy.ws(req, socket, head, { target, changeOrigin: true });
    return;
  }

  socket.destroy();
});

wss.on('connection', (ws, req) => {
  const user = getUserFromRequest(req);
  if (!user) {
    ws.close();
    return;
  }

  const machineId = Number(req.url.split('/').pop());
  const machine = fetchMachine(machineId);
  if (!machine || !canAccessMachine(user, machine)) {
    ws.close();
    return;
  }

  console.log(`WS SSH connect user=${user.email} machine=${machineId}`);
  const conn = new Client();
  let shell;
  let init = { cols: 120, rows: 30, term: 'xterm-256color' };
  let connReady = false;
  let initReady = false;
  const sendStatus = (message) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'status', data: message }));
    }
  };

  const openShellIfReady = () => {
    if (!connReady || !initReady || shell) return;
    sendStatus('SSH connected. Opening shell...');
    conn.shell(
      {
        term: init.term || 'xterm-256color',
        cols: init.cols || 120,
        rows: init.rows || 30,
      },
      (err, stream) => {
        if (err) {
          sendStatus(`Shell error: ${err.message}`);
          return;
        }
        shell = stream;
        stream.on('data', (chunk) => {
          ws.send(JSON.stringify({ type: 'data', data: chunk.toString('utf8') }));
        });
        stream.on('close', () => {
          sendStatus('Shell closed.');
          ws.close();
          conn.end();
        });
      }
    );
  };

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'init') {
        init = { cols: msg.cols || 120, rows: msg.rows || 30, term: msg.term || 'xterm-256color' };
        initReady = true;
        openShellIfReady();
      }
      if (msg.type === 'data' && shell) {
        shell.write(msg.data);
      }
      if (msg.type === 'resize' && shell) {
        shell.setWindow(msg.rows, msg.cols, 0, 0);
      }
    } catch {
      // ignore
    }
  });

  ws.on('close', () => {
    console.log(`WS SSH closed user=${user.email} machine=${machineId}`);
    conn.end();
  });

  conn.on('ready', () => {
    connReady = true;
    openShellIfReady();
  });

  conn.on('error', (err) => {
    sendStatus(`SSH error: ${err.message}`);
    console.log(`SSH error user=${user.email} machine=${machineId}: ${err.message}`);
    ws.close();
  });

  conn.connect(buildConfig(machine));
});

const port = Number(process.env.PORT || 8080);
server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

