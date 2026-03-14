const app = document.getElementById('app');

const state = {
  user: null,
  machines: [],
  groups: [],
  statuses: {},
  selectedMachineId: null,
  services: {},
  activeTab: 'overview',
  activeServiceId: null,
  deviceTab: 'public',
  groupFilter: 'all',
  searchQuery: '',
  showAddMachine: false,
  dataLoaded: false,
  terminalSession: null,
};

function qs(selector, parent = document) {
  return parent.querySelector(selector);
}

function qsa(selector, parent = document) {
  return Array.from(parent.querySelectorAll(selector));
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

async function loadGroups() {
  if (!state.user) return;
  state.groups = await api('/api/groups');
}

async function loadStatuses() {
  if (!state.user || !state.machines.length) return;
  const ids = state.machines.map((m) => m.id).join(',');
  const data = await api(`/api/machines/status?ids=${ids}`);
  state.statuses = {};
  data.forEach((item) => {
    state.statuses[item.id] = item.online;
  });
}

async function refreshData() {
  await loadMe();
  if (!state.user) {
    state.dataLoaded = false;
    return;
  }
  await Promise.all([loadMachines(), loadGroups()]);
  await loadStatuses();
  state.dataLoaded = true;
}

function setActiveTab(tab) {
  if (state.activeTab === 'ssh' && tab !== 'ssh') {
    cleanupTerminal();
  }
  state.activeTab = tab;
  render();
}

function navigate(hash) {
  location.hash = hash;
}

function getVisibleMachines() {
  const query = state.searchQuery.trim().toLowerCase();
  let list = state.machines;
  if (state.deviceTab === 'public') {
    list = list.filter((m) => m.visibility === 'shared');
  } else if (state.deviceTab === 'personal') {
    list = list.filter((m) => m.owner_id === state.user.id);
  }
  if (state.groupFilter !== 'all') {
    if (state.groupFilter === 'ungrouped') {
      list = list.filter((m) => !m.group_id);
    } else {
      list = list.filter((m) => String(m.group_id) === String(state.groupFilter));
    }
  }
  if (query) {
    list = list.filter((m) => {
      const name = (m.name || '').toLowerCase();
      const host = (m.ssh_host || '').toLowerCase();
      return name.includes(query) || host.includes(query);
    });
  }
  return list.sort((a, b) => {
    const g1 = a.group_name || '';
    const g2 = b.group_name || '';
    if (g1 !== g2) return g1.localeCompare(g2);
    return (a.name || '').localeCompare(b.name || '');
  });
}

function groupByGroup(list) {
  const groups = new Map();
  list.forEach((m) => {
    const id = m.group_id || 0;
    const name = m.group_name || 'Без группы';
    if (!groups.has(id)) {
      groups.set(id, { id, name, items: [] });
    }
    groups.get(id).items.push(m);
  });
  return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function getAssignableGroups() {
  if (state.user?.role === 'admin') return state.groups;
  return state.groups.filter((g) => g.owner_id === state.user.id);
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
  return `
    <aside class="sidebar">
      <div class="brand">Remote Control Hub</div>
      <div class="nav-group">
        <div class="nav-item ${location.hash.startsWith('#/dashboard') ? 'active' : ''}" data-nav="dashboard">Устройства</div>
        ${(state.user?.role === 'admin' || state.user?.can_run_multi) ? `<div class="nav-item ${location.hash.startsWith('#/multi') ? 'active' : ''}" data-nav="multi">Мульти-команды</div>` : ''}
        ${state.user?.role === 'admin' ? `<div class="nav-item ${location.hash.startsWith('#/admin') ? 'active' : ''}" data-nav="admin">Администрирование</div>` : ''}
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
  const status = state.statuses[machine.id];
  const statusClass = status === true ? 'online' : status === false ? 'offline' : 'unknown';
  const statusLabel = status === true ? 'Online' : status === false ? 'Offline' : '...';
  const safeName = esc(machine.name);
  const safeUser = esc(machine.ssh_username);
  const safeHost = esc(machine.ssh_host);
  const safeGroup = esc(machine.group_name || 'Без группы');

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
          <h1>${safeName}</h1>
          <div class="small">${safeUser}@${safeHost}:${machine.ssh_port}</div>
          <div class="small">Группа: ${safeGroup}</div>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <span class="status ${statusClass}">${statusLabel}</span>
          <div class="tag">${machine.visibility === 'shared' ? 'Shared' : 'Private'}</div>
        </div>
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
            <div class="sftp-controls">
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
        (svc) => {
          const url = getServiceUrl(svc);
          const isDesktopReal =
            svc.type === 'desktop-real' || (svc.type === 'desktop' && Number(svc.target_port) === 6080);
          const openButton = isDesktopReal
            ? `<a class="button accent" href="${url}" target="_blank" rel="noopener">Открыть в новой вкладке</a>`
            : `<button class="button" data-action="open-service" data-id="${svc.id}">Открыть</button>`;
          return `
          <div class="service-card">
            <strong>${esc(svc.name)}</strong>
            <div class="small">${esc(svc.type)} · ${esc(svc.protocol)}://${esc(svc.target_host)}:${svc.target_port}${esc(
              svc.target_path
            )}</div>
            ${openButton}
            ${isOwner ? `<button class="button danger" data-action="delete-service" data-id="${svc.id}">Удалить</button>` : ''}
          </div>
        `;
        }
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
        <div>${esc(machine.notes || 'Без заметок')}</div>
        <div style="margin-top:12px;"><span class="label">Владелец</span> ${esc(machine.owner_email || '—')}</div>
      </div>
      ${isOwner ? renderMachineForm(machine) : '<div class="panel">Нет прав на редактирование.</div>'}
    </div>
  `;
}

function renderMachineForm(machine) {
  const assignable = getAssignableGroups();
  const groupOptions = [
    `<option value="" ${!machine.group_id ? 'selected' : ''}>Без группы</option>`,
    ...assignable.map(
      (g) =>
        `<option value="${g.id}" ${String(machine.group_id) === String(g.id) ? 'selected' : ''}>${esc(g.name)}</option>`
    ),
  ].join('');

  return `
    <div class="panel">
      <div class="label">Редактирование</div>
      <div class="grid">
        <input class="input" id="edit-name" placeholder="Имя" value="${esc(machine.name)}" />
        <select class="input" id="edit-group">
          ${groupOptions}
        </select>
        <input class="input" id="edit-ssh-host" placeholder="SSH host" value="${esc(machine.ssh_host)}" />
        <input class="input" id="edit-ssh-port" placeholder="SSH port" value="${machine.ssh_port}" />
        <input class="input" id="edit-ssh-user" placeholder="SSH username" value="${esc(machine.ssh_username)}" />
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
        <textarea class="input" id="edit-notes" placeholder="Заметки" rows="3">${esc(machine.notes || '')}</textarea>
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
        <button class="button" data-preset="desktop-real">Desktop (Real GUI/noVNC)</button>
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

function renderDeviceSection() {
  const visible = getVisibleMachines();
  const grouped = groupByGroup(visible);
  const groupOptions = [
    `<option value="all" ${state.groupFilter === 'all' ? 'selected' : ''}>Все группы</option>`,
    `<option value="ungrouped" ${state.groupFilter === 'ungrouped' ? 'selected' : ''}>Без группы</option>`,
    ...state.groups.map(
      (g) =>
        `<option value="${g.id}" ${String(state.groupFilter) === String(g.id) ? 'selected' : ''}>${esc(g.name)}</option>`
    ),
  ].join('');

  const groupBlocks = grouped
    .map((group) => {
      const cards = group.items
        .map((m) => {
          const status = state.statuses[m.id];
          const statusClass = status === true ? 'online' : status === false ? 'offline' : 'unknown';
          const statusLabel = status === true ? 'Online' : status === false ? 'Offline' : '...';
          const canEditGroup = state.user.role === 'admin' || m.owner_id === state.user.id;
          const assignable = getAssignableGroups();
          const groupOptions = [
            `<option value="">Без группы</option>`,
            ...assignable.map(
              (g) =>
                `<option value="${g.id}" ${String(m.group_id) === String(g.id) ? 'selected' : ''}>${esc(g.name)}</option>`
            ),
          ].join('');
          return `
            <div class="device-card ${m.id === state.selectedMachineId ? 'active' : ''}" data-id="${m.id}">
              <div class="device-head">
                <strong>${esc(m.name)}</strong>
                <span class="status ${statusClass}">${statusLabel}</span>
              </div>
              <div class="small mono">${esc(m.ssh_username)}@${esc(m.ssh_host)}:${m.ssh_port}</div>
              <div class="small">${esc(m.owner_email || '')}</div>
              ${
                canEditGroup
                  ? `<select class="input group-inline" data-group-machine="${m.id}">${groupOptions}</select>`
                  : `<div class="small">Группа: ${esc(m.group_name || 'Без группы')}</div>`
              }
            </div>
          `;
        })
        .join('');
      return `
        <div class="group-block">
          <div class="group-title">${esc(group.name)}</div>
          <div class="device-grid">${cards || '<div class="small">Нет устройств</div>'}</div>
        </div>
      `;
    })
    .join('');

  const manageableGroups =
    state.user.role === 'admin' ? state.groups : state.groups.filter((g) => g.owner_id === state.user.id);
  const groupRows = manageableGroups
    .map(
      (g) => `
      <div class="group-row">
        <input class="input group-edit" data-group-edit="${g.id}" value="${esc(g.name)}" />
        <button class="button" data-group-save="${g.id}">Сохранить</button>
        <button class="button danger" data-group-delete="${g.id}">Удалить</button>
      </div>
    `
    )
    .join('');

  return `
    <div class="panel">
      <div class="topbar">
        <div>
          <h1>Устройства</h1>
          <div class="small">Публичные и личные машины</div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="button" data-action="refresh-status">Обновить статус</button>
          <button class="button accent" data-action="toggle-add">+ Добавить машину</button>
        </div>
      </div>
      <div class="tabs">
        <div class="tab ${state.deviceTab === 'public' ? 'active' : ''}" data-device-tab="public">Публичные</div>
        <div class="tab ${state.deviceTab === 'personal' ? 'active' : ''}" data-device-tab="personal">Личные</div>
      </div>
      <div class="filters">
        <input class="input" id="device-search" placeholder="Поиск по названию или IP" value="${esc(state.searchQuery)}" />
        <select class="input" id="group-filter">${groupOptions}</select>
        <div class="group-create">
          <input class="input" id="group-name" placeholder="Новая группа" />
          <button class="button" id="group-create">Создать</button>
        </div>
      </div>
      <div class="group-manage">
        <div class="label">Группы</div>
        <div class="group-list">${groupRows || '<div class="small">Групп пока нет</div>'}</div>
      </div>
      ${state.showAddMachine ? renderAddMachineForm() : ''}
      <div class="device-list">
        ${groupBlocks || '<div class="small">Нет устройств</div>'}
      </div>
    </div>
  `;
}

function renderAddMachineForm() {
  const assignable = getAssignableGroups();
  const groupOptions = [
    `<option value="">Без группы</option>`,
    ...assignable.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`),
  ].join('');

  return `
    <div class="panel" style="margin-top:16px;">
      <div class="label">Добавить машину</div>
      <div class="grid two">
        <input class="input" id="add-name" placeholder="Имя" />
        <select class="input" id="add-visibility">
          <option value="private">Только мне</option>
          <option value="shared">Всем пользователям</option>
        </select>
        <select class="input" id="add-group">
          ${groupOptions}
        </select>
        <input class="input" id="add-ssh-host" placeholder="SSH host" value="127.0.0.1" />
        <input class="input" id="add-ssh-port" placeholder="SSH port" value="22" />
        <input class="input" id="add-ssh-user" placeholder="SSH username" value="root" />
        <select class="input" id="add-auth-type">
          <option value="password">Пароль</option>
          <option value="key">Приватный ключ</option>
        </select>
        <input class="input" id="add-password" placeholder="Пароль" type="password" />
        <textarea class="input" id="add-private-key" placeholder="Приватный ключ" rows="4"></textarea>
        <input class="input" id="add-passphrase" placeholder="Passphrase" type="password" />
        <textarea class="input" id="add-notes" placeholder="Заметки" rows="3"></textarea>
      </div>
      <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
        <button class="button accent" id="add-machine-submit">Создать</button>
        <button class="button" id="add-machine-cancel">Отмена</button>
      </div>
    </div>
  `;
}

function renderDashboard() {
  const sidebar = renderSidebar();
  const visible = getVisibleMachines();
  const selected = visible.find((m) => m.id === state.selectedMachineId) || visible[0] || null;
  state.selectedMachineId = selected?.id || null;
  const machine = selected;

  app.innerHTML = `
    <div class="app-shell">
      ${sidebar}
      <main class="main">
        <div class="dashboard">
          ${renderDeviceSection()}
          ${renderMachineDetail(machine)}
        </div>
      </main>
    </div>
  `;

  bindSidebarHandlers();
  if (machine) {
    bindMachineHandlers(machine);
  }

  bindDeviceHandlers();
}

function renderMulti() {
  const sidebar = renderSidebar();
  if (state.user.role !== 'admin' && !state.user.can_run_multi) {
    app.innerHTML = `
      <div class="app-shell">
        ${sidebar}
        <main class="main">
          <div class="panel">
            <h1>Массовое выполнение команд</h1>
            <div class="notice warning">У вашего аккаунта нет разрешения на выполнение массовых команд.</div>
          </div>
        </main>
      </div>
    `;
    bindSidebarHandlers();
    return;
  }
  const machineOptions = state.machines
    .map(
      (m) => `
        <label style="display:flex; align-items:center; gap:8px;">
          <input type="checkbox" value="${m.id}" class="multi-machine" />
          <span>${esc(m.name)}</span>
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

  qs('[data-action="add-machine"]').onclick = () => openAddMachine();
  qs('[data-action="logout"]').onclick = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    state.user = null;
    state.dataLoaded = false;
    navigate('#/login');
  };
}

function bindDeviceHandlers() {
  qsa('.device-card').forEach((card) => {
    card.onclick = () => {
      state.selectedMachineId = Number(card.dataset.id);
      state.activeTab = 'overview';
      render();
    };
  });

  qsa('[data-device-tab]').forEach((tab) => {
    tab.onclick = () => {
      state.deviceTab = tab.dataset.deviceTab;
      state.activeTab = 'overview';
      render();
    };
  });

  qs('#device-search')?.addEventListener('input', (event) => {
    state.searchQuery = event.target.value;
    render();
  });

  qs('#group-filter')?.addEventListener('change', (event) => {
    state.groupFilter = event.target.value;
    render();
  });

  qs('#group-create')?.addEventListener('click', async () => {
    const name = qs('#group-name')?.value.trim();
    if (!name) return;
    try {
      await api('/api/groups', { method: 'POST', body: JSON.stringify({ name }) });
      await refreshData();
      state.groupFilter = 'all';
      render();
    } catch (err) {
      alert(err.message || 'Ошибка создания группы');
    }
  });

  qsa('[data-group-save]').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const id = btn.dataset.groupSave;
      const input = qs(`[data-group-edit="${id}"]`);
      const name = input?.value.trim();
      if (!name) return;
      try {
        await api(`/api/groups/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
        await refreshData();
        render();
      } catch (err) {
        alert(err.message || 'Ошибка обновления группы');
      }
    });
  });

  qsa('[data-group-delete]').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const id = btn.dataset.groupDelete;
      if (!confirm('Удалить группу?')) return;
      await api(`/api/groups/${id}`, { method: 'DELETE' });
      await refreshData();
      render();
    });
  });

  qsa('[data-group-machine]').forEach((select) => {
    select.addEventListener('click', (event) => event.stopPropagation());
    select.addEventListener('change', async (event) => {
      event.stopPropagation();
      const machineId = Number(select.dataset.groupMachine);
      const groupId = select.value || null;
      await api(`/api/machines/${machineId}`, { method: 'PATCH', body: JSON.stringify({ group_id: groupId }) });
      await refreshData();
      render();
    });
  });

  qs('[data-action="toggle-add"]')?.addEventListener('click', () => {
    state.showAddMachine = !state.showAddMachine;
    render();
  });

  qs('[data-action="refresh-status"]')?.addEventListener('click', async () => {
    await loadStatuses();
    render();
  });

  qs('#add-machine-cancel')?.addEventListener('click', () => {
    state.showAddMachine = false;
    render();
  });

  qs('#add-machine-submit')?.addEventListener('click', async () => {
    const payload = {
      name: qs('#add-name').value.trim(),
      visibility: qs('#add-visibility').value,
      group_id: qs('#add-group').value || null,
      ssh_host: qs('#add-ssh-host').value.trim(),
      ssh_port: Number(qs('#add-ssh-port').value),
      ssh_username: qs('#add-ssh-user').value.trim(),
      ssh_auth_type: qs('#add-auth-type').value,
      ssh_password: qs('#add-password').value.trim(),
      ssh_private_key: qs('#add-private-key').value.trim(),
      ssh_passphrase: qs('#add-passphrase').value.trim(),
      notes: qs('#add-notes').value.trim(),
    };
    if (!payload.name || !payload.ssh_host || !payload.ssh_username) {
      alert('Заполните имя, SSH host и SSH username');
      return;
    }
    try {
      await api('/api/machines', { method: 'POST', body: JSON.stringify(payload) });
      state.showAddMachine = false;
      await refreshData();
      render();
    } catch (err) {
      alert(err.message || 'Ошибка создания машины');
    }
  });
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
  state.showAddMachine = true;
  render();
}

async function saveMachine(id) {
  const payload = {
    name: qs('#edit-name').value.trim(),
    group_id: qs('#edit-group').value || null,
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
  await refreshData();
  render();
}

async function deleteMachine(id) {
  if (!confirm('Удалить машину?')) return;
  await api(`/api/machines/${id}`, { method: 'DELETE' });
  await refreshData();
  state.selectedMachineId = state.machines[0]?.id || null;
  render();
}

async function loadServices(machineId, force = false) {
  if (!force && state.services[machineId]) return;
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
    'desktop-real': {
      name: 'Desktop (Real GUI/noVNC)',
      type: 'desktop-real',
      target_host: '127.0.0.1',
      target_port: 6080,
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
  await loadServices(machineId, true);
  render();
}

async function deleteService(id) {
  if (!confirm('Удалить сервис?')) return;
  await api(`/api/services/${id}`, { method: 'DELETE' });
  const machineId = state.selectedMachineId;
  await loadServices(machineId, true);
  render();
}

function openService(serviceId) {
  const frameWrap = qs('#service-frame-wrap');
  const frame = qs('#service-frame');
  if (!frameWrap || !frame) return;
  frame.src = `/proxy/${serviceId}/`;
  frameWrap.style.display = 'block';
}

function getServiceUrl(service) {
  if (!service) return '#';
  const isNoVnc =
    service.type === 'desktop-real' || (service.type === 'desktop' && Number(service.target_port) === 6080);
  if (isNoVnc) {
    const wsPath = `proxy/${service.id}/websockify`;
    return `/proxy/${service.id}/vnc.html?path=${encodeURIComponent(wsPath)}&autoconnect=1&resize=remote`;
  }
  return `/proxy/${service.id}/`;
}

function cleanupTerminal() {
  const session = state.terminalSession;
  if (!session) return;
  if (session.resizeHandler) {
    window.removeEventListener('resize', session.resizeHandler);
  }
  if (session.ws && session.ws.readyState === WebSocket.OPEN) {
    session.ws.close();
  } else if (session.ws) {
    try {
      session.ws.close();
    } catch {
      // ignore
    }
  }
  state.terminalSession = null;
}

async function initTerminal(machineId) {
  const terminalEl = qs('#terminal');
  if (!terminalEl) return;
  cleanupTerminal();
  terminalEl.innerHTML = '<div class="small mono">Connecting...</div>';
  terminalEl.style.minHeight = '420px';
  const hasXterm = window.Terminal && window.FitAddon;
  if (!hasXterm) {
    terminalEl.innerHTML = `
      <div class="small mono" style="margin-bottom:8px;">
        xterm не загрузился. Использую упрощенный терминал.
      </div>
      <pre id="fallback-output" class="panel mono" style="height:320px; overflow:auto; white-space:pre-wrap;"></pre>
      <input id="fallback-input" class="input mono" placeholder="Введите команду и нажмите Enter" />
    `;

    const output = qs('#fallback-output', terminalEl);
    const input = qs('#fallback-input', terminalEl);

    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/ssh/${machineId}`);
    ws.onopen = () => {
      output.textContent += '[WS connected]\n';
      ws.send(JSON.stringify({ type: 'init', cols: 120, rows: 30, term: 'dumb' }));
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'data') {
          output.textContent += msg.data;
        }
        if (msg.type === 'status') {
          output.textContent += `[${msg.data}]\n`;
        }
      } catch {
        output.textContent += String(event.data);
      }
      output.scrollTop = output.scrollHeight;
    };
    ws.onerror = () => {
      output.textContent += '\n[Ошибка подключения]\n';
    };
    ws.onclose = () => {
      output.textContent += '\n[WS closed]\n';
    };

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const value = input.value;
        ws.send(JSON.stringify({ type: 'data', data: (value || '') + '\r' }));
        input.value = '';
      }
    });

    state.terminalSession = { ws, machineId };
    return;
  }
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
    ws.send(JSON.stringify({ type: 'init', cols: term.cols, rows: term.rows, term: 'xterm-256color' }));
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

  const resizeHandler = () => {
    fitAddon.fit();
    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  };
  window.addEventListener('resize', resizeHandler);
  state.terminalSession = { ws, machineId, resizeHandler };
}

async function initSftp(machineId) {
  const body = qs('#sftp-body');
  const pathInput = qs('#sftp-path');

  async function downloadFile(targetPath, fallbackName) {
    try {
      const res = await fetch(
        `/api/sftp/download?machineId=${machineId}&path=${encodeURIComponent(targetPath)}`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || 'Ошибка скачивания');
      }
      const blob = await res.blob();
      const header = res.headers.get('Content-Disposition') || '';
      const match = header.match(/filename\\*=UTF-8''([^;]+)/i) || header.match(/filename=\"?([^\";]+)\"?/i);
      const name = match ? decodeURIComponent(match[1]) : fallbackName || 'download';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message || 'Ошибка скачивания');
    }
  }

  async function refresh() {
    const path = pathInput.value || '/';
    const data = await api(`/api/sftp/list?machineId=${machineId}&path=${encodeURIComponent(path)}`);
    body.innerHTML = data
      .map(
        (item) => `
        <tr>
          <td><span class="mono">${esc(item.name)}</span></td>
          <td>${item.type}</td>
          <td>${item.size || '-'}</td>
          <td>
            ${
              item.type === 'd'
                ? `<button class="button" data-action="enter" data-name="${encodeURIComponent(item.name)}">Открыть</button>`
                : ''
            }
            ${
              item.type !== 'd'
                ? `<button class="button" data-action="download" data-name="${encodeURIComponent(
                    item.name
                  )}">Скачать</button>`
                : ''
            }
            <button class="button danger" data-action="delete" data-name="${encodeURIComponent(item.name)}">Удалить</button>
          </td>
        </tr>
      `
      )
      .join('');

    qsa('[data-action="enter"]').forEach((btn) => {
      btn.onclick = () => {
        const next = path.replace(/\/$/, '') + '/' + decodeURIComponent(btn.dataset.name || '');
        pathInput.value = next;
        refresh();
      };
    });

    qsa('[data-action="download"]').forEach((btn) => {
      btn.onclick = () => {
        const name = decodeURIComponent(btn.dataset.name || '');
        const target = path.replace(/\/$/, '') + '/' + name;
        downloadFile(target, name);
      };
    });

    qsa('[data-action="delete"]').forEach((btn) => {
      btn.onclick = async () => {
        const target = path.replace(/\/$/, '') + '/' + decodeURIComponent(btn.dataset.name || '');
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
    const res = await fetch(`/api/sftp/upload?machineId=${machineId}&path=${encodeURIComponent(path)}`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });
    if (!res.ok) {
      const msg = await res.text();
      alert(msg || 'Ошибка загрузки');
    }
    event.target.value = '';
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

  let result;
  try {
    result = await api('/api/ssh/exec', {
      method: 'POST',
      body: JSON.stringify({ machineIds: selected, command }),
    });
  } catch (err) {
    alert(err.message || 'Ошибка выполнения');
    return;
  }

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
          (t) => `<div class="panel"><strong>${esc(t.token)}</strong><div class="small">Использований: ${t.uses_left}</div><button class="button danger" data-token="${t.id}">Удалить</button></div>`
        )
        .join('')}</div>
    </div>
  `;

  qs('#users-panel').innerHTML = `
    <div class="label">Пользователи</div>
    <div class="grid">${users
      .map(
        (u) => `<div class="panel">
          <strong>${esc(u.email)}</strong>
          <div class="small">${esc(u.role)}</div>
          <label class="small" style="display:flex; gap:8px; align-items:center; margin:8px 0;">
            <input type="checkbox" data-perm="${u.id}" ${u.can_run_multi ? 'checked' : ''} ${u.role === 'admin' ? 'disabled' : ''}/>
            Разрешить мульти-команды
          </label>
          ${u.role === 'admin' ? '<div class="small">Администратора нельзя удалить.</div>' : `<button class="button danger" data-user="${u.id}">Удалить</button>`}
        </div>`
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

  qsa('[data-perm]').forEach((input) => {
    input.onchange = async () => {
      await api(`/api/admin/users/${input.dataset.perm}`, {
        method: 'PATCH',
        body: JSON.stringify({ can_run_multi: input.checked }),
      });
      loadAdminPanels();
    };
  });
}

async function render() {
  const hash = location.hash || '#/login';

  if (!state.user && !hash.startsWith('#/login') && !hash.startsWith('#/register')) {
    await loadMe();
  }

  if (state.user && (hash.startsWith('#/login') || hash.startsWith('#/register'))) {
    navigate('#/dashboard');
    return;
  }

  if (!state.user && (hash.startsWith('#/login') || hash.startsWith('#/register'))) {
    if (hash.startsWith('#/register')) return renderRegister();
    return renderLogin();
  }

  if (!state.user) {
    navigate('#/login');
    return;
  }

  await loadGroups();
  await loadMachines();
  await loadStatuses();

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

