```js
'use strict';

/*
 * Minecraft Bot + Web Dashboard
 * Node.js + Mineflayer + Express + Socket.IO
 *
 * Cài đặt:
 *   npm init -y
 *   npm install mineflayer express socket.io
 *
 * Chạy:
 *   node server.js
 *
 * Dashboard mặc định:
 *   http://127.0.0.1:3000
 *
 * Lưu ý:
 * - Không tự động click menu.
 * - Chỉ click khi người dùng bấm vào ô GUI trên Dashboard.
 * - Chỉ sử dụng trên máy chủ mà bạn được phép truy cập.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const CONFIG = Object.freeze({
  host: 'kingmc.vn',
  port: 25565,
  username: '_caubemocoi_',
  password: process.env.MC_PASSWORD || 'phong123@',
  version: '1.21.11',

  webHost: process.env.WEB_HOST || '127.0.0.1',
  webPort: Number(process.env.WEB_PORT || 3000),

  loginDelay: 3000,
  reconnectDelay: 10000,
  telemetryInterval: 30000,
  jumpDuration: 250,
});

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let bot = null;
let botStatus = 'Đang khởi tạo';
let currentWindow = null;
let hasLoggedIn = false;
let loginTimer = null;
let reconnectTimer = null;
let telemetryTimer = null;
let shuttingDown = false;
let sessionId = 0;

const logs = [];
const MAX_LOGS = 200;
const MAX_COMMAND_LENGTH = 256;

function log(type, message) {
  const entry = {
    time: new Date().toLocaleTimeString('vi-VN'),
    type,
    message: String(message).slice(0, 1000),
  };

  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();

  console.log(`[${entry.time}] [${type}] ${entry.message}`);
  io.emit('system_log', entry);
}

function setStatus(status) {
  botStatus = status;
  io.emit('bot_status', status);
}

function getNearestPlayer() {
  if (!bot || !bot.entity) return null;

  let nearest = null;
  let minDistance = Infinity;

  for (const [username, player] of Object.entries(bot.players || {})) {
    if (
      username === CONFIG.username ||
      !player ||
      !player.entity ||
      !player.entity.position
    ) {
      continue;
    }

    const distance = bot.entity.position.distanceTo(
      player.entity.position
    );

    if (distance < minDistance) {
      minDistance = distance;
      nearest = {
        username,
        distance: Math.round(distance * 10) / 10,
      };
    }
  }

  return nearest;
}

function getTelemetry() {
  const entity = bot && bot.entity;
  const position = entity && entity.position;

  return {
    status: botStatus,
    connected: Boolean(bot && bot.player && entity),
    position: position
      ? {
          x: Math.floor(position.x),
          y: Math.floor(position.y),
          z: Math.floor(position.z),
        }
      : null,
    health: bot && Number.isFinite(bot.health) ? bot.health : null,
    food: bot && Number.isFinite(bot.food) ? bot.food : null,
    nearestPlayer: getNearestPlayer(),
    time: Date.now(),
  };
}

function emitTelemetry() {
  io.emit('telemetry', getTelemetry());
}

function clearSessionTimers() {
  if (loginTimer) clearTimeout(loginTimer);
  if (telemetryTimer) clearInterval(telemetryTimer);

  loginTimer = null;
  telemetryTimer = null;
}

function scheduleReconnect() {
  if (shuttingDown || reconnectTimer) return;

  setStatus('Mất kết nối - chờ kết nối lại');
  log('WARN', 'Sẽ thử kết nối lại sau 10 giây.');

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!shuttingDown) createBot();
  }, CONFIG.reconnectDelay);
}

// Chỉ gửi lệnh đăng nhập một lần trong mỗi phiên bot.
function scheduleLogin(botInstance, thisSession) {
  loginTimer = setTimeout(() => {
    if (
      shuttingDown ||
      sessionId !== thisSession ||
      bot !== botInstance ||
      hasLoggedIn ||
      !botInstance.entity
    ) {
      return;
    }

    hasLoggedIn = true;
    botInstance.chat('/login ' + CONFIG.password);
    log('INFO', 'Đã gửi lệnh đăng nhập.');
  }, CONFIG.loginDelay);
}

function createBot() {
  if (shuttingDown) return;

  clearSessionTimers();

  const thisSession = ++sessionId;
  hasLoggedIn = false;
  currentWindow = null;

  setStatus('Đang kết nối');
  log('INFO', `Đang kết nối ${CONFIG.host}:${CONFIG.port}`);

  try {
    const newBot = mineflayer.createBot({
      host: CONFIG.host,
      port: CONFIG.port,
      username: CONFIG.username,
      password: CONFIG.password,
      version: CONFIG.version,
      auth: 'offline',
      hideErrors: false,
    });

    bot = newBot;

    newBot.on('login', () => {
      if (sessionId !== thisSession) return;
      setStatus('Đã đăng nhập máy chủ');
      log('INFO', 'Kết nối Minecraft thành công.');
    });

    newBot.on('spawn', () => {
      if (sessionId !== thisSession) return;

      setStatus('Đang chơi');
      log('INFO', 'Bot đã spawn trong thế giới.');
      scheduleLogin(newBot, thisSession);

      if (telemetryTimer) clearInterval(telemetryTimer);

      telemetryTimer = setInterval(() => {
        if (
          sessionId !== thisSession ||
          bot !== newBot ||
          !newBot.entity
        ) {
          return;
        }

        // Anti-AFK: nhảy ngắn, không di chuyển hoặc click menu.
        try {
          newBot.setControlState('jump', true);

          setTimeout(() => {
            if (
              sessionId === thisSession &&
              bot === newBot &&
              newBot.entity
            ) {
              newBot.setControlState('jump', false);
            }
          }, CONFIG.jumpDuration);
        } catch (error) {
          log('WARN', 'Không thể thực hiện nhảy: ' + error.message);
        }

        emitTelemetry();
      }, CONFIG.telemetryInterval);

      emitTelemetry();
    });

    newBot.on('health', emitTelemetry);

    newBot.on('playerJoined', (player) => {
      log('INFO', `Người chơi tham gia: ${player.username}`);
    });

    newBot.on('playerLeft', (player) => {
      log('INFO', `Người chơi rời đi: ${player.username}`);
    });

    // Chat do người chơi gửi.
    newBot.on('chat', (username, message) => {
      const entry = {
        time: new Date().toLocaleTimeString('vi-VN'),
        username,
        message: String(message).slice(0, 1000),
      };

      io.emit('game_chat', entry);
      log('CHAT', `${username}: ${entry.message}`);
    });

    // Phản hồi hệ thống, thông báo đăng nhập và các tin nhắn khác.
    newBot.on('messagestr', (message) => {
      const text = String(message).trim();
      if (!text) return;

      // Không ghi lại các thông báo chứa mật khẩu.
      const safeText = text.split(CONFIG.password).join('[ẨN]');
      io.emit('server_message', {
        time: new Date().toLocaleTimeString('vi-VN'),
        message: safeText.slice(0, 1000),
      });
    });

    // Đọc GUI đang mở và chuyển các slot lên Dashboard.
    newBot.on('windowOpen', (window) => {
      if (sessionId !== thisSession) return;

      currentWindow = window;

      const gui = {
        id: window.id,
        title: String(
          window.title || window.type || 'Minecraft GUI'
        ),
        type: String(window.type || 'unknown'),
        slotCount: Array.isArray(window.slots)
          ? window.slots.length
          : 0,
        slots: (window.slots || []).map((item, index) => ({
          slot: index,
          name: item ? String(item.name || 'unknown') : null,
          displayName: item
            ? String(item.displayName || item.name || 'Unknown')
            : null,
          count: item ? item.count : 0,
          itemType: item ? item.type : null,
          metadata: item ? item.metadata : null,
          nbt: undefined,
        })),
      };

      io.emit('gui_open', gui);
      log('INFO', `Mở GUI: ${gui.title} (${gui.slotCount} ô)`);
    });

    newBot.on('windowClose', (window) => {
      if (sessionId !== thisSession) return;

      currentWindow = null;
      io.emit('gui_close', {
        id: window ? window.id : null,
      });

      log('INFO', 'GUI đã đóng.');
    });

    newBot.on('kicked', (reason) => {
      log('WARN', 'Bot bị kick: ' + safeReason(reason));
    });

    newBot.on('error', (error) => {
      if (sessionId !== thisSession) return;
      log('ERROR', 'Minecraft: ' + error.message);
    });

    newBot.on('end', (reason) => {
      if (sessionId !== thisSession) return;

      clearSessionTimers();
      currentWindow = null;

      try {
        newBot.clearControlStates();
      } catch (_) {
        // Bot có thể đã đóng kết nối.
      }

      io.emit('gui_close', {});
      emitTelemetry();

      if (bot === newBot) bot = null;

      log('WARN', 'Kết nối kết thúc: ' + String(reason || 'unknown'));
      scheduleReconnect();
    });
  } catch (error) {
    log('ERROR', 'Không thể tạo bot: ' + error.message);
    scheduleReconnect();
  }
}

function safeReason(reason) {
  let value;

  try {
    value =
      typeof reason === 'string'
        ? reason
        : JSON.stringify(reason);
  } catch (_) {
    value = String(reason);
  }

  return String(value || 'unknown')
    .split(CONFIG.password)
    .join('[ẨN]')
    .slice(0, 500);
}

// Gửi dữ liệu trạng thái ban đầu khi Dashboard kết nối.
io.on('connection', (socket) => {
  log('INFO', 'Dashboard đã kết nối.');

  socket.emit('initial_state', {
    status: botStatus,
    telemetry: getTelemetry(),
    logs,
  });

  socket.on('send_command', (rawCommand) => {
    if (typeof rawCommand !== 'string') return;

    const command = rawCommand.trim().slice(0, MAX_COMMAND_LENGTH);
    if (!command) return;

    if (!bot || !bot.entity) {
      socket.emit('action_error', 'Bot chưa sẵn sàng.');
      return;
    }

    // Tránh gửi mật khẩu đăng nhập hoặc chuỗi chứa mật khẩu vào log.
    if (command.includes(CONFIG.password)) {
      socket.emit('action_error', 'Không gửi mật khẩu qua Dashboard.');
      return;
    }

    try {
      bot.chat(command);
      log('INFO', 'Dashboard gửi lệnh/chat: ' + command);
    } catch (error) {
      socket.emit('action_error', 'Gửi thất bại: ' + error.message);
    }
  });

  // Chỉ click khi người dùng chủ động bấm ô GUI.
  socket.on('click_slot', (payload) => {
    if (!bot || !bot.entity || !currentWindow) {
      socket.emit('action_error', 'Không có GUI đang mở.');
      return;
    }

    const slot = Number(payload && payload.slot);

    if (
      !Number.isInteger(slot) ||
      slot < 0 ||
      !Array.isArray(currentWindow.slots) ||
      slot >= currentWindow.slots.length
    ) {
      socket.emit('action_error', 'Slot không hợp lệ.');
      return;
    }

    // Không cho client yêu cầu click vào một cửa sổ khác.
    if (
      payload &&
      payload.windowId !== undefined &&
      Number(payload.windowId) !== currentWindow.id
    ) {
      socket.emit('action_error', 'GUI đã thay đổi. Hãy thử lại.');
      return;
    }

    const activeBot = bot;
    const activeWindow = currentWindow;
    const activeSession = sessionId;

    try {
      // 0 = nút trái, 0 = chế độ click thông thường.
      activeBot.clickWindow(slot, 0, 0, (error) => {
        if (
          activeSession !== sessionId ||
          activeBot !== bot ||
          activeWindow !== currentWindow
        ) {
          return;
        }

        if (error) {
          socket.emit('action_error', 'Click thất bại: ' + error.message);
          return;
        }

        log('INFO', `Đã gửi thao tác click slot ${slot}.`);
      });
    } catch (error) {
      socket.emit('action_error', 'Click thất bại: ' + error.message);
    }
  });

  socket.on('request_telemetry', () => {
    socket.emit('telemetry', getTelemetry());
  });
});

// Dashboard: nền trắng, responsive, không phụ thuộc file HTML bên ngoài.
app.get('/', (_req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Minecraft Bot Dashboard</title>
<style>
:root {
  color-scheme: light;
  --bg: #f5f7fb;
  --panel: #ffffff;
  --line: #e5e9f2;
  --text: #172033;
  --muted: #68758a;
  --accent: #2563eb;
  --green: #0f9f79;
  --red: #dc3545;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
}
header {
  background: #fff;
  border-bottom: 1px solid var(--line);
  padding: 18px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
h1 { margin: 0; font-size: 21px; }
h2 { font-size: 16px; margin: 0 0 14px; }
.muted { color: var(--muted); }
main { max-width: 1500px; margin: auto; padding: 20px; }
.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 18px;
  min-width: 0;
  box-shadow: 0 3px 12px #17203308;
}
.status-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.stat-label { color: var(--muted); font-size: 12px; }
.stat-value {
  margin-top: 5px;
  font-weight: 700;
  font-size: 17px;
  overflow-wrap: anywhere;
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  background: #94a3b8;
  border-radius: 50%;
  margin-right: 7px;
}
#statusDot { background: #e0a020; }
.gui-panel { margin-bottom: 16px; }
.gui-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.gui-grid {
  display: grid;
  grid-template-columns: repeat(9, minmax(0, 1fr));
  gap: 6px;
}
.slot {
  min-width: 0;
  aspect-ratio: 1;
  border: 1px solid #d7deea;
  border-radius: 8px;
  background: #f3f6fb;
  color: var(--text);
  padding: 4px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  overflow: hidden;
  font-size: 11px;
}
.slot:hover { border-color: var(--accent); background: #eaf1ff; }
.slot.empty { cursor: default; background: #fafbfd; }
.slot-icon { font-size: 21px; line-height: 1.3; }
.slot-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.slot-count { font-weight: 700; }
.columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.feed {
  height: 300px;
  overflow: auto;
  overflow-wrap: anywhere;
  font: 12px/1.65 ui-monospace, SFMono-Regular, Consolas, monospace;
  background: #fafbfd;
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 12px;
}
.feed-row { padding: 2px 0; border-bottom: 1px solid #eef1f6; }
.feed-time { color: #8994a7; margin-right: 7px; }
.chat-message { color: var(--green); }
.server-message { color: #59677d; }
.input-row { display: flex; gap: 10px; margin-top: 16px; }
input {
  flex: 1;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid #d6dce7;
  border-radius: 9px;
  font: inherit;
  outline: none;
}
input:focus { border-color: var(--accent); }
button {
  border: 0;
  border-radius: 9px;
  padding: 10px 16px;
  background: var(--accent);
  color: white;
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}
button:disabled { opacity: .45; cursor: not-allowed; }
.badge {
  border-radius: 999px;
  background: #edf2ff;
  color: #254bb5;
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 650;
}
.hidden { display: none !important; }
@media(max-width: 950px) {
  .status-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media(max-width: 650px) {
  header { padding: 16px; }
  main { padding: 12px; }
  .columns { grid-template-columns: 1fr; }
  .status-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .gui-grid { gap: 3px; }
  .slot { border-radius: 5px; padding: 2px; font-size: 9px; }
  .slot-icon { font-size: 16px; }
  .input-row { flex-wrap: wrap; }
  .input-row input { flex-basis: 100%; }
}
</style>
</head>
<body>
<header>
  <div>
    <h1>⛏ Minecraft Bot Dashboard</h1>
    <div class="muted">Giám sát kết nối và tương tác trực tiếp</div>
  </div>
  <span class="badge" id="connectionBadge">Đang kết nối Dashboard...</span>
</header>
<main>
  <section class="status-grid">
    <div class="panel">
      <div class="stat-label">Trạng thái bot</div>
      <div class="stat-value"><span class="dot" id="statusDot"></span><span id="status">Đang tải...</span></div>
    </div>
    <div class="panel">
      <div class="stat-label">Tọa độ X</div>
      <div class="stat-value" id="x">—</div>
    </div>
    <div class="panel">
      <div class="stat-label">Tọa độ Y</div>
      <div class="stat-value" id="y">—</div>
    </div>
    <div class="panel">
      <div class="stat-label">Tọa độ Z</div>
      <div class="stat-value" id="z">—</div>
    </div>
    <div class="panel">
      <div class="stat-label">Máu / Đói</div>
      <div class="stat-value" id="vitals">— / —</div>
    </div>
    <div class="panel">
      <div class="stat-label">Người chơi gần nhất</div>
      <div class="stat-value" id="nearest">—</div>
    </div>
  </section>

  <section class="panel gui-panel hidden" id="guiPanel">
    <div class="gui-header">
      <div>
        <h2 id="guiTitle">Minecraft GUI</h2>
        <div class="muted" id="guiInfo">Nhấp một ô để gửi thao tác vào game.</div>
      </div>
      <button id="closeGui" type="button">Ẩn khung</button>
    </div>
    <div class="gui-grid" id="guiGrid"></div>
    <p class="muted">Lưu ý: các ô hiển thị có thể gồm cả kho đồ người chơi. Thao tác click sẽ tác động thật trong game.</p>
  </section>

  <section class="columns">
    <div class="panel">
      <h2>📜 Nhật ký hệ thống</h2>
      <div class="feed" id="logs" aria-live="polite"></div>
    </div>
    <div class="panel">
      <h2>💬 Chat trong game</h2>
      <div class="feed" id="chat" aria-live="polite"></div>
    </div>
  </section>

  <section class="panel" style="margin-top:16px">
    <h2>⌨ Điều khiển bot</h2>
    <form id="commandForm" class="input-row">
      <input id="command" maxlength="256" autocomplete="off"
        placeholder="Nhập lệnh hoặc tin nhắn, ví dụ: /spawn" required>
      <button type="submit" id="sendButton">Gửi lệnh</button>
    </form>
    <div class="muted" style="margin-top:8px">
      Lệnh được gửi trực tiếp đến game. Hãy kiểm tra nội dung trước khi gửi.
    </div>
  </section>
</main>

<script src="/socket.io/socket.io.js"></script>
<script>
(function () {
  const socket = io();
  const byId = function (id) { return document.getElementById(id); };

  function addFeed(id, entry, className) {
    const feed = byId(id);
    const row = document.createElement('div');
    row.className = 'feed-row' + (className ? ' ' + className : '');

    const time = document.createElement('span');
    time.className = 'feed-time';
    time.textContent = entry.time || new Date().toLocaleTimeString('vi-VN');

    const message = document.createElement('span');
    message.textContent = entry.message || '';

    row.appendChild(time);
    row.appendChild(message);
    feed.appendChild(row);

    while (feed.children.length > 200) {
      feed.removeChild(feed.firstChild);
    }
    feed.scrollTop = feed.scrollHeight;
  }

  function updateStatus(status) {
    byId('status').textContent = status || 'Không rõ';
    const dot = byId('statusDot');
    dot.style.background =
      status === 'Đang chơi' ? '#0f9f79' :
      status && status.indexOf('Mất kết nối') !== -1 ? '#dc3545' :
      '#e0a020';
  }

  function updateTelemetry(data) {
    if (!data) return;

    updateStatus(data.status);

    const p = data.position;
    byId('x').textContent = p ? p.x : '—';
    byId('y').textContent = p ? p.y : '—';
    byId('z').textContent = p ? p.z : '—';

    byId('vitals').textContent =
      (data.health == null ? '—' : data.health) + ' / ' +
      (data.food == null ? '—' : data.food);

    byId('nearest').textContent = data.nearestPlayer
      ? data.nearestPlayer.username + ' (' +
        data.nearestPlayer.distance + 'm)'
      : 'Không có';
  }

  function renderGui(gui) {
    const panel = byId('guiPanel');
    const grid = byId('guiGrid');

    grid.replaceChildren();
    byId('guiTitle').textContent = gui.title || 'Minecraft GUI';
    byId('guiInfo').textContent =
      'Cửa sổ ID: ' + gui.id + ' · ' + gui.slotCount + ' ô';

    (gui.slots || []).forEach(function (item) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'slot' + (item.name ? '' : ' empty');
      button.disabled = !item.name;

      const icon = document.createElement('span');
      icon.className = 'slot-icon';
      icon.textContent = item.name ? '▣' : '';
      button.appendChild(icon);

      const name = document.createElement('span');
      name.className = 'slot-name';
      name.textContent = item.displayName || '';
      button.appendChild(name);

      const count = document.createElement('span');
      count.className = 'slot-count';
      count.textContent = item.count > 1 ? String(item.count) : '';
      button.appendChild(count);

      button.title = item.name
        ? item.displayName + ' ×' + item.count + ' (slot ' + item.slot + ')'
        : 'Ô trống ' + item.slot;

      button.addEventListener('click', function () {
        if (!window.confirm(
          'Gửi thao tác click slot ' + item.slot + ' vào Minecraft?'
        )) return;

        socket.emit('click_slot', {
          slot: item.slot,
          windowId: gui.id
        });
      });

      grid.appendChild(button);
    });

    panel.classList.remove('hidden');
  }

  socket.on('connect', function () {
    byId('connectionBadge').textContent = 'Dashboard đã kết nối';
  });

  socket.on('disconnect', function () {
    byId('connectionBadge').textContent = 'Dashboard mất kết nối';
  });

  socket.on('initial_state', function (data) {
    updateStatus(data.status);
    updateTelemetry(data.telemetry);

    (data.logs || []).forEach(function (entry) {
      addFeed('logs', {
        time: entry.time,
        message: '[' + entry.type + '] ' + entry.message
      });
    });
  });

  socket.on('bot_status', updateStatus);
  socket.on('telemetry', updateTelemetry);

  socket.on('system_log', function (entry) {
    addFeed('logs', {
      time: entry.time,
      message: '[' + entry.type + '] ' + entry.message
    });
  });

  socket.on('game_chat', function (entry) {
    addFeed('chat', {
      time: entry.time,
      message: '<' + entry.username + '> ' + entry.message
    }, 'chat-message');
  });

  socket.on('server_message', function (entry) {
    addFeed('chat', {
      time: entry.time,
      message: '[Máy chủ] ' + entry.message
    }, 'server-message');
  });

  socket.on('gui_open', renderGui);

  socket.on('gui_close', function () {
    byId('guiPanel').classList.add('hidden');
    byId('guiGrid').replaceChildren();
  });

  socket.on('action_error', function (message) {
    addFeed('logs', {
      message: '[LỖI THAO TÁC] ' + message
    });
  });

  byId('closeGui').addEventListener('click', function () {
    byId('guiPanel').classList.add('hidden');
  });

  byId('commandForm').addEventListener('submit', function (event) {
    event.preventDefault();
    const input = byId('command');
    const command = input.value.trim();

    if (!command) return;

    socket.emit('send_command', command);
    input.value = '';
    input.focus();
  });
})();
</script>
</body>
</html>`);
});

// Trả lời lỗi HTTP đơn giản.
app.use((error, _req, res, _next) => {
  log('ERROR', 'Lỗi web: ' + error.message);
  res.status(500).send('Đã xảy ra lỗi máy chủ.');
});

server.listen(CONFIG.webPort, CONFIG.webHost, () => {
  log(
    'INFO',
    `Dashboard chạy tại http://${CONFIG.webHost}:${CONFIG.webPort}`
  );
  createBot();
});

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  log('INFO', 'Đang tắt ứng dụng...');
  clearSessionTimers();

  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;

  if (bot) {
    try {
      bot.clearControlStates();
      bot.quit('Server dashboard shutting down');
    } catch (_) {
      // Kết nối có thể đã đóng.
    }
  }

  server.close(() => process.exit(0));

  // Không để tiến trình treo vô thời hạn khi socket còn mở.
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```
