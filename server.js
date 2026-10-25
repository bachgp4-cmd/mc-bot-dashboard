
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
  username: process.env.MC_USERNAME || 'YourBotName',
  auth: process.env.MC_AUTH || 'offline',
  version: process.env.MC_VERSION || false,
  reconnectMs: Math.max(
    5000,
    Number(process.env.RECONNECT_MS) || 15000
  )
};

let bot = null;
let status = 'Đang khởi động';
let reconnectTimer = null;
let reconnectEnabled = true;
let manualDisconnect = false;
let generation = 0;
let currentWindow = null;

const logs = [];
const MAX_LOGS = 250;

function addLog(type, message) {
  const entry = {
    time: new Date().toLocaleTimeString('vi-VN'),
    type,
    message: String(message).slice(0, 1000)
  };

  logs.push(entry);

  if (logs.length > MAX_LOGS) {
    logs.shift();
  }

  console.log(
    `[${entry.time}] [${type}] ${entry.message}`
  );

  io.emit('log', entry);
}

function setStatus(value) {
  status = value;
  io.emit('status', status);
}

function getBotState() {
  return {
    status,
    connected: Boolean(bot && bot.player),
    username: CONFIG.username,
    host: CONFIG.host,
    port: CONFIG.port
  };
}

function getWindowData() {
  if (!bot) {
    return {
      title: 'Chưa kết nối',
      items: []
    };
  }

  const windowToShow = currentWindow || bot.inventory;

  if (!windowToShow) {
    return {
      title: 'Chưa có GUI',
      items: []
    };
  }

  const items = (windowToShow.slots || []).map((item, slot) => {
    if (!item) {
      return {
        slot,
        empty: true,
        name: '',
        count: 0
      };
    }

    return {
      slot,
      empty: false,
      name: item.displayName || item.name || 'Item',
      itemName: item.name || '',
      count: item.count || 1,
      type: item.type
    };
  });

  return {
    title: currentWindow
      ? (currentWindow.title || 'GUI trong game')
      : 'Inventory',
    items
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

  if (!reconnectEnabled || manualDisconnect) {
    return;
  }

  setStatus('Mất kết nối - đang chờ kết nối lại');

  addLog(
    'system',
    `Thử kết nối lại sau ${CONFIG.reconnectMs / 1000} giây`
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;

    if (reconnectEnabled && !manualDisconnect) {
      connectBot();
    }
  }, CONFIG.reconnectMs);
}

function connectBot() {
  clearReconnectTimer();

  if (!reconnectEnabled || manualDisconnect) {
    return;
  }

  // Invalidate callbacks from an older bot instance.
  const thisGeneration = ++generation;

  if (bot) {
    const oldBot = bot;
    bot = null;

    try {
      oldBot.removeAllListeners();
      oldBot.quit();
    } catch (_) {
      try {
        oldBot.end();
      } catch (_) {}
    }
  }

  currentWindow = null;

  setStatus('Đang kết nối...');
  addLog('system', `Đang kết nối tới ${CONFIG.host}:${CONFIG.port}`);

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

    setStatus('Đã đăng nhập - đang vào game');
    addLog('system', 'Đã đăng nhập vào máy chủ Minecraft');
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

    // Public player chat. Server/system messages are logged separately.
    io.emit('playerChat', {
      username,
      message
    });
  });

  newBot.on('windowOpen', (window) => {
    if (thisGeneration !== generation) return;

    currentWindow = window;
    addLog('system', `Đã mở GUI: ${window.title || 'Không có tiêu đề'}`);
    broadcastWindow();
  });

  newBot.on('windowClose', () => {
    if (thisGeneration !== generation) return;

    currentWindow = null;
    addLog('system', 'GUI đã đóng');
    broadcastWindow();
  });

  newBot.on('heldItemChanged', () => {
    if (thisGeneration === generation) {
      broadcastWindow();
    }
  });

  newBot.on('kicked', (reason) => {
    if (thisGeneration !== generation) return;

    addLog('warning', `Server đã đá bot: ${reason}`);
    setStatus('Bị server đá');
  });

  newBot.on('error', (error) => {
    if (thisGeneration !== generation) return;

    addLog('error', error.message || String(error));
  });

  newBot.on('end', (reason) => {
    if (thisGeneration !== generation) return;

    if (bot === newBot) {
      bot = null;
    }

    currentWindow = null;
    addLog('warning', `Bot mất kết nối: ${reason || 'Không rõ lý do'}`);
    broadcastWindow();

    scheduleReconnect();
  });
}

function disconnectBot() {
  manualDisconnect = true;
  clearReconnectTimer();

  const oldBot = bot;
  bot = null;
  currentWindow = null;

  // Prevent the end event from scheduling an automatic reconnect.
  generation++;

  setStatus('Đã ngắt kết nối thủ công');

  if (oldBot) {
    try {
      oldBot.quit();
    } catch (_) {
      try {
        oldBot.end();
      } catch (_) {}
    }
  }

  addLog('system', 'Đã ngắt kết nối theo yêu cầu của bạn');
  broadcastWindow();
}

function sendChatOrCommand(message) {
  if (!bot || !bot.player) {
    throw new Error('Bot chưa vào game');
  }

  const text = String(message || '').trim();

  if (!text) {
    throw new Error('Bạn chưa nhập nội dung');
  }

  if (text.length > 256) {
    throw new Error('Nội dung quá dài');
  }

  // Commands are sent only when you submit them from the dashboard.
  bot.chat(text);

  addLog('sent', text);
}

function clickWindowSlot(slot) {
  if (!bot || !bot.player) {
    throw new Error('Bot chưa vào game');
  }

  const index = Number(slot);

  if (!Number.isInteger(index) || index < 0) {
    throw new Error('Slot không hợp lệ');
  }

  const targetWindow = currentWindow || bot.inventory;

  if (!targetWindow || index >= targetWindow.slots.length) {
    throw new Error('Slot không tồn tại');
  }

  bot.clickWindow(index, 0, 0);
}

io.on('connection', (socket) => {
  socket.emit('initialState', {
    state: getBotState(),
    logs,
    windowData: getWindowData()
  });

  socket.on('connectBot', (callback) => {
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

  socket.on('sendChat', (message, callback) => {
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

  socket.on('clickSlot', async (slot, callback) => {
    try {
      clickWindowSlot(slot);

      // Let the server update the window before refreshing the UI.
      setTimeout(broadcastWindow, 250);

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
    state: getBotState()
  });
});

app.get('/', (_req, res) => {
  res.type('html').send(HTML);
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
  background: #f4f6f9;
  color: #202938;
}
* { box-sizing: border-box; }
body { margin: 0; }
header {
  background: #fff;
  border-bottom: 1px solid #e0e5ec;
  padding: 18px 22px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
h1 { font-size: 21px; margin: 0; }
main {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px;
}
.panel {
  background: #fff;
  border: 1px solid #e1e6ed;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
  min-width: 0;
}
h2 { font-size: 16px; margin: 0 0 13px; }
.state {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 20px;
  padding: 8px 12px;
  background: #eef2f7;
  font-size: 13px;
}
.dot {
  width: 9px; height: 9px; border-radius: 50%;
  background: #8b95a5;
}
.dot.online { background: #16a34a; }
.controls, .sendrow {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
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
button.primary {
  background: #2563eb;
  border-color: #2563eb;
  color: white;
}
button.danger {
  color: #b42318;
  border-color: #f0b8b3;
}
button:disabled { opacity: .5; cursor: not-allowed; }
.info {
  font-size: 13px;
  color: #5e6878;
  margin-top: 12px;
  overflow-wrap: anywhere;
}
.columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
}
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
.logline { padding: 3px 0; border-bottom: 1px solid #f0f2f5; }
.time { color: #7b8493; }
.type { color: #2563eb; font-weight: bold; }
.type.error, .type.warning { color: #b42318; }
.type.success { color: #16803c; }
.type.sent { color: #8a4b08; }
.chatline { padding: 4px 0; border-bottom: 1px solid #f0f2f5; }
input {
  min-width: 0;
  width: 100%;
  border: 1px solid #cbd4df;
  border-radius: 8px;
  background: white;
  color: #202938;
  padding: 11px;
  font-size: 14px;
}
.sendrow input { flex: 1; }
.inventory {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(105px, 1fr));
  gap: 8px;
  max-height: 430px;
  overflow-y: auto;
}
.slot {
  min-height: 62px;
  text-align: left;
  overflow-wrap: anywhere;
  background: #fff;
}
.slot.empty { color: #9aa3b1; background: #f8fafc; }
.slot small { display: block; margin-top: 6px; color: #697586; }
.note { color: #687385; font-size: 12px; line-height: 1.5; }
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
    <span id="status">Đang kết nối...</span>
  </div>
</header>

<main>
  <section class="panel">
    <h2>Kết nối</h2>
    <div class="controls">
      <button id="connect" class="primary">Kết nối / Thử lại</button>
      <button id="disconnect" class="danger">Ngắt kết nối</button>
      <button id="refresh">Làm mới inventory</button>
      <button id="closeWindow">Đóng GUI</button>
    </div>
    <div class="info" id="serverInfo"></div>
    <p class="note">
      Bot tự kết nối lại khi mất kết nối. Chat, lệnh, GUI và inventory
      chỉ được thao tác khi bạn bấm hoặc nhập trên trang này.
    </p>
  </section>

  <section class="panel">
    <h2>Chat và lệnh</h2>
    <form id="chatForm" class="sendrow">
      <input id="chatInput" maxlength="256"
        placeholder="Nhập tin nhắn hoặc lệnh, ví dụ /help"
        autocomplete="off">
      <button class="primary" type="submit">Gửi</button>
    </form>
    <p class="note">Lệnh bắt đầu bằng / sẽ được gửi nguyên văn tới server.</p>
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
        Bấm vào ô để thử thao tác với slot tương ứng.
        Một số GUI đặc biệt có thể cần cách xử lý riêng.
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

function setStatus(status) {
  $('status').textContent = status;
  $('dot').classList.toggle('online', status === 'Online');
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
      socket.emit('clickSlot', item.slot, (result) => {
        if (!result || !result.ok) {
          alert(result && result.error
            ? result.error
            : 'Không thể thao tác slot này');
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
  setStatus(data.state.status);

  $('serverInfo').textContent =
    'Server: ' + data.state.host + ':' + data.state.port +
    ' | Username: ' + data.state.username;

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
  socket.emit('connectBot', showResult);
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard running on port ${PORT}`);

  addLog('system', `Dashboard chạy tại port ${PORT}`);

  // Automatically try to join the server when the web service starts.
  connectBot();
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
