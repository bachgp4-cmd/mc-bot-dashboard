const express = require('express');
const http = require('http');
const mineflayer = require('mineflayer');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Cấu hình Minecraft
const CONFIG = {
  host: 'kingmc.vn',
  port: 25565,
  version: '1.21.11'
};

// Trạng thái bot
let bot = null;
let botUsername = '';
let reconnectEnabled = true;
let manualDisconnect = false;
let reconnectTimer = null;
let statsTimer = null;
let antiAfkTimer = null;
let menuTimer = null;
let pendingMenuClick = false;
let currentWindow = null;
let connected = false;
let joining = false;

const logs = [];
const MAX_LOGS = 100;

function addLog(message, type = 'info') {
  const entry = {
    message: String(message),
    type,
    time: new Date().toLocaleTimeString('vi-VN')
  };

  logs.push(entry);

  if (logs.length > MAX_LOGS) {
    logs.shift();
  }

  io.emit('log', entry);
}

function sendStatus() {
  io.emit('status', {
    connected,
    joining,
    username: botUsername,
    host: CONFIG.host,
    version: CONFIG.version
  });
}

function clearBotTimers() {
  clearInterval(statsTimer);
  clearInterval(antiAfkTimer);
  clearTimeout(menuTimer);

  statsTimer = null;
  antiAfkTimer = null;
  menuTimer = null;
}

function getWindowTitle(window) {
  if (!window) return 'Cửa sổ không tên';

  try {
    const title = window.title;

    if (typeof title === 'string') {
      return title;
    }

    if (title && typeof title.toString === 'function') {
      return title.toString();
    }

    return 'Menu Minecraft';
  } catch {
    return 'Menu Minecraft';
  }
}

function getItemDisplayName(item) {
  if (!item) return '';

  // Ưu tiên tên hiển thị từ dữ liệu item.
  if (item.customName) {
    return String(item.customName);
  }

  if (item.displayName) {
    return String(item.displayName);
  }

  if (item.name) {
    return String(item.name);
  }

  return 'Vật phẩm';
}

function sendWindowData(window) {
  if (!window) return;

  const slots = (window.slots || []).map((item, index) => {
    if (!item) {
      return {
        index,
        empty: true,
        name: '',
        count: 0
      };
    }

    return {
      index,
      empty: false,
      name: getItemDisplayName(item),
      count: item.count || 1,
      type: item.name || '',
      customName: item.customName || null
    };
  });

  io.emit('window_data', {
    title: getWindowTitle(window),
    slots
  });
}

function sendStats() {
  if (!bot || !connected || !bot.entity) return;

  let nearestPlayer = 'Không có';

  try {
    const players = Object.values(bot.players)
      .filter(player =>
        player.username !== bot.username &&
        player.entity &&
        player.entity.position
      );

    if (players.length > 0) {
      players.sort((a, b) => {
        const da = bot.entity.position.distanceTo(a.entity.position);
        const db = bot.entity.position.distanceTo(b.entity.position);
        return da - db;
      });

      nearestPlayer = players[0].username;
    }
  } catch {}

  const position = bot.entity.position;

  io.emit('stats', {
    x: position.x.toFixed(2),
    y: position.y.toFixed(2),
    z: position.z.toFixed(2),
    health: bot.health,
    food: bot.food,
    nearestPlayer,
    dimension: bot.game ? bot.game.dimension : 'Unknown'
  });
}

function startLoops() {
  clearBotTimers();

  statsTimer = setInterval(sendStats, 3000);

  antiAfkTimer = setInterval(() => {
    if (!bot || !connected) return;

    try {
      bot.setControlState('jump', true);

      setTimeout(() => {
        if (bot && connected) {
          bot.setControlState('jump', false);
        }
      }, 300);
    } catch {}
  }, 30000);
}

function clickMenuSlot24() {
  if (!bot || !connected || !currentWindow) {
    addLog('Không thể chọn slot 24: menu chưa mở.', 'warning');
    return;
  }

  if (!currentWindow.slots || currentWindow.slots.length <= 24) {
    addLog('Menu không có slot thứ 24.', 'warning');
    return;
  }

  try {
    bot.clickWindow(24, 0, 0, (err) => {
      if (err) {
        addLog(`Lỗi chọn slot 24: ${err.message}`, 'error');
      } else {
        addLog('Đã gửi thao tác chọn slot 24.', 'success');
      }
    });
  } catch (err) {
    addLog(`Không thể chọn slot: ${err.message}`, 'error');
  }
}

function startBot(username) {
  if (bot || joining) {
    addLog('Bot đang kết nối hoặc đã kết nối.', 'warning');
    return;
  }

  if (!username || !username.trim()) {
    addLog('Vui lòng nhập username.', 'error');
    return;
  }

  botUsername = username.trim();
  manualDisconnect = false;
  joining = true;

  sendStatus();
  addLog(`Đang kết nối tới ${CONFIG.host} bằng tài khoản ${botUsername}...`);

  try {
    bot = mineflayer.createBot({
      host: CONFIG.host,
      port: CONFIG.port,
      username: botUsername,
      version: CONFIG.version,
      auth: 'offline',
      hideErrors: false
    });
  } catch (err) {
    joining = false;
    bot = null;
    addLog(`Không thể tạo bot: ${err.message}`, 'error');
    sendStatus();
    return;
  }

  const thisBot = bot;

  thisBot.once('login', () => {
    addLog('Đã đăng nhập vào máy chủ Minecraft.', 'success');
  });

  thisBot.once('spawn', () => {
    if (bot !== thisBot) return;

    connected = true;
    joining = false;

    addLog('Bot đã vào thế giới Minecraft.', 'success');
    sendStatus();
    startLoops();
  });

  thisBot.on('message', (jsonMessage) => {
    const message = jsonMessage.toString();

    io.emit('chat_message', {
      username: 'SERVER',
      message,
      time: new Date().toLocaleTimeString('vi-VN')
    });
  });

  thisBot.on('chat', (username, message) => {
    io.emit('chat_message', {
      username,
      message,
      time: new Date().toLocaleTimeString('vi-VN')
    });
  });

  thisBot.on('windowOpen', (window) => {
    if (bot !== thisBot) return;

    currentWindow = window;

    addLog(`Đã mở GUI: ${getWindowTitle(window)}`);
    sendWindowData(window);

    if (pendingMenuClick) {
      pendingMenuClick = false;
      clearTimeout(menuTimer);

      // Đợi GUI ổn định rồi mới chọn slot.
      setTimeout(() => {
        if (bot === thisBot && connected && currentWindow === window) {
          clickMenuSlot24();
        }
      }, 700);
    }
  });

  thisBot.on('windowClose', () => {
    currentWindow = null;
    io.emit('window_closed');
    addLog('GUI trong game đã đóng.');
  });

  thisBot.on('health', sendStats);

  thisBot.on('kicked', (reason) => {
    addLog(`Bot bị kick: ${String(reason)}`, 'warning');
  });

  thisBot.on('error', (err) => {
    addLog(`Lỗi Minecraft: ${err.message}`, 'error');
  });

  thisBot.on('end', () => {
    if (bot !== thisBot) return;

    connected = false;
    joining = false;
    currentWindow = null;

    clearBotTimers();
    io.emit('window_closed');

    addLog('Bot đã mất kết nối.', 'warning');

    bot = null;
    sendStatus();

    if (reconnectEnabled && !manualDisconnect) {
      addLog('Sẽ thử kết nối lại sau 20 giây...');

      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        if (!manualDisconnect && reconnectEnabled && !bot) {
          startBot(botUsername);
        }
      }, 20000);
    }
  });
}

function disconnectBot() {
  manualDisconnect = true;
  reconnectEnabled = false;

  clearTimeout(reconnectTimer);
  clearBotTimers();

  const oldBot = bot;

  bot = null;
  connected = false;
  joining = false;
  currentWindow = null;

  io.emit('window_closed');
  sendStatus();

  if (oldBot) {
    try {
      oldBot.quit('Ngắt kết nối từ dashboard');
    } catch {
      try {
        oldBot.end();
      } catch {}
    }
  }

  addLog('Đã yêu cầu bot ngắt kết nối.', 'warning');
}

function sendMinecraftCommand(command) {
  if (!bot || !connected) {
    addLog('Bot chưa kết nối.', 'error');
    return false;
  }

  const text = String(command || '').trim();

  if (!text) return false;

  try {
    bot.chat(text);
    addLog(`Đã gửi: ${text}`, 'success');
    return true;
  } catch (err) {
    addLog(`Không gửi được lệnh: ${err.message}`, 'error');
    return false;
  }
}

// Giao diện web
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Minecraft Bot Dashboard</title>
<script src="/socket.io/socket.io.js"></script>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: Arial, sans-serif;
  background: #f4f7fb;
  color: #1f2937;
}

header {
  background: #ffffff;
  border-bottom: 1px solid #e5e7eb;
  padding: 16px 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

header h2 {
  margin: 0;
  color: #111827;
}

button {
  border: 0;
  border-radius: 8px;
  padding: 10px 14px;
  cursor: pointer;
  font-weight: 600;
  background: #2563eb;
  color: white;
}

button:hover {
  opacity: .88;
}

button:disabled {
  opacity: .5;
  cursor: not-allowed;
}

.btn-green { background: #16a34a; }
.btn-red { background: #dc2626; }
.btn-gray { background: #64748b; }
.btn-orange { background: #ea580c; }

main {
  max-width: 1400px;
  margin: auto;
  padding: 20px;
}

.panel {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 18px;
  margin-bottom: 18px;
  box-shadow: 0 2px 8px rgba(15,23,42,.04);
}

h3 {
  margin-top: 0;
  color: #111827;
}

input {
  width: 100%;
  padding: 11px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  outline: none;
  background: #fff;
  color: #111827;
  margin: 5px 0 12px;
}

input:focus {
  border-color: #2563eb;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
}

.stat {
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 14px;
}

.stat span {
  display: block;
  color: #64748b;
  font-size: 13px;
}

.stat strong {
  display: block;
  font-size: 21px;
  margin-top: 7px;
  color: #111827;
  overflow-wrap: anywhere;
}

#status {
  font-weight: bold;
  color: #dc2626;
}

#status.online {
  color: #16a34a;
}

.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.chat-box {
  height: 280px;
  overflow-y: auto;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px;
  color: #111827;
  margin-bottom: 10px;
}

.chat-line {
  padding: 5px 0;
  border-bottom: 1px solid #f1f5f9;
  overflow-wrap: anywhere;
}

.chat-line b {
  color: #2563eb;
}

.chat-time {
  color: #94a3b8;
  font-size: 11px;
  margin-right: 6px;
}

.log-box {
  height: 180px;
  overflow-y: auto;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 10px;
  font-family: monospace;
  font-size: 12px;
}

.log-line {
  padding: 4px 0;
  border-bottom: 1px solid #f1f5f9;
  overflow-wrap: anywhere;
}

.log-error { color: #dc2626; }
.log-warning { color: #d97706; }
.log-success { color: #16a34a; }

.window-grid {
  display: grid;
  grid-template-columns: repeat(9, minmax(55px, 1fr));
  gap: 6px;
}

.slot {
  min-height: 65px;
  border: 1px solid #d1d5db;
  border-radius: 7px;
  background: #f8fafc;
  color: #334155;
  padding: 5px;
  font-size: 11px;
  overflow-wrap: anywhere;
}

.slot:not(:disabled):hover {
  background: #dbeafe;
  border-color: #60a5fa;
}

.slot:disabled {
  opacity: .55;
  cursor: default;
}

.slot-index {
  color: #94a3b8;
  display: block;
  font-size: 10px;
}

.hidden {
  display: none !important;
}

footer {
  text-align: center;
  padding: 20px;
  color: #94a3b8;
  font-size: 12px;
}

@media (max-width: 600px) {
  main { padding: 10px; }
  .window-grid {
    grid-template-columns: repeat(5, minmax(45px, 1fr));
  }
}
</style>
</head>

<body>

<header>
  <h2>⛏ Minecraft Bot Dashboard</h2>
  <div class="actions">
    <button class="btn-gray" onclick="toggleDashboard()">Ẩn / hiện dashboard</button>
    <button class="btn-red" onclick="disconnectBot()">Ngắt bot</button>
  </div>
</header>

<main id="dashboard">

  <section class="panel">
    <h3>🔌 Kết nối Minecraft</h3>

    <div class="grid">
      <div>
        <label>Username</label>
        <input id="username" placeholder="Nhập tên Minecraft">
      </div>

      <div>
        <label>Mật khẩu server</label>
        <input id="password" type="password" placeholder="Mật khẩu /login">
      </div>
    </div>

    <div class="actions">
      <button class="btn-green" onclick="connectBot()">Kết nối bot</button>
      <button class="btn-orange" onclick="loginBot()">Đăng nhập /login</button>
    </div>

    <p>Máy chủ: <b>kingmc.vn</b></p>
    <p>Phiên bản: <b>1.21.11</b></p>
    <p>Trạng thái: <span id="status">Đang ngắt kết nối</span></p>
  </section>

  <section class="panel">
    <h3>📊 Thông tin bot</h3>

    <div class="grid">
      <div class="stat">
        <span>Tọa độ X</span>
        <strong id="x">-</strong>
      </div>

      <div class="stat">
        <span>Tọa độ Y</span>
        <strong id="y">-</strong>
      </div>

      <div class="stat">
        <span>Tọa độ Z</span>
        <strong id="z">-</strong>
      </div>

      <div class="stat">
        <span>Máu</span>
        <strong id="health">-</strong>
      </div>

      <div class="stat">
        <span>Thức ăn</span>
        <strong id="food">-</strong>
      </div>

      <div class="stat">
        <span>Người chơi gần nhất</span>
        <strong id="nearest">-</strong>
      </div>
    </div>
  </section>

  <section class="panel">
    <h3>💬 Chat Minecraft</h3>

    <div class="chat-box" id="chat"></div>

    <div class="grid">
      <input id="chatInput" placeholder="Nhập tin nhắn..." onkeydown="if(event.key==='Enter') sendChat()">
      <button onclick="sendChat()">Gửi chat</button>
    </div>

    <button class="btn-gray" onclick="clearChat()">Xóa lịch sử chat</button>
  </section>

  <section class="panel">
    <h3>⌨️ Gửi lệnh</h3>

    <div class="grid">
      <input id="commandInput" placeholder="Ví dụ: /spawn" onkeydown="if(event.key==='Enter') sendCommand()">
      <button onclick="sendCommand()">Gửi lệnh</button>
    </div>

    <div class="actions">
      <button class="btn-gray" onclick="quickCommand('/spawn')">/spawn</button>
      <button class="btn-gray" onclick="quickCommand('/menu')">/menu</button>
      <button class="btn-gray" onclick="quickCommand('/hub')">/hub</button>
    </div>
  </section>

  <section class="panel">
    <h3>🖥 GUI trong game</h3>

    <p id="windowTitle">Chưa có GUI nào được mở.</p>

    <div class="window-grid" id="windowGrid"></div>

    <br>

    <div class="actions">
      <button class="btn-orange" onclick="closeWindow()">Đóng GUI</button>
      <button class="btn-gray" onclick="requestMenu()">Mở /menu</button>
    </div>
  </section>

  <section class="panel">
    <h3>📋 Nhật ký hoạt động</h3>

    <div class="log-box" id="logs"></div>

    <br>
    <button class="btn-gray" onclick="clearLogs()">Xóa nhật ký</button>
  </section>

</main>

<footer>
  Minecraft Bot Dashboard · Mineflayer · Socket.IO
</footer>

<script>
const socket = io();

function connectBot() {
  const username = document.getElementById('username').value.trim();

  if (!username) {
    alert('Bạn chưa nhập username!');
    return;
  }

  socket.emit('start_bot', { username });
}

function loginBot() {
  const password = document.getElementById('password').value;

  if (!password) {
    alert('Bạn chưa nhập mật khẩu!');
    return;
  }

  socket.emit('login_bot', { password });

  // Xóa mật khẩu khỏi ô nhập sau khi gửi.
  document.getElementById('password').value = '';
}

function disconnectBot() {
  if (confirm('Bạn có chắc muốn ngắt kết nối bot?')) {
    socket.emit('disconnect_bot');
  }
}

function sendChat() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();

  if (!message) return;

  socket.emit('send_chat', { message });
  input.value = '';
}

function sendCommand() {
  const input = document.getElementById('commandInput');
  const command = input.value.trim();

  if (!command) return;

  socket.emit('send_command', { command });
  input.value = '';
}

function quickCommand(command) {
  socket.emit('send_command', { command });
}

function requestMenu() {
  socket.emit('send_command', { command: '/menu' });
}

function closeWindow() {
  socket.emit('close_window');
}

function clearChat() {
  document.getElementById('chat').innerHTML = '';
}

function clearLogs() {
  document.getElementById('logs').innerHTML = '';
}

function toggleDashboard() {
  document.getElementById('dashboard').classList.toggle('hidden');
}

function addChat(data) {
  const box = document.getElementById('chat');
  const line = document.createElement('div');

  line.className = 'chat-line';

  const time = document.createElement('span');
  time.className = 'chat-time';
  time.textContent = '[' + (data.time || '') + '] ';

  const name = document.createElement('b');
  name.textContent = data.username + ': ';

  const message = document.createElement('span');
  message.textContent = data.message;

  line.append(time, name, message);
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

function addLog(data) {
  const box = document.getElementById('logs');
  const line = document.createElement('div');

  line.className = 'log-line log-' + (data.type || 'info');
  line.textContent = '[' + data.time + '] ' + data.message;

  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

socket.on('connect', () => {
  socket.emit('check_status');
});

socket.on('status', data => {
  const status = document.getElementById('status');

  if (data.connected) {
    status.textContent = 'Đã kết nối';
    status.className = 'online';
  } else if (data.joining) {
    status.textContent = 'Đang kết nối...';
    status.className = '';
  } else {
    status.textContent = 'Đang ngắt kết nối';
    status.className = '';
  }
});

socket.on('stats', data => {
  document.getElementById('x').textContent = data.x;
  document.getElementById('y').textContent = data.y;
  document.getElementById('z').textContent = data.z;
  document.getElementById('health').textContent = data.health;
  document.getElementById('food').textContent = data.food;
  document.getElementById('nearest').textContent = data.nearestPlayer;
});

socket.on('chat_message', addChat);
socket.on('log', addLog);

socket.on('window_data', data => {
  document.getElementById('windowTitle').textContent =
    'GUI: ' + data.title;

  const grid = document.getElementById('windowGrid');
  grid.innerHTML = '';

  data.slots.forEach(slot => {
    const button = document.createElement('button');
    button.className = 'slot';
    button.disabled = slot.empty;

    const index = document.createElement('span');
    index.className = 'slot-index';
    index.textContent = '#' + slot.index;

    button.appendChild(index);

    if (!slot.empty) {
      const name = document.createElement('span');
      name.textContent = slot.name;

      const count = document.createElement('span');
      count.textContent = ' x' + slot.count;

      button.append(name, count);

      button.onclick = () => {
        socket.emit('click_slot', { slot: slot.index });
      };
    } else {
      button.textContent = '#' + slot.index + ' - Trống';
    }

    grid.appendChild(button);
  });
});

socket.on('window_closed', () => {
  document.getElementById('windowTitle').textContent =
    'Chưa có GUI nào được mở.';

  document.getElementById('windowGrid').innerHTML = '';
});
</script>

</body>
</html>`);
});

// Socket.IO
io.on('connection', (socket) => {
  socket.emit('status', {
    connected,
    joining,
    username: botUsername,
    host: CONFIG.host,
    version: CONFIG.version
  });

  socket.emit('history', logs);

  socket.on('check_status', () => {
    sendStatus();
  });

  socket.on('start_bot', (data = {}) => {
    if (bot || joining) {
      socket.emit('log', {
        message: 'Bot đang kết nối hoặc đã kết nối.',
        type: 'warning',
        time: new Date().toLocaleTimeString('vi-VN')
      });
      return;
    }

    reconnectEnabled = true;
    startBot(data.username);
  });

  socket.on('login_bot', (data = {}) => {
    const password = String(data.password || '');

    if (!bot || !connected) {
      addLog('Hãy kết nối bot trước khi đăng nhập.', 'error');
      return;
    }

    if (!password || password.length > 128) {
      addLog('Mật khẩu không hợp lệ.', 'error');
      return;
    }

    // Không ghi mật khẩu vào log.
    sendMinecraftCommand('/login ' + password);

    addLog('Đã gửi lệnh đăng nhập. Đợi 5 giây trước khi mở menu.');

    clearTimeout(menuTimer);

    menuTimer = setTimeout(() => {
      if (!bot || !connected) return;

      pendingMenuClick = true;
      sendMinecraftCommand('/menu');

      // Không để cờ chờ click tồn tại mãi nếu menu không mở.
      setTimeout(() => {
        if (pendingMenuClick) {
          pendingMenuClick = false;
          addLog('Không thấy GUI mở sau lệnh /menu. Bạn có thể mở menu thủ công.', 'warning');
        }
      }, 10000);
    }, 5000);
  });

  socket.on('send_chat', (data = {}) => {
    const message = String(data.message || '').trim();

    if (!message || message.length > 256) return;

    sendMinecraftCommand(message);
  });

  socket.on('send_command', (data = {}) => {
    const command = String(data.command || '').trim();

    if (!command || command.length > 256) return;

    sendMinecraftCommand(command);
  });

  socket.on('click_slot', (data = {}) => {
    if (!bot || !connected || !currentWindow) {
      addLog('Không có GUI để chọn slot.', 'warning');
      return;
    }

    const slot = Number(data.slot);

    if (!Number.isInteger(slot) ||
        slot < 0 ||
        slot >= currentWindow.slots.length) {
      addLog('Slot không hợp lệ.', 'error');
      return;
    }

    try {
      bot.clickWindow(slot, 0, 0, (err) => {
        if (err) {
          addLog('Lỗi click slot: ' + err.message, 'error');
        } else {
          addLog('Đã chọn slot ' + slot + '.', 'success');
        }
      });
    } catch (err) {
      addLog('Lỗi click: ' + err.message, 'error');
    }
  });

  socket.on('close_window', () => {
    if (!bot || !connected || !currentWindow) {
      addLog('Không có GUI để đóng.', 'warning');
      return;
    }

    try {
      bot.closeWindow(currentWindow);
      currentWindow = null;
      io.emit('window_closed');
      addLog('Đã gửi yêu cầu đóng GUI.');
    } catch (err) {
      addLog('Không đóng được GUI: ' + err.message, 'error');
    }
  });

  socket.on('disconnect_bot', () => {
    disconnectBot();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Dashboard đang chạy tại port ' + PORT);
});
