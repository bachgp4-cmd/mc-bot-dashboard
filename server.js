
'use strict';

const express = require('express');
const http = require('http');
const net = require('net');
const dns = require('dns').promises;
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e6
});

const PORT = Number(process.env.PORT || 10000);
const HOST = process.env.MC_HOST || 'kingmc.vn';
const VERSION = process.env.MC_VERSION || '1.21.11';
const TCP_TIMEOUT = 10000;
const RECONNECT_DELAY = 10000;

let bot = null;
let isRunning = false;
let isOnline = false;
let isConnecting = false;
let statusText = 'Đang ngắt kết nối';

let reconnectTimer = null;
let statsTimer = null;
let sequenceTimers = [];

let currentWindow = null;
let expectedAction = null;

let activeUsername = '';
let activePassword = '';

let connectionId = 0;
let intentionalEnd = false;

const MAX_LOGS = 150;
const logHistory = [];

// ==============================
// LOG VÀ TRẠNG THÁI
// ==============================

function log(message) {
  const line =
    `[${new Date().toLocaleTimeString('vi-VN')}] ${String(message)}`;

  console.log(line);

  logHistory.push(line);

  if (logHistory.length > MAX_LOGS) {
    logHistory.shift();
  }

  io.emit('log', line);
}

function setStatus(text, online = false) {
  statusText = text;
  isOnline = online;

  io.emit('status_update', {
    text,
    online
  });
}

function clearReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function clearStats() {
  if (statsTimer) {
    clearInterval(statsTimer);
    statsTimer = null;
  }
}

function clearSequenceTimers() {
  for (const timer of sequenceTimers) {
    clearTimeout(timer);
  }

  sequenceTimers = [];
}

function later(fn, delay, id) {
  const timer = setTimeout(() => {
    sequenceTimers = sequenceTimers.filter(
      item => item !== timer
    );

    if (
      id !== connectionId ||
      !isRunning ||
      !bot
    ) {
      return;
    }

    fn();
  }, delay);

  sequenceTimers.push(timer);

  return timer;
}

// ==============================
// TÌM ĐỊA CHỈ VÀ CỔNG MINECRAFT
// ==============================

async function resolveMinecraftEndpoint() {
  log(`[DNS] Đang tra cứu SRV của ${HOST}...`);

  let records = [];

  try {
    records = await dns.resolveSrv(
      `_minecraft._tcp.${HOST}`
    );

    log(`[SRV RECORDS] ${JSON.stringify(records)}`);
  } catch (err) {
    log(`[SRV] Không lấy được bản ghi SRV: ${err.code || err.message}`);
  }

  // Không có SRV thì dùng cổng Java mặc định.
  if (!records || records.length === 0) {
    log('[INFO] Không tìm thấy SRV, thử cổng mặc định 25565.');

    return [{
      host: HOST,
      port: 25565
    }];
  }

  // Ưu tiên bản ghi có priority thấp hơn.
  records.sort((a, b) => a.priority - b.priority);

  return records.map(record => ({
    host: record.name.replace(/\.$/, ''),
    port: record.port
  }));
}

// Kiểm tra TCP trước khi tạo bot.
function testTCP(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host,
      port
    });

    let finished = false;

    const finish = (error) => {
      if (finished) return;

      finished = true;
      socket.destroy();

      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    socket.setTimeout(TCP_TIMEOUT);

    socket.on('connect', () => {
      finish();
    });

    socket.on('timeout', () => {
      const err = new Error('TCP connection timeout');
      err.code = 'ETIMEDOUT';
      finish(err);
    });

    socket.on('error', err => {
      finish(err);
    });
  });
}

async function findWorkingEndpoint() {
  const candidates = await resolveMinecraftEndpoint();

  for (const endpoint of candidates) {
    log(`[TARGET] ${endpoint.host}`);
    log(`[PORT] ${endpoint.port}`);

    try {
      await testTCP(endpoint.host, endpoint.port);

      log('[SUCCESS] Kết nối TCP thành công!');

      return endpoint;
    } catch (err) {
      log(
        `[TCP ERROR] ${err.code || 'ERROR'}: ${err.message}`
      );
    }
  }

  throw new Error(
    'Không thể kết nối TCP tới bất kỳ địa chỉ máy chủ nào.'
  );
}

// ==============================
// GUI
// ==============================

function getWindowTitle(window) {
  try {
    const parsed = JSON.parse(window.title);
    return parsed.text || window.title;
  } catch {
    return String(window.title || 'Menu');
  }
}

function publishWindow(window) {
  const slots = (window.slots || []).map(item => {
    if (!item) return null;

    return {
      name: item.name || 'unknown',
      count: item.count || 1,
      displayName: item.displayName || item.name || 'Item'
    };
  });

  io.emit('window_open', {
    title: getWindowTitle(window),
    slots
  });
}

function clickSlot(index, label = 'Dashboard') {
  if (!bot || !isOnline || !currentWindow) {
    log(`Không thể click slot ${index}: GUI không tồn tại.`);
    return;
  }

  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= currentWindow.slots.length
  ) {
    log(`Slot ${index} không hợp lệ.`);
    return;
  }

  Promise.resolve(bot.clickWindow(index, 0, 0))
    .then(() => {
      log(`Đã click slot ${index} (${label}).`);
    })
    .catch(err => {
      log(`Lỗi click slot ${index}: ${err.message}`);
    });
}

// ==============================
// THÔNG TIN BOT
// ==============================

function sendStats() {
  if (!bot || !bot.entity) return;

  const pos = bot.entity.position;

  let nearest = 'Không có';

  const nearby = Object.values(bot.players || {})
    .filter(player =>
      player.username !== bot.username &&
      player.entity
    );

  if (nearby.length > 0) {
    nearby.sort((a, b) =>
      a.entity.position.distanceTo(pos) -
      b.entity.position.distanceTo(pos)
    );

    nearest = nearby[0].username;
  }

  io.emit('stats_update', {
    coords:
      `X: ${pos.x.toFixed(1)}, ` +
      `Y: ${pos.y.toFixed(1)}, ` +
      `Z: ${pos.z.toFixed(1)}`,

    health: Number.isFinite(bot.health)
      ? bot.health
      : '--',

    food: Number.isFinite(bot.food)
      ? bot.food
      : '--',

    nearest
  });
}

// ==============================
// CHUỖI LỆNH SAU KHI SPAWN
// ==============================

function runAfterSpawn(id) {
  if (activePassword) {
    later(() => {
      if (!bot || !isOnline) return;

      bot.chat(`/login ${activePassword}`);
      log('Đã gửi lệnh đăng nhập.');
    }, 5000, id);

    later(() => {
      if (!bot || !isOnline) return;

      bot.chat('/login');
      log('Đã gửi lệnh /login lần hai.');
    }, 8000, id);
  }

  later(() => {
    if (!bot || !isOnline) return;

    expectedAction = 'CLICK_24';

    bot.chat('/menu');
    log('Đã gửi lệnh /menu.');
  }, activePassword ? 12000 : 5000, id);
}

// ==============================
// KẾT NỐI LẠI
// ==============================

function scheduleReconnect(reason) {
  if (!isRunning || intentionalEnd) return;

  clearReconnect();
  clearSequenceTimers();
  clearStats();

  isConnecting = false;
  expectedAction = null;
  currentWindow = null;

  io.emit('window_close');

  setStatus('Mất kết nối, đang chờ kết nối lại...', false);

  log(`Kết nối đã đóng: ${reason || 'Không rõ nguyên nhân'}`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;

    if (isRunning) {
      startBot();
    }
  }, RECONNECT_DELAY);

  log('Sẽ thử kết nối lại sau 10 giây.');
}

// ==============================
// TẠO BOT
// ==============================

async function startBot() {
  if (!isRunning || isConnecting) return;

  clearReconnect();
  clearSequenceTimers();
  clearStats();

  const id = ++connectionId;

  intentionalEnd = false;
  isConnecting = true;

  expectedAction = null;
  currentWindow = null;

  const previousBot = bot;
  bot = null;

  if (previousBot) {
    try {
      previousBot.removeAllListeners();
      previousBot.quit('Thay thế phiên cũ');
    } catch {}
  }

  setStatus('Đang kiểm tra kết nối máy chủ...', false);

  log(`Đang kiểm tra ${HOST}...`);

  let endpoint;

  try {
    endpoint = await findWorkingEndpoint();
  } catch (err) {
    if (id !== connectionId || !isRunning) return;

    isConnecting = false;

    log(`[NETWORK ERROR] ${err.message}`);

    scheduleReconnect(err.message);
    return;
  }

  if (id !== connectionId || !isRunning) return;

  setStatus('Đang đăng nhập Minecraft...', false);

  log(
    `Đang tạo bot tới ${endpoint.host}:${endpoint.port}...`
  );

  let newBot;

  try {
    newBot = mineflayer.createBot({
      host: endpoint.host,
      port: endpoint.port,
      username: activeUsername,
      version: VERSION
    });
  } catch (err) {
    isConnecting = false;

    log(`[CREATE BOT ERROR] ${err.message}`);

    scheduleReconnect(err.message);
    return;
  }

  bot = newBot;

  newBot.on('login', () => {
    if (id !== connectionId) return;

    log('Đã hoàn tất bước login giao thức.');
  });

  newBot.on('spawn', () => {
    if (id !== connectionId) return;

    isConnecting = false;

    log('Bot đã spawn trong thế giới.');

    setStatus('Đang hoạt động (Online)', true);

    clearStats();

    statsTimer = setInterval(sendStats, 1000);

    runAfterSpawn(id);
  });

  newBot.on('message', message => {
    if (id !== connectionId) return;

    const value = message?.toString?.() || '';

    if (value.trim()) {
      io.emit('chat_msg', value);
    }
  });

  newBot.on('kicked', (reason, loggedIn) => {
    if (id !== connectionId) return;

    const detail =
      typeof reason === 'string'
        ? reason
        : JSON.stringify(reason);

    log(
      `[KICKED] loggedIn=${loggedIn}; reason=${detail}`
    );

    isRunning = false;
    intentionalEnd = true;
    isConnecting = false;

    clearReconnect();
    clearSequenceTimers();
    clearStats();

    setStatus(
      'Máy chủ đã kick bot; hãy kiểm tra lý do.',
      false
    );
  });

  newBot.on('windowOpen', window => {
    if (id !== connectionId) return;

    currentWindow = window;

    log(
      `Đã mở GUI: ${getWindowTitle(window)} ` +
      `(${window.slots.length} ô).`
    );

    publishWindow(window);

    if (expectedAction === 'CLICK_24') {
      expectedAction = null;

      later(() => {
        if (currentWindow !== window) return;

        clickSlot(24, 'sau /menu');

        later(() => {
          if (!bot || !isOnline) return;

          expectedAction = 'RANDOM_0_9';

          bot.chat('/afk');
          log('Đã gửi lệnh /afk.');
        }, 4000, id);
      }, 3000, id);

    } else if (expectedAction === 'RANDOM_0_9') {
      expectedAction = null;

      later(() => {
        if (currentWindow !== window) return;

        const slot = Math.floor(Math.random() * 10);

        clickSlot(slot, 'lựa chọn menu');
      }, 1500, id);
    }
  });

  newBot.on('windowClose', () => {
    if (id !== connectionId) return;

    currentWindow = null;

    io.emit('window_close');
  });

  newBot.on('health', () => {
    if (id === connectionId) {
      sendStats();
    }
  });

  newBot.on('end', reason => {
    if (id !== connectionId) return;

    bot = null;
    isConnecting = false;

    scheduleReconnect(reason);
  });

  newBot.on('error', err => {
    if (id !== connectionId) return;

    log(`[ERROR] ${err.code || ''} ${err.message}`);

    setStatus('Có lỗi kết nối; xem nhật ký.', false);
  });
}

// ==============================
// NGẮT BOT
// ==============================

function closeBot(reason = 'Đã ngắt kết nối') {
  isRunning = false;
  intentionalEnd = true;
  isConnecting = false;

  connectionId++;

  clearReconnect();
  clearSequenceTimers();
  clearStats();

  expectedAction = null;
  currentWindow = null;

  const oldBot = bot;
  bot = null;

  if (oldBot) {
    try {
      oldBot.quit(reason);
    } catch (err) {
      log(`Lỗi khi đóng bot: ${err.message}`);
    }
  }

  io.emit('window_close');

  setStatus(reason, false);
}

// ==============================
// DASHBOARD
// ==============================

app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Minecraft Bot Dashboard</title>

<style>
*{box-sizing:border-box}
body{
  margin:0;padding:18px;background:#f3f5f7;
  color:#222;font:15px Arial,sans-serif
}
main{
  max-width:1050px;margin:auto;background:white;
  padding:22px;border-radius:12px;
  box-shadow:0 3px 18px #0001
}
h2{
  display:flex;justify-content:space-between;
  gap:12px;flex-wrap:wrap;color:#26733a
}
.grid{
  display:grid;grid-template-columns:repeat(2,minmax(0,1fr));
  gap:12px
}
.box{
  border:1px solid #ddd;border-radius:8px;
  padding:12px;margin:12px 0
}
label{
  display:block;font-weight:bold;
  font-size:13px;margin:5px 0
}
input{
  width:100%;padding:11px;border:1px solid #bbb;
  border-radius:6px;margin:4px 0 8px
}
button{
  border:0;border-radius:6px;padding:11px 15px;
  color:white;background:#288b45;
  font-weight:bold;cursor:pointer;margin:3px
}
button.red{background:#c43d3d}
button.blue{background:#087db5}
.actions{display:flex;flex-wrap:wrap;gap:6px}
.stats{
  display:grid;grid-template-columns:repeat(4,1fr);
  gap:8px
}
.stat{
  background:#f7f8f8;border:1px solid #ddd;
  padding:10px;border-radius:7px;font-size:13px
}
.stat b{display:block;margin-top:6px}
.panel{
  height:230px;overflow:auto;background:#101820;
  color:#e7edf1;padding:10px;border-radius:7px;
  font:12px/1.5 Consolas,monospace;
  white-space:pre-wrap;overflow-wrap:anywhere
}
#gui{display:none}
.slots{
  display:grid;grid-template-columns:repeat(9,minmax(0,1fr));
  gap:4px
}
.slot{
  min-height:42px;background:#777;color:white;
  border:2px outset #bbb;display:grid;
  place-items:center;text-align:center;
  font-size:10px;overflow-wrap:anywhere;cursor:pointer
}
.status{font-size:13px;color:#555}
@media(max-width:700px){
  .grid,.stats{grid-template-columns:1fr 1fr}
}
</style>
</head>

<body>
<main>

<h2>
  <span>🤖 Minecraft Bot Dashboard</span>
  <span id="status" class="status">Đang ngắt kết nối</span>
</h2>

<div class="box">
  <div class="grid">
    <div>
      <label>Username trong game</label>
      <input id="username" autocomplete="off"
        placeholder="Nhập username">
    </div>

    <div>
      <label>Mật khẩu /login (nếu cần)</label>
      <input id="password" type="password"
        autocomplete="new-password"
        placeholder="Nhập mật khẩu">
    </div>
  </div>

  <div class="actions">
    <button id="connect">Kết nối bot</button>
    <button id="disconnect" class="red">Ngắt kết nối</button>
  </div>

  <p class="status">
    Máy chủ: ${HOST} · Phiên bản: ${VERSION}
  </p>
</div>

<div class="stats">
  <div class="stat">Tọa độ<b id="coords">--</b></div>
  <div class="stat">Máu<b id="health">--</b></div>
  <div class="stat">Độ đói<b id="food">--</b></div>
  <div class="stat">Người chơi gần nhất<b id="nearest">--</b></div>
</div>

<div id="gui" class="box">
  <b id="guiTitle">Menu trong game</b>
  <div id="slots" class="slots"></div>
</div>

<div class="grid">
  <div class="box">
    <b>📜 Nhật ký hệ thống</b>
    <div id="logs" class="panel"></div>
  </div>

  <div class="box">
    <b>💬 Chat trong game</b>
    <div id="chat" class="panel"></div>
  </div>
</div>

<div class="box">
  <label>Lệnh / tin nhắn</label>

  <div class="actions">
    <input id="command"
      placeholder="Nhập lệnh hoặc chat..."
      style="flex:1;min-width:180px">

    <button id="send" class="blue">Gửi</button>
  </div>
</div>

</main>

<script src="/socket.io/socket.io.js"></script>

<script>
const $ = id => document.getElementById(id);

const socket = io();

function append(id, text) {
  const el = $(id);
  const line = document.createElement('div');

  line.textContent = text;

  el.appendChild(line);

  while (el.children.length > 150) {
    el.removeChild(el.firstChild);
  }

  el.scrollTop = el.scrollHeight;
}

socket.on('connect', () => {
  append('logs', 'Đã kết nối Dashboard.');
});

socket.on('connect_error', err => {
  append('logs', 'Lỗi Dashboard: ' + err.message);
});

socket.on('log', message => {
  append('logs', message);
});

socket.on('chat_msg', message => {
  append('chat', message);
});

socket.on('status_update', data => {
  $('status').textContent = data.text;

  $('status').style.color =
    data.online ? '#218838' : '#c43d3d';
});

socket.on('stats_update', data => {
  $('coords').textContent = data.coords;
  $('health').textContent = data.health;
  $('food').textContent = data.food;
  $('nearest').textContent = data.nearest;
});

socket.on('window_close', () => {
  $('gui').style.display = 'none';
});

socket.on('window_open', data => {
  $('gui').style.display = 'block';

  $('guiTitle').textContent =
    data.title + ' (' + data.slots.length + ' ô)';

  $('slots').replaceChildren();

  data.slots.forEach((item, index) => {
    const cell = document.createElement('button');

    cell.className = 'slot';

    cell.textContent = item
      ? item.displayName + ' ×' + item.count
      : '';

    cell.title = item ? item.name : 'Ô trống';

    cell.style.background = item ? '#777' : '#aaa';

    cell.onclick = () => {
      socket.emit('click_slot', index);
    };

    $('slots').appendChild(cell);
  });
});

$('connect').onclick = () => {
  const username = $('username').value.trim();
  const password = $('password').value;

  if (!username) {
    alert('Hãy nhập username.');
    return;
  }

  socket.emit('connect_bot', {
    username,
    password
  });
};

$('disconnect').onclick = () => {
  socket.emit('disconnect_bot');
};

function sendCommand() {
  const value = $('command').value.trim();

  if (!value) return;

  socket.emit('send_command', value);

  $('command').value = '';
}

$('send').onclick = sendCommand;

$('command').addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    sendCommand();
  }
});
</script>

</body>
</html>`);
});

// ==============================
// SOCKET.IO
// ==============================

io.on('connection', socket => {
  log(`Có người truy cập Dashboard: ${socket.id}`);

  socket.emit('status_update', {
    text: statusText,
    online: isOnline
  });

  for (const line of logHistory) {
    socket.emit('log', line);
  }

  socket.on('connect_bot', data => {
    if (!data || typeof data.username !== 'string') {
      return;
    }

    const username = data.username.trim();

    const password =
      typeof data.password === 'string'
        ? data.password
        : '';

    if (
      !username ||
      username.length > 16 ||
      password.length > 128
    ) {
      socket.emit('log', 'Username hoặc mật khẩu không hợp lệ.');
      return;
    }

    log(`Người dùng yêu cầu kết nối bot: ${username}`);

    activeUsername = username;
    activePassword = password;

    isRunning = true;
    intentionalEnd = false;

    clearReconnect();

    // Nếu đang có phiên cũ, đóng phiên đó trước.
    if (bot) {
      closeBot('Thay đổi tài khoản bot');

      isRunning = true;
      intentionalEnd = false;
    }

    startBot();
  });

  socket.on('disconnect_bot', () => {
    closeBot('Đã ngắt kết nối thủ công');

    log('Người dùng đã ngắt kết nối bot.');
  });

  socket.on('send_command', command => {
    if (
      typeof command !== 'string' ||
      command.length > 256
    ) {
      return;
    }

    if (!bot || !isRunning || !isOnline) {
      socket.emit('log', 'Bot chưa online.');
      return;
    }

    const cmd = command.trim();

    if (!cmd) return;

    if (cmd.toLowerCase() === '/menu') {
      expectedAction = 'CLICK_24';
    }

    if (cmd.toLowerCase() === '/afk') {
      expectedAction = 'RANDOM_0_9';
    }

    try {
      bot.chat(cmd);

      log(`Đã gửi lệnh từ Dashboard: ${cmd}`);
    } catch (err) {
      log(`Không gửi được lệnh: ${err.message}`);
    }
  });

  socket.on('click_slot', index => {
    if (!Number.isInteger(index)) return;

    clickSlot(index, 'click từ Dashboard');
  });
});

// ==============================
// KHỞI ĐỘNG SERVER
// ==============================

server.listen(PORT, '0.0.0.0', () => {
  console.log('=================================');
  console.log('Minecraft Bot Dashboard đã chạy');
  console.log(`Dashboard port: ${PORT}`);
  console.log(`Minecraft host: ${HOST}`);
  console.log(`Minecraft version: ${VERSION}`);
  console.log('=================================');
});

// ==============================
// TẮT ỨNG DỤNG
// ==============================

function shutdown() {
  log('Đang tắt ứng dụng...');

  closeBot('Ứng dụng đang tắt');

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(0);
  }, 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
