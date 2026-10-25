
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT) || 3000;

const CONFIG = {
  host: process.env.MC_HOST || 'kingmc.vn',
  port: Number(process.env.MC_PORT) || 25565,
  username: '',
  auth: process.env.MC_AUTH || 'offline',
  version: process.env.MC_VERSION || false,
  reconnectMs: Math.max(5000, Number(process.env.RECONNECT_MS) || 15000)
};

let bot = null;
let status = 'Chưa kết nối';
let reconnectTimer = null;
let reconnectEnabled = false;
let manualDisconnect = false;
let generation = 0;
let currentWindow = null;

const logs = [];
const MAX_LOGS = 250;

function addLog(type, message) {
  const entry = {
    time: new Date().toLocaleTimeString('vi-VN'),
    type,
    message: String(message ?? '').slice(0, 1000)
  };

  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();

  console.log(`[${entry.time}] [${type}] ${entry.message}`);
  io.emit('log', entry);
}

function setStatus(value) {
  status = value;
  io.emit('status', value);
}

function getWindowData() {
  const win = currentWindow || (bot && bot.inventory);

  if (!win) {
    return { title: 'Inventory / GUI', items: [] };
  }

  return {
    title: currentWindow
      ? (String(currentWindow.title || 'GUI trong game'))
      : 'Inventory',
    items: (win.slots || []).map((item, slot) => ({
      slot,
      empty: !item,
      name: item ? (item.displayName || item.name || 'Item') : '',
      count: item ? (item.count || 1) : 0
    }))
  };
}

function broadcastWindow() {
  io.emit('windowData', getWindowData());
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  clearReconnectTimer();

  if (!reconnectEnabled || manualDisconnect || !CONFIG.username) {
    setStatus('Đã ngắt kết nối');
    return;
  }

  setStatus('Mất kết nối - chờ kết nối lại');
  addLog('system', `Sẽ thử kết nối lại sau ${CONFIG.reconnectMs / 1000} giây`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;

    if (reconnectEnabled && !manualDisconnect) {
      connectBot();
    }
  }, CONFIG.reconnectMs);
}

function connectBot() {
  clearReconnectTimer();

  if (!CONFIG.username) {
    setStatus('Vui lòng nhập username');
    addLog('warning', 'Nhập username trước khi kết nối');
    return;
  }

  if (!reconnectEnabled || manualDisconnect) return;

  const thisGeneration = ++generation;

  if (bot) {
    const oldBot = bot;
    bot = null;

    try {
      oldBot.removeAllListeners();
      oldBot.quit();
    } catch (_) {
      try { oldBot.end(); } catch (_) {}
    }
  }

  currentWindow = null;
  broadcastWindow();

  setStatus('Đang kết nối...');
  addLog('system', `Kết nối ${CONFIG.host}:${CONFIG.port} bằng username ${CONFIG.username}`);

  let newBot;

  try {
    newBot = mineflayer.createBot({
      host: CONFIG.host,
      port: CONFIG.port,
      username: CONFIG.username,
      auth: CONFIG.auth,
      version: CONFIG.version || undefined
    });
  } catch (error) {
    addLog('error', error.message);
    scheduleReconnect();
    return;
  }

  bot = newBot;

  newBot.on('login', () => {
    if (thisGeneration !== generation) return;

    setStatus('Đã đăng nhập - chờ vào game');
    addLog('success', `Đã đăng nhập bằng ${CONFIG.username}`);
  });

  newBot.on('spawn', () => {
    if (thisGeneration !== generation) return;

    setStatus('Online');
    addLog('success', 'Bot đã vào game');
    broadcastWindow();
  });

  newBot.on('messagestr', (message) => {
    if (thisGeneration !== generation) return;
    addLog('chat', message);
  });

  newBot.on('chat', (username, message) => {
    if (thisGeneration !== generation) return;

    io.emit('playerChat', { username, message });
  });

  newBot.on('windowOpen', (window) => {
    if (thisGeneration !== generation) return;

    currentWindow = window;
    addLog('system', `Đã mở GUI: ${String(window.title || 'GUI')}`);
    broadcastWindow();
  });

  newBot.on('windowClose', () => {
    if (thisGeneration !== generation) return;

    currentWindow = null;
    addLog('system', 'GUI đã đóng');
    broadcastWindow();
  });

  newBot.on('kicked', (reason) => {
    if (thisGeneration !== generation) return;

    addLog('warning', `Server đã đá bot: ${String(reason)}`);
    setStatus('Bị server đá');
  });

  newBot.on('error', (error) => {
    if (thisGeneration !== generation) return;
    addLog('error', error.message || String(error));
  });

  newBot.on('end', (reason) => {
    if (thisGeneration !== generation) return;

    if (bot === newBot) bot = null;

    currentWindow = null;
    broadcastWindow();

    addLog('warning', `Mất kết nối: ${reason || 'Không rõ lý do'}`);
    scheduleReconnect();
  });
}

function disconnectBot() {
  manualDisconnect = true;
  reconnectEnabled = false;
  clearReconnectTimer();

  const oldBot = bot;
  bot = null;
  currentWindow = null;

  // Ignore the old bot's end event so it cannot trigger reconnect.
  generation++;

  if (oldBot) {
    try {
      oldBot.quit();
    } catch (_) {
      try { oldBot.end(); } catch (_) {}
    }
  }

  setStatus('Đã ngắt kết nối thủ công');
  addLog('system', 'Đã ngắt kết nối theo yêu cầu');
  broadcastWindow();
}

function sendChatOrCommand(message) {
  if (!bot || !bot.player) {
    throw new Error('Bot chưa vào game');
  }

  const text = String(message || '').trim();

  if (!text) throw new Error('Bạn chưa nhập nội dung');
  if (text.length > 256) throw new Error('Nội dung quá dài');

  // Send only when the user submits the chat form.
  bot.chat(text);
  addLog('sent', text);
}

async function clickWindowSlot(slot, button = 0) {
  if (!bot || !bot.player) {
    throw new Error('Bot chưa vào game');
  }

  const index = Number(slot);
  const mouseButton = Number(button);

  if (!Number.isInteger(index) || index < 0) {
    throw new Error('Slot không hợp lệ');
  }

  if (![0, 1].includes(mouseButton)) {
    throw new Error('Loại click không hợp lệ');
  }

  const win = currentWindow || bot.inventory;

  if (!win || index >= win.slots.length) {
    throw new Error('Slot không tồn tại');
  }

  await bot.clickWindow(index, mouseButton, 0);
  setTimeout(broadcastWindow, 200);
}

io.on('connection', (socket) => {
  socket.emit('initialState', {
    status,
    username: CONFIG.username,
    host: CONFIG.host,
    port: CONFIG.port,
    logs,
    windowData: getWindowData()
  });

  socket.on('connectBot', (username, callback) => {
    const name = String(username || '').trim();

    if (!/^[a-zA-Z0-9_]{1,16}$/.test(name)) {
      if (typeof callback === 'function') {
        callback({
          ok: false,
          error: 'Username phải có 1–16 ký tự, chỉ gồm chữ, số và dấu gạch dưới'
        });
      }
      return;
    }

    CONFIG.username = name;
    manualDisconnect = false;
    reconnectEnabled = true;

    clearReconnectTimer();
    connectBot();

    if (typeof callback === 'function') {
      callback({ ok: true });
    }
  });

  socket.on('disconnectBot', (callback) => {
    disconnectBot();

    if (typeof callback === 'function') {
      callback({ ok: true });
    }
  });

  socket.on('sendChat', async (message, callback) => {
    try {
      sendChatOrCommand(message);

      if (typeof callback === 'function') {
        callback({ ok: true });
      }
    } catch (error) {
      if (typeof callback === 'function') {
        callback({ ok: false, error: error.message });
      }
    }
  });

  socket.on('refreshInventory', (callback) => {
    broadcastWindow();

    if (typeof callback === 'function') {
      callback({ ok: true });
    }
  });

  socket.on('clickSlot', async (slot, button, callback) => {
    // Support older clients that send only (slot, callback).
    if (typeof button === 'function') {
      callback = button;
      button = 0;
    }

    try {
      await clickWindowSlot(slot, button);

      if (typeof callback === 'function') {
        callback({ ok: true });
      }
    } catch (error) {
      if (typeof callback === 'function') {
        callback({ ok: false, error: error.message });
      }
    }
  });

  socket.on('closeWindow', (callback) => {
    try {
      if (!bot || !bot.player) {
        throw new Error('Bot chưa vào game');
      }

      if (currentWindow) {
        bot.closeWindow(currentWindow);
      }

      if (typeof callback === 'function') {
        callback({ ok: true });
      }
    } catch (error) {
      if (typeof callback === 'function') {
        callback({ ok: false, error: error.message });
      }
    }
  });
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    status,
    username: CONFIG.username
  });
});

const HTML = String.raw`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Minecraft Bot Dashboard</title>
<style>
:root {
  color-scheme: light;
  font-family: Arial, Helvetica, sans-serif;
  color: #202938;
  background: #f4f6f9;
}
* { box-sizing: border-box; }
body { margin: 0; }
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 18px 22px;
  background: #fff;
  border-bottom: 1px solid #e0e5ec;
}
h1 { font-size: 21px; margin: 0; }
h2 { font-size: 16px; margin: 0 0 13px; }
main { max-width: 1400px; margin: auto; padding: 20px; }
.panel {
  background: #fff;
  border: 1px solid #e1e6ed;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
  min-width: 0;
}
.state {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 20px;
  padding: 8px 12px;
  background: #eef2f7;
  font-size: 13px;
}
.dot { width: 9px; height: 9px; border-radius: 50%; background: #8b95a5; }
.dot.online { background: #16a34a; }
.controls, .sendrow { display: flex; flex-wrap: wrap; gap: 8px; }
button {
  border: 1px solid #d3dbe5;
  border-radius: 8px;
  padding: 9px 12px;
  background: #fff;
  color: #202938;
  cursor: pointer;
  font-size: 13px;
}
button:hover { background: #f0f5fb; }
button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
button.danger { color: #b42318; border-color: #f0b8b3; }
button:disabled { opacity: .5; cursor: not-allowed; }
label { display: block; font-size: 13px; margin-bottom: 6px; }
input {
  min-width: 0;
  width: 100%;
  border: 1px solid #cbd4df;
  border-radius: 8px;
  background: #fff;
  color: #202938;
  padding: 11px;
  font-size: 14px;
}
.username-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; margin-bottom: 12px; }
.sendrow input { flex: 1; }
.info { font-size: 13px; color: #5e6878; margin-top: 12px; overflow-wrap: anywhere; }
.note { color: #687385; font-size: 12px; line-height: 1.5; }
.columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
.logs, .chat {
  background: #fff;
  color: #202938;
  border: 1px solid #dce2e9;
  border-radius: 8px;
  height: 320px;
  overflow-y: auto;
  padding: 10px;
  font: 12px/1.55 Consolas, monospace;
  overflow-wrap: anywhere;
}
.logline, .chatline { padding: 4px 0; border-bottom: 1px solid #f0f2f5; }
.time { color: #7b8493; }
.type { color: #2563eb; font-weight: bold; }
.type.error, .type.warning { color: #b42318; }
.type.success { color: #16803c; }
.type.sent { color: #8a4b08; }
.inventory {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(105px, 1fr));
  gap: 8px;
  max-height: 430px;
  overflow-y: auto;
}
.slot { min-height: 62px; text-align: left; overflow-wrap: anywhere; }
.slot.empty { color: #9aa3b1; background: #f8fafc; }
.slot small { display: block; margin-top: 6px; color: #697586; }
@media(max-width: 760px) {
  .columns { grid-template-columns: 1fr; }
  main { padding: 12px; }
  header { padding: 14px; }
}
</style>
</head>
<body>
<header>
  <h1>Minecraft Bot Dashboard</h1>
  <div class="state">
    <span id="dot" class="dot"></span>
    <span id="status">Chưa kết nối</span>
  </div>
</header>

<main>
  <section class="panel">
    <h2>Kết nối server</h2>
    <label for="usernameInput">Username Minecraft</label>
    <div class="username-row">
      <input id="usernameInput" maxlength="16"
        placeholder="Nhập username của bot" autocomplete="off">
      <button id="connect" class="primary">Kết nối</button>
    </div>

    <div class="controls">
      <button id="disconnect" class="danger">Ngắt kết nối</button>
      <button id="refresh">Làm mới inventory</button>
      <button id="closeWindow">Đóng GUI</button>
    </div>

    <div class="info" id="serverInfo">Server: kingmc.vn:25565</div>
    <p class="note">
      Khi mất kết nối, bot sẽ tự thử lại bằng username đã nhập gần nhất.
      Bot không tự gửi chat, lệnh hoặc tự thao tác GUI.
    </p>
  </section>

  <section class="panel">
    <h2>Chat và nhập lệnh</h2>
    <form id="chatForm" class="sendrow">
      <input id="chatInput" maxlength="256"
        placeholder="Nhập tin nhắn hoặc lệnh, ví dụ /help"
        autocomplete="off">
      <button class="primary" type="submit">Gửi</button>
    </form>
    <p class="note">Nội dung chỉ được gửi khi bạn bấm nút Gửi.</p>
    <div id="chat" class="chat" aria-live="polite"></div>
  </section>

  <div class="columns">
    <section class="panel">
      <h2>Log hệ thống</h2>
      <div id="logs" class="logs"></div>
    </section>

    <section class="panel">
      <h2 id="windowTitle">Inventory / GUI</h2>
      <div id="inventory" class="inventory"></div>
      <p class="note">
        Bấm vào slot để thao tác. GUI của plugin đặc biệt có thể cần
        xử lý riêng tùy loại giao diện.
      </p>
    </section>
  </div>
</main>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();
const $ = (id) => document.getElementById(id);

function addLog(entry) {
  const row = document.createElement('div');
  row.className = 'logline';

  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = '[' + (entry.time || '') + '] ';

  const type = document.createElement('span');
  type.className = 'type ' + (entry.type || '');
  type.textContent = '[' + (entry.type || 'log') + '] ';

  const message = document.createElement('span');
  message.textContent = entry.message || '';

  row.append(time, type, message);
  $('logs').appendChild(row);

  while ($('logs').children.length > 250) {
    $('logs').firstChild.remove();
  }

  $('logs').scrollTop = $('logs').scrollHeight;
}

function addChat(username, message) {
  const row = document.createElement('div');
  row.className = 'chatline';

  const who = document.createElement('strong');
  who.textContent = username + ': ';

  const content = document.createElement('span');
  content.textContent = message;

  row.append(who, content);
  $('chat').appendChild(row);

  while ($('chat').children.length > 250) {
    $('chat').firstChild.remove();
  }

  $('chat').scrollTop = $('chat').scrollHeight;
}

function setStatus(value) {
  $('status').textContent = value;
  $('dot').classList.toggle('online', value === 'Online');
}

function renderWindow(data) {
  $('windowTitle').textContent = data.title || 'Inventory / GUI';

  const container = $('inventory');
  container.replaceChildren();

  (data.items || []).forEach((item) => {
    const button = document.createElement('button');
    button.className = 'slot' + (item.empty ? ' empty' : '');
    button.disabled = item.empty;

    const title = document.createElement('span');
    title.textContent = item.empty
      ? 'Slot ' + item.slot + ' (trống)'
      : item.name + ' × ' + item.count;

    const small = document.createElement('small');
    small.textContent = 'Slot ' + item.slot;

    button.append(title, small);

    button.addEventListener('click', () => {
      socket.emit('clickSlot', item.slot, 0, (result) => {
        if (!result || !result.ok) {
          alert(result && result.error ? result.error : 'Thao tác thất bại');
        }
      });
    });

    container.appendChild(button);
  });
}

function showResult(result) {
  if (!result || !result.ok) {
    alert(result && result.error ? result.error : 'Thao tác thất bại');
  }
}

socket.on('connect', () => {
  addLog({
    time: new Date().toLocaleTimeString('vi-VN'),
    type: 'system',
    message: 'Dashboard đã kết nối'
  });
});

socket.on('initialState', (data) => {
  setStatus(data.status || 'Chưa kết nối');

  $('usernameInput').value = data.username || '';
  $('serverInfo').textContent =
    'Server: ' + data.host + ':' + data.port +
    (data.username ? ' | Username: ' + data.username : '');

  (data.logs || []).forEach(addLog);
  renderWindow(data.windowData || { title: 'Inventory', items: [] });
});

socket.on('status', setStatus);
socket.on('log', addLog);
socket.on('windowData', renderWindow);

socket.on('playerChat', (data) => {
  addChat(data.username, data.message);
});

$('connect').addEventListener('click', () => {
  const username = $('usernameInput').value.trim();

  socket.emit('connectBot', username, (result) => {
    if (result && result.ok) {
      $('serverInfo').textContent =
        'Server: kingmc.vn:25565 | Username: ' + username;
    }

    showResult(result);
  });
});

$('usernameInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    $('connect').click();
  }
});

$('disconnect').addEventListener('click', () => {
  socket.emit('disconnectBot', showResult);
});

$('refresh').addEventListener('click', () => {
  socket.emit('refreshInventory', showResult);
});

$('closeWindow').addEventListener('click', () => {
  socket.emit('closeWindow', showResult);
});

$('chatForm').addEventListener('submit', (event) => {
  event.preventDefault();

  const input = $('chatInput');
  const message = input.value.trim();

  if (!message) return;

  socket.emit('sendChat', message, (result) => {
    if (result && result.ok) {
      input.value = '';
    } else {
      showResult(result);
    }
  });
});
</script>
</body>
</html>`;

app.get('/', (_req, res) => {
  res.type('html').send(HTML);
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, status, username: CONFIG.username });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard running on port ${PORT}`);
  addLog('system', `Dashboard chạy tại port ${PORT}`);
});

process.on('SIGTERM', () => {
  reconnectEnabled = false;
  manualDisconnect = true;
  clearReconnectTimer();

  try {
    if (bot) bot.quit();
  } catch (_) {}

  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
});
