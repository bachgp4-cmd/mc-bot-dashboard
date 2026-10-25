
'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const CONFIG = {
  host: process.env.MC_HOST || 'kingmc.vn',
  port: Number(process.env.MC_PORT || 25565),
  username: process.env.MC_USERNAME || '_caubemocoi_',
  password: process.env.MC_PASSWORD || '',
  version: process.env.MC_VERSION || false,
  webHost: '0.0.0.0',
  webPort: Number(process.env.PORT || 3000),
  reconnectMs: Math.max(3000, Number(process.env.RECONNECT_MS || 10000)),
  antiAfkMs: Math.max(10000, Number(process.env.ANTI_AFK_MS || 30000)),
  maxLogs: 250,
  maxChat: 100
};

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '32kb' }));

let bot = null;
let botState = 'offline';
let lastError = '';
let reconnectTimer = null;
let antiAfkTimer = null;
let reconnectEnabled = true;
let currentWindow = null;
const logs = [];
const chatHistory = [];
const startedAt = Date.now();

function log(type, message) {
  const entry = {
    time: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
    type: String(type),
    message: String(message).slice(0, 2000)
  };

  logs.push(entry);
  if (logs.length > CONFIG.maxLogs) logs.shift();

  console.log(`[${entry.time}] [${entry.type}] ${entry.message}`);
  io.emit('log', entry);
}

function addChat(username, message, type = 'chat') {
  const entry = {
    time: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
    username: String(username || 'server').slice(0, 64),
    message: String(message || '').slice(0, 1000),
    type
  };

  chatHistory.push(entry);
  if (chatHistory.length > CONFIG.maxChat) chatHistory.shift();

  io.emit('chat', entry);
}

function getWindowSnapshot() {
  if (!bot || !bot.currentWindow) return null;

  const window = bot.currentWindow;

  return {
    title: String(window.title || 'Inventory').replace(/\u00a7./g, ''),
    slots: (window.slots || []).slice(0, 90).map((item, slot) => {
      if (!item) return null;

      return {
        slot,
        name: item.name || 'unknown',
        displayName: item.displayName || item.name || 'Unknown',
        count: item.count || 1
      };
    })
  };
}

function getStatus() {
  const position = bot?.entity?.position;

  return {
    state: botState,
    host: CONFIG.host,
    port: CONFIG.port,
    username: CONFIG.username,
    connected: Boolean(bot && bot.player && botState === 'online'),
    health: Number.isFinite(bot?.health) ? bot.health : null,
    food: Number.isFinite(bot?.food) ? bot.food : null,
    position: position
      ? {
          x: Math.round(position.x * 100) / 100,
          y: Math.round(position.y * 100) / 100,
          z: Math.round(position.z * 100) / 100
        }
      : null,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    lastError,
    window: getWindowSnapshot()
  };
}

function broadcastStatus() {
  io.emit('status', getStatus());
}

function stopTimers() {
  if (antiAfkTimer) clearInterval(antiAfkTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);

  antiAfkTimer = null;
  reconnectTimer = null;
}

function scheduleReconnect() {
  if (!reconnectEnabled || reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    createBot();
  }, CONFIG.reconnectMs);

  log('info', `Thử kết nối lại sau ${CONFIG.reconnectMs / 1000} giây.`);
}

function startAntiAfk() {
  if (antiAfkTimer) clearInterval(antiAfkTimer);

  antiAfkTimer = setInterval(() => {
    if (!bot || botState !== 'online' || !bot.entity) return;

    try {
      bot.setControlState('jump', true);

      setTimeout(() => {
        if (bot && botState === 'online') {
          try {
            bot.setControlState('jump', false);
          } catch (_) {
            // Bot có thể đã ngắt kết nối.
          }
        }
      }, 350);
    } catch (error) {
      log('warn', `Anti-AFK: ${error.message}`);
    }
  }, CONFIG.antiAfkMs);
}

function createBot() {
  if (!reconnectEnabled) return;

  if (bot && (botState === 'connecting' || botState === 'online')) {
    return;
  }

  botState = 'connecting';
  lastError = '';

  log('info', `Đang kết nối ${CONFIG.host}:${CONFIG.port}...`);
  broadcastStatus();

  const options = {
    host: CONFIG.host,
    port: CONFIG.port,
    username: CONFIG.username,
    auth: 'offline',
    hideErrors: false
  };

  if (CONFIG.version) {
    options.version = CONFIG.version;
  }

  let newBot;

  try {
    newBot = mineflayer.createBot(options);
    bot = newBot;
  } catch (error) {
    bot = null;
    botState = 'offline';
    lastError = error.message;

    log('error', `Không tạo được bot: ${error.message}`);
    broadcastStatus();
    scheduleReconnect();
    return;
  }

  newBot.once('login', () => {
    if (bot !== newBot) return;

    botState = 'online';
    log('success', `Đã đăng nhập Minecraft với tên ${CONFIG.username}.`);
    broadcastStatus();
    startAntiAfk();
  });

  newBot.on('spawn', () => {
    if (bot !== newBot) return;

    botState = 'online';
    log('success', 'Bot đã xuất hiện trong thế giới Minecraft.');
    broadcastStatus();
    startAntiAfk();
  });

  newBot.on('message', (jsonMessage) => {
    const message = String(
      jsonMessage?.toString?.() ?? jsonMessage ?? ''
    );

    addChat('server', message, 'server');

    // Tự xác thực nếu máy chủ yêu cầu.
    // Không ghi mật khẩu vào log.
    const plain = message.replace(/\u00a7./g, '');

    if (!CONFIG.password || bot !== newBot) return;

    if (/please\s+login|\/login|đăng nhập|dang nhap/i.test(plain)) {
      setTimeout(() => {
        if (bot !== newBot || botState !== 'online') return;

        try {
          newBot.chat(`/login ${CONFIG.password}`);
          log('info', 'Đã gửi lệnh đăng nhập trong game.');
        } catch (error) {
          log('error', `Gửi lệnh đăng nhập thất bại: ${error.message}`);
        }
      }, 1200);
    } else if (/please\s+register|\/register|đăng ký|dang ky/i.test(plain)) {
      setTimeout(() => {
        if (bot !== newBot || botState !== 'online') return;

        try {
          newBot.chat(`/register ${CONFIG.password} ${CONFIG.password}`);
          log('info', 'Đã gửi lệnh đăng ký trong game.');
        } catch (error) {
          log('error', `Gửi lệnh đăng ký thất bại: ${error.message}`);
        }
      }, 1200);
    }
  });

  newBot.on('chat', (username, message) => {
    if (username !== newBot.username) {
      addChat(username, message);
    }
  });

  newBot.on('windowOpen', (window) => {
    if (bot !== newBot) return;

    currentWindow = window;
    io.emit('window', getWindowSnapshot());
    log('info', `Đã mở giao diện: ${window.title || 'Inventory'}`);
  });

  newBot.on('windowClose', () => {
    if (bot !== newBot) return;

    currentWindow = null;
    io.emit('window', null);
    log('info', 'Giao diện vật phẩm đã đóng.');
  });

  newBot.on('health', broadcastStatus);

  newBot.on('kicked', (reason) => {
    lastError = `Bị máy chủ ngắt: ${
      typeof reason === 'string' ? reason : JSON.stringify(reason)
    }`;

    log('warn', lastError);
  });

  newBot.on('error', (error) => {
    lastError = error?.message || String(error);
    log('error', `Minecraft: ${lastError}`);
  });

  newBot.on('end', (reason) => {
    if (bot !== newBot) return;

    log('warn', `Kết nối đã kết thúc${reason ? `: ${reason}` : '.'}`);

    bot = null;
    botState = 'offline';
    currentWindow = null;

    if (antiAfkTimer) clearInterval(antiAfkTimer);
    antiAfkTimer = null;

    io.emit('window', null);
    broadcastStatus();
    scheduleReconnect();
  });
}

const dashboardHtml = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Minecraft Bot Dashboard</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#f3f6fb;color:#172033;font-family:Arial,sans-serif}
header{padding:20px;background:white;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
h1{margin:0;font-size:22px}
main{max-width:1200px;margin:auto;padding:18px;display:grid;gap:16px}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.columns{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.card{background:white;border:1px solid #e2e8f0;border-radius:12px;padding:16px;min-width:0}
.label,.muted{color:#64748b;font-size:13px}
.value{font-size:21px;font-weight:bold;margin-top:8px;overflow-wrap:anywhere}
h2{font-size:17px;margin:0 0 12px}
.status{padding:8px 12px;background:#e2e8f0;border-radius:20px;align-self:center}
.online{background:#dcfce7;color:#166534}
.offline{background:#fee2e2;color:#991b1b}
.controls{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
input,button{font:inherit;padding:10px;border:1px solid #cbd5e1;border-radius:8px}
input{flex:1;min-width:160px}
button{background:#2563eb;color:white;border-color:#2563eb;cursor:pointer}
.secondary{background:white;color:#334155}
.logs,.chat{height:280px;overflow:auto;background:#111827;color:#e5e7eb;border-radius:8px;padding:10px;font:12px/1.6 monospace;overflow-wrap:anywhere;white-space:pre-wrap}
.inventory{display:grid;grid-template-columns:repeat(9,minmax(0,1fr));gap:5px;margin-top:12px}
.slot{min-width:0;min-height:48px;background:#f8fafc;color:#172033;border:1px solid #cbd5e1;padding:4px;font-size:10px;overflow-wrap:anywhere}
.slot b{display:block}
.foot{color:#64748b;font-size:12px;text-align:center}
@media(max-width:750px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.columns{grid-template-columns:1fr}main{padding:10px}}
</style>
</head>
<body>
<header>
  <div>
    <h1>Minecraft Bot Dashboard</h1>
    <div class="muted" id="server">Đang tải...</div>
  </div>
  <div id="badge" class="status">Đang kết nối</div>
</header>
<main>
  <section class="grid">
    <div class="card"><div class="label">Máu</div><div class="value" id="health">—</div></div>
    <div class="card"><div class="label">Thức ăn</div><div class="value" id="food">—</div></div>
    <div class="card"><div class="label">Tọa độ</div><div class="value" id="position">—</div></div>
    <div class="card"><div class="label">Thời gian chạy</div><div class="value" id="uptime">—</div></div>
  </section>
  <section class="card">
    <h2>Điều khiển bot</h2>
    <div class="muted">Gửi chat hoặc lệnh tới bot trên máy chủ bạn được phép sử dụng.</div>
    <form class="controls" id="commandForm">
      <input id="command" maxlength="256" placeholder="Ví dụ: /spawn" autocomplete="off">
      <button type="submit">Gửi</button>
      <button type="button" class="secondary" id="refresh">Làm mới</button>
      <button type="button" id="reconnect">Kết nối lại</button>
    </form>
  </section>
  <section class="columns">
    <div class="card"><h2>Log trực tiếp</h2><div class="logs" id="logs"></div></div>
    <div class="card"><h2>Chat Minecraft</h2><div class="chat" id="chat"></div></div>
  </section>
  <section class="card">
    <h2>Giao diện / túi đồ</h2>
    <div class="muted" id="windowTitle">Chưa mở giao diện.</div>
    <div class="inventory" id="inventory"></div>
  </section>
  <div class="foot">Cập nhật trạng thái qua Socket.IO.</div>
</main>
<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();
const $ = id => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[char]);
}

function addLog(entry) {
  const el = document.createElement('div');
  el.textContent = '[' + entry.time + '] [' + entry.type + '] ' + entry.message;
  $('logs').appendChild(el);
  while ($('logs').children.length > 250) $('logs').firstChild.remove();
  $('logs').scrollTop = $('logs').scrollHeight;
}

function addChat(entry) {
  const el = document.createElement('div');
  el.textContent = '[' + entry.time + '] ' + entry.username + ': ' + entry.message;
  $('chat').appendChild(el);
  while ($('chat').children.length > 100) $('chat').firstChild.remove();
  $('chat').scrollTop = $('chat').scrollHeight;
}

function formatTime(seconds) {
  seconds = Math.max(0, Number(seconds) || 0);
  return Math.floor(seconds / 3600) + 'h ' +
    Math.floor(seconds % 3600 / 60) + 'm ' +
    Math.floor(seconds % 60) + 's';
}

function showStatus(status) {
  $('server').textContent = status.host + ':' + status.port + ' · ' + status.username;
  $('badge').textContent = status.state;
  $('badge').className = 'status ' + (status.connected ? 'online' :
    (status.state === 'offline' ? 'offline' : ''));

  $('health').textContent = status.health ?? '—';
  $('food').textContent = status.food ?? '—';
  $('position').textContent = status.position
    ? [status.position.x, status.position.y, status.position.z].join(' / ')
    : '—';
  $('uptime').textContent = formatTime(status.uptimeSeconds);

  if (status.window) showWindow(status.window);
}

function showWindow(windowData) {
  $('inventory').replaceChildren();

  if (!windowData) {
    $('windowTitle').textContent = 'Chưa mở giao diện.';
    return;
  }

  $('windowTitle').textContent = windowData.title;
  windowData.slots.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'slot';

    if (item) {
      button.innerHTML = '<b>' + escapeHtml(item.displayName) +
        '</b> ×' + escapeHtml(item.count);
    } else {
      button.textContent = 'Ô ' + index;
    }

    button.addEventListener('click', () => {
      socket.emit('windowClick', {slot: index}, result => {
        if (result && !result.ok) alert(result.error);
      });
    });

    $('inventory').appendChild(button);
  });
}

socket.on('connect', () => {
  addLog({
    time: new Date().toLocaleTimeString('vi-VN'),
    type: 'info',
    message: 'Dashboard đã kết nối.'
  });
});

socket.on('status', showStatus);
socket.on('log', addLog);
socket.on('chat', addChat);
socket.on('window', showWindow);

socket.on('initial', data => {
  (data.logs || []).forEach(addLog);
  (data.chat || []).forEach(addChat);
  if (data.status) showStatus(data.status);
  if (data.window) showWindow(data.window);
});

$('commandForm').addEventListener('submit', event => {
  event.preventDefault();

  const input = $('command');
  const command = input.value.trim();
  if (!command) return;

  socket.emit('command', command, result => {
    if (result && !result.ok) alert(result.error);
  });

  input.value = '';
});

$('refresh').addEventListener('click', () => socket.emit('requestStatus'));
$('reconnect').addEventListener('click', () => socket.emit('reconnectBot'));
</script>
</body>
</html>`;

app.get('/', (_req, res) => {
  res.type('html').send(dashboardHtml);
});

app.get('/healthz', (_req, res) => {
  res.json({ok: true, state: botState});
});

app.get('/api/status', (_req, res) => {
  res.json(getStatus());
});

io.on('connection', socket => {
  socket.emit('initial', {
    logs,
    chat: chatHistory,
    status: getStatus(),
    window: getWindowSnapshot()
  });

  socket.on('requestStatus', () => {
    socket.emit('status', getStatus());
  });

  socket.on('command', (raw, callback) => {
    const reply = typeof callback === 'function' ? callback : () => {};
    const command = String(raw || '').trim();

    if (!command) return reply({ok: false, error: 'Chưa nhập lệnh.'});
    if (command.length > 256) return reply({ok: false, error: 'Lệnh quá dài.'});
    if (!bot || botState !== 'online') {
      return reply({ok: false, error: 'Bot chưa kết nối Minecraft.'});
    }

    try {
      bot.chat(command);
      log('info', 'Đã gửi chat/lệnh từ dashboard.');
      reply({ok: true});
    } catch (error) {
      reply({ok: false, error: error.message});
    }
  });

  socket.on('windowClick', (payload, callback) => {
    const reply = typeof callback === 'function' ? callback : () => {};
    const slot = Number(payload?.slot);

    if (!bot || botState !== 'online' || !bot.currentWindow) {
      return reply({ok: false, error: 'Không có giao diện đang mở.'});
    }

    if (!Number.isInteger(slot) || slot < 0 ||
        slot >= bot.currentWindow.slots.length) {
      return reply({ok: false, error: 'Ô vật phẩm không hợp lệ.'});
    }

    try {
      bot.clickWindow(slot, 0, 0);
      reply({ok: true});
    } catch (error) {
      reply({ok: false, error: error.message});
    }
  });

  socket.on('reconnectBot', () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;

    const oldBot = bot;
    bot = null;
    botState = 'offline';

    if (antiAfkTimer) clearInterval(antiAfkTimer);
    antiAfkTimer = null;

    if (oldBot) {
      try {
        oldBot.quit('Dashboard reconnect');
      } catch (_) {
        // Kết nối đã đóng.
      }
    }

    log('info', 'Đang yêu cầu kết nối lại bot.');
    setTimeout(createBot, 500);
  });
});

setInterval(() => {
  io.emit('status', getStatus());
}, 3000).unref();

server.listen(CONFIG.webPort, CONFIG.webHost, () => {
  log('success', `Dashboard chạy tại ${CONFIG.webHost}:${CONFIG.webPort}`);
  log('info', `Máy chủ Minecraft: ${CONFIG.host}:${CONFIG.port}`);
  createBot();
});

function shutdown(signal) {
  log('warn', `Đang tắt dịch vụ (${signal}).`);
  reconnectEnabled = false;
  stopTimers();

  if (bot) {
    try {
      bot.quit('Server shutdown');
    } catch (_) {
      // Bỏ qua lỗi khi tắt.
    }
    bot = null;
  }

  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

