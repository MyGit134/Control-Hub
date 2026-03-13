const app = document.getElementById('app');

const state = {
  user: null,
  machines: [],
  selectedMachineId: null,
  services: {},
  activeTab: 'overview',
  activeServiceId: null,
};

function qs(selector, parent = document) {
  return parent.querySelector(selector);
}

function qsa(selector, parent = document) {
  return Array.from(parent.querySelectorAll(selector));
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    credentials: 'include',
    ...options,
  });

  if (res.status === 401) {
    if (!location.hash.startsWith('#/login') && !location.hash.startsWith('#/register')) {
      location.hash = '#/login';
    }
  }

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || 'Request failed');
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function loadMe() {
  try {
    state.user = await api('/api/me');
  } catch {
    state.user = null;
  }
}

async function loadMachines() {
  if (!state.user) return;
  state.machines = await api('/api/machines');
  if (!state.selectedMachineId && state.machines.length) {
    state.selectedMachineId = state.machines[0].id;
  }
}

function setActiveTab(tab) {
  state.activeTab = tab;
  render();
}

function navigate(hash) {
  location.hash = hash;
}

function renderLogin() {
  app.innerHTML = `
    <div class="panel auth-card">
      <h1 class="auth-title">Вход</h1>
      <p class="auth-subtitle">Добро пожаловать обратно. Подключаемся к центру управления.</p>
      <div class="grid">
        <div>
          <div class="label">Email</div>
          <input class="input" id="login-email" type="email" placeholder="you@example.com" />
        </div>
        <div>
          <div class="label">Пароль</div>
          <input class="input" id="login-password" type="password" placeholder="••••••••" />
        </div>
        <button class="button accent" id="login-submit">Войти</button>
        <div class="small">Нет аккаунта? <a href="#/register">Регистрация по токену</a></div>
      </div>
    </div>
  `;

  qs('#login-submit').onclick = async () => {
    const email = qs('#login-email').value.trim();
    const password = qs('#login-password').value.trim();
    try {
      await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      await loadMe();
      await loadMachines();
      navigate('#/dashboard');
    } catch (err) {
      alert(err.message);
    }
  };
}

function renderRegister() {
  app.innerHTML = `
    <div class="panel auth-card">
      <h1 class="auth-title">Регистрация</h1>
      <p class="auth-subtitle">Нужен токен приглашения от администратора.</p>
      <div class="grid">
        <div>
          <div class="label">Email</div>
          <input class="input" id="reg-email" type="email" placeholder="you@example.com" />
        </div>
        <div>
          <div class="label">Пароль</div>
          <input class="input" id="reg-password" type="password" placeholder="минимум 8 символов" />
        </div>
        <div>
          <div class="label">Токен</div>
          <input class="input" id="reg-token" type="text" placeholder="token-xxxx" />
        </div>
        <button class="button accent" id="reg-submit">Создать аккаунт</button>
        <div class="small">Уже есть аккаунт? <a href="#/login">Войти</a></div>
      </div>
    </div>
  `;

  qs('#reg-submit').onclick = async () => {
    const email = qs('#reg-email').value.trim();
    const password = qs('#reg-password').value.trim();
    const inviteToken = qs('#reg-token').value.trim();
    try {
      await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, inviteToken }),
      });
      await loadMe();
      await loadMachines();
      navigate('#/dashboard');
    } catch (err) {
      alert(err.message);
    }
  };
}

function renderSidebar() {
  const machineCards = state.machines
    .map(
      (m) => `
      <div class="machine-card ${m.id === state.selectedMachineId ? 'active' : ''}" data-id="${m.id}">
        <div><strong>${m.name}</strong></div>
        <small>${m.ssh_username}@${m.ssh_host}:${m.ssh_port}</small>
      </div>
    `
    )
    .join('');

  return `
    <aside class="sidebar">
      <div class="brand">Remote Control Hub</div>
      <div class="nav-group">
        <div class="nav-item ${location.hash.startsWith('#/dashboard') ? 'active' : ''}" data-nav="dashboard">Обзор</div>
        <div class="nav-item ${location.hash.startsWith('#/multi') ? 'active' : ''}" data-nav="multi">Мульти-команды</div>
        ${state.user?.role === 'admin' ? `<div class="nav-item ${location.hash.startsWith('#/admin') ? 'active' : ''}" data-nav="admin">Администрирование</div>` : ''}
      </div>
      <div>
        <div class="label">Машины</div>
        <div class="machine-list">${machineCards || '<div class="small">Пока нет машин</div>'}</div>
      </div>
      <button class="button" data-action="add-machine">+ Добавить машину</button>
      <button class="button" data-action="logout">Выйти</button>
    </aside>
  `;
}

function renderMachineDetail(machine) {
  if (!machine) {
    return `<div class="panel">Выберите машину слева.</div>`;
  }

  const isOwner = state.user.role === 'admin' || machine.owner_id === state.user.id;

  const tabs = [
    { id: 'overview', label: 'Обзор' },
    { id: 'ssh', label: 'SSH' },
    { id: 'sftp', label: 'SFTP' },
    { id: 'services', label: 'Сервисы' },
  ];

  const tabButtons = tabs
    .map(
      (tab) => `<div class="tab ${state.activeTab === tab.id ? 'active' : ''}" data-tab="${tab.id}">${tab.label}</div>`
    )
    .join('');

  return `
    <div class="panel">
      <div class="topbar">
        <div>
          <h1>${machine.name}</h1>
          <div class="small">${machine.ssh_username}@${machine.ssh_host}:${machine.ssh_port}</div>
        </div>
        <div class="tag">${machine.visibility === 'shared' ? 'Shared' : 'Private'}</div>
      </div>
      <div class="tabs">${tabButtons}</div>
      <div id="tab-content" style="margin-top:16px;">
        ${renderTabContent(machine, isOwner)}
      </div>
    </div>
  `;
}

function renderTabContent(machine, isOwner) {
  if (state.activeTab === 'ssh') {
    return `
      <div class="grid">
        <div class="notice">Интерактивный SSH терминал. Подключение идёт через reverse-туннель на VPS.</div>
        <div id="terminal" class="panel" style="height: 420px;"></div>
      </div>
    `;
  }

  if (state.activeTab === 'sftp') {
    return `
      <div class="grid">
        <div class="notice">Файловый менеджер через SFTP. Поддерживает загрузку и удаление.</div>
        <div class="panel">
          <div class="grid two">
            <input class="input mono" id="sftp-path" placeholder="/home/user" value="/" />
            <div style="display:flex; gap:10px;">
              <button class="button" id="sftp-up">Вверх</button>
              <button class="button" id="sftp-refresh">Обновить</button>
              <label class="button">
                Загрузить
                <input id="sftp-upload" type="file" style="display:none" />
              </label>
            </div>
          </div>
          <div style="margin-top:16px;">
            <table class="sftp-list">
              <thead>
                <tr><th>Имя</th><th>Тип</th><th>Размер</th><th></th></tr>
              </thead>
              <tbody id="sftp-body"></tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  if (state.activeTab === 'services') {
    const services = state.services[machine.id] || [];
    const cards = services
      .map(
        (svc) => `
          <div class="service-card">
            <strong>${svc.name}</strong>
            <div class="small">${svc.type} · ${svc.protocol}://${svc.target_host}:${svc.target_port}${svc.target_path}</div>
            <button class="button" data-action="open-service" data-id="${svc.id}">Открыть</button>
            ${isOwner ? `<button class="button danger" data-action="delete-service" data-id="${svc.id}">Удалить</button>` : ''}
          </div>
        `
      )
      .join('');

    return `
      <div class="grid">
        <div class="notice warning">Сервисы — это веб-интерфейсы, проброшенные через reverse-туннель. Их можно открывать в iframe.</div>
        <div class="card-grid">${cards || '<div class="small">Пока нет сервисов</div>'}</div>
        ${isOwner ? renderServiceForm() : ''}
        <div class="iframe-wrap" id="service-frame-wrap" style="display:none;">
          <iframe id="service-frame" style="width:100%; height:100%; border:0;"></iframe>
        </div>
      </div>
    `;
  }

  return `
    <div class="grid two">
      <div class="panel">
        <div class="label">Описание</div>
        <div>${machine.notes || 'Без заметок'}</div>
        <div style="margin-top:12px;"><span class="label">Владелец</span> ${machine.owner_email || '—'}</div>
      </div>
      ${isOwner ? renderMachineForm(machine) : '<div class="panel">Нет прав на редактирование.</div>'}
    </div>
  `;
}

function renderMachineForm(machine) {
  return `
    <div class="panel">
      <div class="label">Редактирование</div>
      <div class="grid">
        <input class="input" id="edit-name" placeholder="Имя" value="${machine.name}" />
        <input class="input" id="edit-ssh-host" placeholder="SSH host" value="${machine.ssh_host}" />
        <input class="input" id="edit-ssh-port" placeholder="SSH port" value="${machine.ssh_port}" />
        <input class="input" id="edit-ssh-user" placeholder="SSH username" value="${machine.ssh_username}" />
        <select class="input" id="edit-auth-type">
          <option value="password" ${machine.ssh_auth_type === 'password' ? 'selected' : ''}>Пароль</option>
          <option value="key" ${machine.ssh_auth_type === 'key' ? 'selected' : ''}>Приватный ключ</option>
        </select>
        <input class="input" id="edit-password" placeholder="Пароль (если нужно заменить)" type="password" />
        <textarea class="input" id="edit-private-key" placeholder="Приватный ключ (если нужно заменить)" rows="4"></textarea>
        <input class="input" id="edit-passphrase" placeholder="Passphrase (если нужно заменить)" type="password" />
        <select class="input" id="edit-visibility">
          <option value="private" ${machine.visibility === 'private' ? 'selected' : ''}>Только мне</option>
          <option value="shared" ${machine.visibility === 'shared' ? 'selected' : ''}>Всем пользователям</option>
        </select>
        <textarea class="input" id="edit-notes" placeholder="Заметки" rows="3">${machine.notes || ''}</textarea>
        <button class="button accent" id="save-machine">Сохранить</button>
        <button class="button danger" id="delete-machine">Удалить</button>
      </div>
    </div>
  `;
}

function renderServiceForm() {
  return `
    <div class="panel">
      <div class="label">Добавить сервис</div>
      <div class="notice" style="margin-bottom:12px;">
        Быстрые пресеты для стандартного набора (webtop + MediaMTX).
      </div>
      <div class="preset-bar" style="margin-bottom:12px;">
        <button class="button" data-preset="desktop">Desktop (Webtop)</button>
        <button class="button" data-preset="camera-webrtc">Camera/Mic (WebRTC)</button>
        <button class="button" data-preset="camera-hls">Camera/Mic (HLS)</button>
      </div>
      <div class="grid two">
        <input class="input" id="svc-name" placeholder="Название" />
        <select class="input" id="svc-type">
          <option value="desktop">Desktop</option>
          <option value="camera">Camera</option>
          <option value="mic">Mic</option>
          <option value="custom">Custom</option>
        </select>
        <input class="input" id="svc-host" placeholder="Target host" value="127.0.0.1" />
        <input class="input" id="svc-port" placeholder="Target port" value="5901" />
        <input class="input" id="svc-path" placeholder="Path" value="/" />
        <select class="input" id="svc-proto">
          <option value="http">http</option>
          <option value="https">https</option>
        </select>
      </div>
      <div style="margin-top:12px;">
        <button class="button accent" id="svc-add">Добавить сервис</button>
      </div>
    </div>
  `;
}

function renderDashboard() {
  const sidebar = renderSidebar();
  const machine = state.machines.find((m) => m.id === state.selectedMachineId);

  app.innerHTML = `
    <div class="app-shell">
      ${sidebar}
      <main class="main">
        ${renderMachineDetail(machine)}
      </main>
    </div>
  `;

  bindSidebarHandlers();
  if (machine) {
    bindMachineHandlers(machine);
  }
}

function renderMulti() {
  const sidebar = renderSidebar();
  const machineOptions = state.machines
    .map(
      (m) => `
        <label style="display:flex; align-items:center; gap:8px;">
          <input type="checkbox" value="${m.id}" class="multi-machine" />
          <span>${m.name}</span>
        </label>
      `
    )
    .join('');

  app.innerHTML = `
    <div class="app-shell">
      ${sidebar}
      <main class="main">
        <div class="panel">
          <div class="topbar">
            <h1>Массовое выполнение команд</h1>
          </div>
          <div class="grid">
            <div class="notice">Выберите несколько машин и выполните команду параллельно.</div>
            <div class="grid two">${machineOptions || '<div class="small">Нет доступных машин</div>'}</div>
            <textarea class="input mono" id="multi-command" rows="4" placeholder="uptime"></textarea>
            <button class="button accent" id="run-multi">Выполнить</button>
            <pre class="panel mono" id="multi-output" style="white-space: pre-wrap; min-height: 120px;"></pre>
          </div>
        </div>
      </main>
    </div>
  `;

  bindSidebarHandlers();
  qs('#run-multi')?.addEventListener('click', runMultiCommand);
}

function renderAdmin() {
  const sidebar = renderSidebar();

  app.innerHTML = `
    <div class="app-shell">
      ${sidebar}
      <main class="main">
        <div class="panel">
          <div class="topbar">
            <h1>Администрирование</h1>
          </div>
          <div class="grid">
            <div class="notice">Создавайте токены для регистрации и управляйте пользователями.</div>
            <div class="panel" id="token-panel"></div>
            <div class="panel" id="users-panel"></div>
          </div>
        </div>
      </main>
    </div>
  `;

  bindSidebarHandlers();
  loadAdminPanels();
}

function bindSidebarHandlers() {
  qsa('.nav-item').forEach((el) => {
    el.onclick = () => {
      const target = el.dataset.nav;
      if (target === 'dashboard') navigate('#/dashboard');
      if (target === 'multi') navigate('#/multi');
      if (target === 'admin') navigate('#/admin');
    };
  });

  qsa('.machine-card').forEach((el) => {
    el.onclick = () => {
      state.selectedMachineId = Number(el.dataset.id);
      state.activeTab = 'overview';
      navigate('#/dashboard');
    };
  });

  qs('[data-action="add-machine"]').onclick = () => openAddMachine();
  qs('[data-action="logout"]').onclick = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    state.user = null;
    navigate('#/login');
  };
}

function bindMachineHandlers(machine) {
  qsa('.tab').forEach((tab) => {
    tab.onclick = () => setActiveTab(tab.dataset.tab);
  });

  if (state.activeTab === 'ssh') {
    initTerminal(machine.id);
  }

  if (state.activeTab === 'sftp') {
    initSftp(machine.id);
  }

  if (state.activeTab === 'services') {
    qs('#svc-add')?.addEventListener('click', () => addService(machine.id));
    qsa('[data-preset]').forEach((btn) => {
      btn.onclick = () => addServicePreset(machine.id, btn.dataset.preset);
    });
    qsa('[data-action="open-service"]').forEach((btn) => {
      btn.onclick = () => openService(btn.dataset.id);
    });
    qsa('[data-action="delete-service"]').forEach((btn) => {
      btn.onclick = () => deleteService(btn.dataset.id);
    });
  }

  if (state.activeTab === 'overview') {
    qs('#save-machine')?.addEventListener('click', () => saveMachine(machine.id));
    qs('#delete-machine')?.addEventListener('click', () => deleteMachine(machine.id));
  }
}

async function openAddMachine() {
  const name = prompt('Название машины');
  if (!name) return;
  const sshHost = prompt('SSH host (для reverse-туннеля обычно 127.0.0.1)') || '127.0.0.1';
  const sshPort = Number(prompt('SSH port (например 2201)') || '22');
  const sshUser = prompt('SSH username') || 'root';
  const authType = prompt('auth: password или key', 'password') || 'password';
  let sshPassword = '';
  let sshPrivateKey = '';
  let sshPassphrase = '';
  if (authType === 'key') {
    sshPrivateKey = prompt('Вставьте приватный ключ') || '';
    sshPassphrase = prompt('Passphrase (если есть)') || '';
  } else {
    sshPassword = prompt('SSH пароль') || '';
  }
  const visibility = confirm('Сделать видимой для всех пользователей?') ? 'shared' : 'private';

  await api('/api/machines', {
    method: 'POST',
    body: JSON.stringify({
      name,
      ssh_host: sshHost,
      ssh_port: sshPort,
      ssh_username: sshUser,
      ssh_auth_type: authType,
      ssh_password: sshPassword,
      ssh_private_key: sshPrivateKey,
      ssh_passphrase: sshPassphrase,
      visibility,
      notes: '',
    }),
  });
  await loadMachines();
  render();
}

async function saveMachine(id) {
  const payload = {
    name: qs('#edit-name').value.trim(),
    ssh_host: qs('#edit-ssh-host').value.trim(),
    ssh_port: Number(qs('#edit-ssh-port').value),
    ssh_username: qs('#edit-ssh-user').value.trim(),
    ssh_auth_type: qs('#edit-auth-type').value,
    visibility: qs('#edit-visibility').value,
    notes: qs('#edit-notes').value,
  };
  const password = qs('#edit-password').value.trim();
  const privateKey = qs('#edit-private-key').value.trim();
  const passphrase = qs('#edit-passphrase').value.trim();
  if (password) payload.ssh_password = password;
  if (privateKey) payload.ssh_private_key = privateKey;
  if (passphrase) payload.ssh_passphrase = passphrase;

  await api(`/api/machines/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  await loadMachines();
  render();
}

async function deleteMachine(id) {
  if (!confirm('Удалить машину?')) return;
  await api(`/api/machines/${id}`, { method: 'DELETE' });
  await loadMachines();
  state.selectedMachineId = state.machines[0]?.id || null;
  render();
}

async function loadServices(machineId) {
  state.services[machineId] = await api(`/api/machines/${machineId}/services`);
}

async function addService(machineId) {
  const payload = {
    name: qs('#svc-name').value.trim(),
    type: qs('#svc-type').value,
    target_host: qs('#svc-host').value.trim(),
    target_port: Number(qs('#svc-port').value),
    target_path: qs('#svc-path').value.trim() || '/',
    protocol: qs('#svc-proto').value,
  };
  await createService(machineId, payload);
}

async function addServicePreset(machineId, presetId) {
  const presets = {
    desktop: {
      name: 'Desktop (Webtop)',
      type: 'desktop',
      target_host: '127.0.0.1',
      target_port: 3000,
      target_path: '/',
      protocol: 'http',
    },
    'camera-webrtc': {
      name: 'Camera/Mic (WebRTC)',
      type: 'camera',
      target_host: '127.0.0.1',
      target_port: 8889,
      target_path: '/cam',
      protocol: 'http',
    },
    'camera-hls': {
      name: 'Camera/Mic (HLS)',
      type: 'camera',
      target_host: '127.0.0.1',
      target_port: 8888,
      target_path: '/cam',
      protocol: 'http',
    },
  };

  const payload = { ...presets[presetId] };
  if (!payload) return;
  const port = Number(
    prompt('Порт на VPS (куда проброшен reverse-туннель)', String(payload.target_port)) || payload.target_port
  );
  payload.target_port = port;
  await createService(machineId, payload);
}

async function createService(machineId, payload) {
  await api(`/api/machines/${machineId}/services`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  await loadServices(machineId);
  render();
}

async function deleteService(id) {
  if (!confirm('Удалить сервис?')) return;
  await api(`/api/services/${id}`, { method: 'DELETE' });
  const machineId = state.selectedMachineId;
  await loadServices(machineId);
  render();
}

function openService(serviceId) {
  const frameWrap = qs('#service-frame-wrap');
  const frame = qs('#service-frame');
  if (!frameWrap || !frame) return;
  frame.src = `/proxy/${serviceId}/`;
  frameWrap.style.display = 'block';
}

async function initTerminal(machineId) {
  const terminalEl = qs('#terminal');
  if (!terminalEl) return;
  terminalEl.innerHTML = '';
  const term = new window.Terminal({
    cursorBlink: true,
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 13,
    theme: {
      background: '#0f1219',
      foreground: '#f3f5f7',
    },
  });
  const fitAddon = new window.FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(terminalEl);
  fitAddon.fit();

  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/ssh/${machineId}`);

  ws.onopen = () => {
    term.writeln('[WS connected]');
    ws.send(JSON.stringify({ type: 'init', cols: term.cols, rows: term.rows }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'data') {
        term.write(msg.data);
      }
      if (msg.type === 'status') {
        term.writeln(`[${msg.data}]`);
      }
    } catch {
      term.writeln(String(event.data));
    }
  };

  ws.onerror = () => {
    term.write('\r\n[Ошибка подключения]\r\n');
  };

  ws.onclose = () => {
    term.writeln('\r\n[WS closed]\r\n');
  };

  term.onData((data) => {
    ws.send(JSON.stringify({ type: 'data', data }));
  });

  window.addEventListener('resize', () => {
    fitAddon.fit();
    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  });
}

async function initSftp(machineId) {
  const body = qs('#sftp-body');
  const pathInput = qs('#sftp-path');

  async function refresh() {
    const path = pathInput.value || '/';
    const data = await api(`/api/sftp/list?machineId=${machineId}&path=${encodeURIComponent(path)}`);
    body.innerHTML = data
      .map(
        (item) => `
        <tr>
          <td><span class="mono">${item.name}</span></td>
          <td>${item.type}</td>
          <td>${item.size || '-'}</td>
          <td>
            ${item.type === 'd' ? `<button class="button" data-action="enter" data-name="${item.name}">Открыть</button>` : ''}
            <button class="button" data-action="download" data-name="${item.name}">Скачать</button>
            <button class="button danger" data-action="delete" data-name="${item.name}">Удалить</button>
          </td>
        </tr>
      `
      )
      .join('');

    qsa('[data-action="enter"]').forEach((btn) => {
      btn.onclick = () => {
        const next = path.replace(/\/$/, '') + '/' + btn.dataset.name;
        pathInput.value = next;
        refresh();
      };
    });

    qsa('[data-action="download"]').forEach((btn) => {
      btn.onclick = () => {
        const target = path.replace(/\/$/, '') + '/' + btn.dataset.name;
        window.open(`/api/sftp/download?machineId=${machineId}&path=${encodeURIComponent(target)}`);
      };
    });

    qsa('[data-action="delete"]').forEach((btn) => {
      btn.onclick = async () => {
        const target = path.replace(/\/$/, '') + '/' + btn.dataset.name;
        await api(`/api/sftp/delete?machineId=${machineId}&path=${encodeURIComponent(target)}`, { method: 'DELETE' });
        refresh();
      };
    });
  }

  qs('#sftp-refresh').onclick = refresh;
  qs('#sftp-up').onclick = () => {
    const current = pathInput.value || '/';
    if (current === '/') return;
    const parts = current.split('/').filter(Boolean);
    parts.pop();
    pathInput.value = '/' + parts.join('/');
    if (pathInput.value === '/') {
      pathInput.value = '/';
    }
    refresh();
  };

  qs('#sftp-upload').onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    const path = pathInput.value || '/';
    await fetch(`/api/sftp/upload?machineId=${machineId}&path=${encodeURIComponent(path)}`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });
    refresh();
  };

  refresh();
}

async function runMultiCommand() {
  const selected = qsa('.multi-machine')
    .filter((el) => el.checked)
    .map((el) => Number(el.value));
  const command = qs('#multi-command').value.trim();
  if (!selected.length || !command) return;

  const result = await api('/api/ssh/exec', {
    method: 'POST',
    body: JSON.stringify({ machineIds: selected, command }),
  });

  const output = result
    .map((item) => `# ${item.machine.name}\n${item.stdout || ''}${item.stderr ? '\nERR: ' + item.stderr : ''}\n`)
    .join('\n');

  qs('#multi-output').textContent = output;
}

async function loadAdminPanels() {
  const tokens = await api('/api/admin/invite-tokens');
  const users = await api('/api/admin/users');

  qs('#token-panel').innerHTML = `
    <div class="label">Токены регистрации</div>
    <div class="grid">
      <div>
        <input class="input" id="token-uses" placeholder="Количество использований" value="1" />
        <button class="button accent" id="token-create">Создать токен</button>
      </div>
      <div class="grid">${tokens
        .map(
          (t) => `<div class="panel"><strong>${t.token}</strong><div class="small">Использований: ${t.uses_left}</div><button class="button danger" data-token="${t.id}">Удалить</button></div>`
        )
        .join('')}</div>
    </div>
  `;

  qs('#users-panel').innerHTML = `
    <div class="label">Пользователи</div>
    <div class="grid">${users
      .map(
        (u) => `<div class="panel"><strong>${u.email}</strong><div class="small">${u.role}</div><button class="button danger" data-user="${u.id}">Удалить</button></div>`
      )
      .join('')}</div>
  `;

  qs('#token-create').onclick = async () => {
    const uses = Number(qs('#token-uses').value || '1');
    await api('/api/admin/invite-tokens', { method: 'POST', body: JSON.stringify({ uses }) });
    loadAdminPanels();
  };

  qsa('[data-token]').forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/admin/invite-tokens/${btn.dataset.token}`, { method: 'DELETE' });
      loadAdminPanels();
    };
  });

  qsa('[data-user]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('Удалить пользователя?')) return;
      await api(`/api/admin/users/${btn.dataset.user}`, { method: 'DELETE' });
      loadAdminPanels();
    };
  });
}

async function render() {
  const hash = location.hash || '#/login';

  if (!state.user && !hash.startsWith('#/login') && !hash.startsWith('#/register')) {
    await loadMe();
  }

  if (!state.user && (hash.startsWith('#/login') || hash.startsWith('#/register'))) {
    if (hash.startsWith('#/register')) return renderRegister();
    return renderLogin();
  }

  if (!state.user) {
    navigate('#/login');
    return;
  }

  await loadMachines();

  if (hash.startsWith('#/multi')) {
    renderMulti();
    return;
  }

  if (hash.startsWith('#/admin') && state.user.role === 'admin') {
    renderAdmin();
    return;
  }

  if (state.selectedMachineId) {
    await loadServices(state.selectedMachineId);
  }

  renderDashboard();
}

window.addEventListener('hashchange', render);
render();

