from pathlib import Path

code = r''''use strict';

/*
 * Minecraft Mineflayer Dashboard
 * Node.js 18+
 *
 * Cài đặt:
 *   npm install express socket.io mineflayer
 *
 * Chạy (Windows PowerShell):
 *   $env:MC_HOST="kingmc.vn"
 *   $env:MC_VERSION="1.20.1"
 *   $env:DASHBOARD_TOKEN="dat-mot-chuoi-bi-mat-dai"
 *   node server.js
 *
 * Tài khoản và mật khẩu game được nhập trong Dashboard, không ghi cứng vào file.
 * Chỉ sử dụng bot nếu nội quy máy chủ cho phép.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e6,
  cors: { origin: false }
});

const PORT = Number(process.env.PORT || 10000);
const HOST = process.env.MC_HOST || 'kingmc.vn';
const VERSION = process.env.MC_VERSION || '1.20.1';
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || '';

let bot = null;
let isRunning = false;
let isOnline = false;
let statusText = 'Đang ngắt kết nối';
let reconnectTimer = null;
let statsTimer = null;
let sequenceTimers = [];
let currentWindow = null;
let expectedAction = null;
let activePassword = '';
let activeUsername = '';
let connectionId = 0;
let intentionalEnd = false;
let reconnectDelay = 10000;

const MAX_LOGS = 150;
const logHistory = [];

function log(message) {
  const line = `[${new Date().toLocaleTimeString('vi-VN')}] ${String(message)}`;
  console.log(line);
  logHistory.push(line);
  if (logHistory.length > MAX_LOGS) logHistory.shift();
  io.emit('log', line);
}

function setStatus(text, online = false) {
  statusText = text;
  isOnline = online;
  io.emit('status_update', { text, online });
}

function clearSequenceTimers() {
  for (const timer of sequenceTimers) clearTimeout(timer);
  sequenceTimers = [];
}

function later(fn, delay, id) {
  const timer = setTimeout(() => {
    sequenceTimers = sequenceTimers.filter(item => item !== timer);
    if (id !== connectionId || !isRunning || !bot) return;
    fn();
  }, delay);
  sequenceTimers.push(timer);
  return timer;
}

function clearReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function clearStats() {
  if (statsTimer) clearInterval(statsTimer);
  statsTimer = null;
}

function closeBot(reason = 'Ngắt kết nối') {
  isRunning = false;
  intentionalEnd = true;
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
      log(`Không thể đóng kết nối sạch: ${err.message}`);
    }
  }

  io.emit('window_close');
  setStatus(reason, false);
}

function getWindowTitle(window) {
  try {
    const parsed = JSON.parse(window.title);
    return parsed.text || window.title;
  } catch {
    return String(window.title || 'Menu');
  }
}

function publishWindow(window) {
  const slots = (window.slots || []).map(item => item ? ({
    name: item.name || 'unknown',
    count: item.count || 1,
    displayName: item.displayName || item.name || 'Item'
  }) : null);

  io.emit('window_open', {
    title: getWindowTitle(window),
    slots
  });
}

function sendStats() {
  if (!bot || !bot.entity) return;

  const pos = bot.entity.position;
  let nearest = 'Không có';

  const nearby = Object.values(bot.players || {})
    .filter(player => player.username !== bot.username && player.entity);

  if (nearby.length) {
    nearby.sort((a, b) =>
      a.entity.position.distanceTo(pos) - b.entity.position.distanceTo(pos)
    );
    nearest = nearby[0].username;
  }

  io.emit('stats_update', {
    coords: `X: ${pos.x.toFixed(1)}, Y: ${pos.y.toFixed(1)}, Z: ${pos.z.toFixed(1)}`,
    health: Number.isFinite(bot.health) ? bot.health : '--',
    food: Number.isFinite(bot.food) ? bot.food : '--',
    nearest
  });
}

function clickSlot(index, label) {
  if (!bot || !isOnline || !currentWindow) {
    log(`Bỏ qua thao tác ${label}: hiện không có GUI hợp lệ.`);
    return;
  }

  if (!Number.isInteger(index) || index < 0 || index >= currentWindow.slots.length) {
    log(`Slot ${index} không hợp lệ với GUI hiện tại.`);
    return;
  }

  const thisBot = bot;
  Promise.resolve(thisBot.clickWindow(index, 0, 0))
    .then(() => log(`Đã click slot ${index} (${label}).`))
    .catch(err => log(`Lỗi click slot ${index}: ${err.message}`));
}

function runAfterSpawn(id) {
  // Các bước này là thao tác thông thường trong game, không nhằm vượt cơ chế
  // chống bot hoặc né quy định của máy chủ.
  if (activePassword) {
    later(() => {
      if (!bot || !isOnline) return;
      bot.chat(`/login ${activePassword}`);
      log('Đã gửi lệnh đăng nhập trong game.');
    }, 5000, id);

    later(() => {
      if (!bot || !isOnline) return;
      bot.chat('/login');
      log('Đã gửi lệnh /login lần hai theo cấu hình cũ.');
    }, 8000, id);
  }

  later(() => {
    if (!bot || !isOnline) return;
    expectedAction = 'CLICK_24';
    bot.chat('/menu');
    log('Đã gửi lệnh /menu.');
  }, activePassword ? 12000 : 5000, id);
}

function scheduleReconnect(reason) {
  if (!isRunning || intentionalEnd) return;

  clearReconnect();
  clearSequenceTimers();
  clearStats();
  expectedAction = null;
  currentWindow = null;
  io.emit('window_close');
  setStatus('Mất kết nối, đang chờ kết nối lại...', false);

  log(`Kết nối đã đóng: ${reason || 'không có lý do chi tiết'}`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (isRunning) startBot();
  }, reconnectDelay);

  log(`Sẽ thử kết nối lại sau ${Math.round(reconnectDelay / 1000)} giây.`);
}

function startBot() {
  if (!isRunning) return;

  clearReconnect();
  clearSequenceTimers();
  clearStats();

  // Đánh dấu phiên mới để callback của phiên cũ không tác động lên bot mới.
  const id = ++connectionId;
  intentionalEnd = false;
  expectedAction = null;
  currentWindow = null;

  const previousBot = bot;
  bot = null;
  if (previousBot) {
    try {
      previousBot.removeAllListeners();
      previousBot.quit('Thay thế phiên kết nối cũ');
    } catch {}
  }

  setStatus('Đang kết nối...', false);
  log(`Đang kết nối ${HOST} bằng phiên bản ${VERSION}...`);

  let newBot;
  try {
    newBot = mineflayer.createBot({
      host: HOST,
      username: activeUsername,
      version: VERSION
      // Không tự ý đổi auth mode. Hãy dùng đúng chế độ xác thực
      // mà máy chủ yêu cầu; nếu chưa rõ, kiểm tra tài liệu/server admin.
    });
  } catch (err) {
    log(`Không thể tạo bot: ${err.message}`);
    scheduleReconnect(err.message);
    return;
  }

  bot = newBot;

  newBot.on('login', () => {
    if (id !== connectionId) return;
    log('Đã hoàn tất bước login giao thức; đang chờ spawn.');
  });

  newBot.on('spawn', () => {
    if (id !== connectionId) return;
    log('Bot đã spawn trong thế giới.');
    setStatus('Đang hoạt động (Online)', true);

    clearStats();
    statsTimer = setInterval(sendStats, 1000);
    runAfterSpawn(id);
  });

  newBot.on('message', message => {
    if (id !== connectionId) return;
    const value = message?.toString?.() || '';
    if (value.trim()) io.emit('chat_msg', value);
  });

  newBot.on('kicked', (reason, loggedIn) => {
    if (id !== connectionId) return;
    const detail = typeof reason === 'string' ? reason : JSON.stringify(reason);
    log(`[KICKED] Máy chủ từ chối/ngắt kết nối. loggedIn=${loggedIn}; reason=${detail}`);
  });

  newBot.on('windowOpen', window => {
    if (id !== connectionId) return;
    currentWindow = window;
    log(`Đã mở GUI: ${getWindowTitle(window)} (${window.slots.length} ô).`);
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
    if (id === connectionId) sendStats();
  });

  newBot.on('end', reason => {
    if (id !== connectionId) return;
    bot = null;
    scheduleReconnect(reason);
  });

  newBot.on('error', err => {
    if (id !== connectionId) return;
    log(`[ERROR] ${err.message}`);
    setStatus('Có lỗi kết nối; xem nhật ký', false);
  });
}

function isAuthorized(socket) {
  if (!DASHBOARD_TOKEN) return true;
  return socket.handshake.auth?.token === DASHBOARD_TOKEN;
}

app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Minecraft Bot Dashboard</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:18px;background:#f3f5f7;color:#222;font:15px Arial,sans-serif}
main{max-width:1050px;margin:auto;background:white;padding:22px;border-radius:12px;box-shadow:0 3px 18px #0001}
h2{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;color:#26733a}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.box{border:1px solid #ddd;border-radius:8px;padding:12px;margin:12px 0}
label{display:block;font-weight:bold;font-size:13px;margin:5px 0}
input{width:100%;padding:11px;border:1px solid #bbb;border-radius:6px;margin:4px 0 8px}
button{border:0;border-radius:6px;padding:11px 15px;color:white;background:#288b45;font-weight:bold;cursor:pointer;margin:3px}
button.red{background:#c43d3d}button.blue{background:#087db5}
.actions{display:flex;flex-wrap:wrap;gap:6px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.stat{background:#f7f8f8;border:1px solid #ddd;padding:10px;border-radius:7px;font-size:13px}
.stat b{display:block;margin-top:6px}
.panel{height:230px;overflow:auto;background:#101820;color:#e7edf1;padding:10px;border-radius:7px;font:12px/1.5 Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
#gui{display:none}.slots{display:grid;grid-template-columns:repeat(9,minmax(0,1fr));gap:4px}
.slot{min-height:42px;background:#777;color:white;border:2px outset #bbb;display:grid;place-items:center;text-align:center;font-size:10px;overflow-wrap:anywhere;cursor:pointer}
.status{font-size:13px;color:#555}
@media(max-width:700px){.grid,.stats{grid-template-columns:1fr 1fr}}
</style>
</head>
<body><main>
<h2><span>🤖 Minecraft Bot Dashboard</span><span id="status" class="status">Đang ngắt kết nối</span></h2>
<div class="box">
  <div class="grid">
    <div><label>Username trong game</label><input id="username" autocomplete="off" placeholder="Nhập username"></div>
    <div><label>Mật khẩu /login (nếu máy chủ yêu cầu)</label><input id="password" type="password" autocomplete="new-password" placeholder="Không lưu trên máy chủ"></div>
  </div>
  <label>Token Dashboard</label><input id="token" type="password" autocomplete="off" placeholder="Chỉ cần nếu đã đặt DASHBOARD_TOKEN">
  <div class="actions"><button id="connect">Kết nối bot</button><button id="disconnect" class="red">Ngắt kết nối</button></div>
  <p class="status">Máy chủ: ${HOST} · Phiên bản: ${VERSION}. Thông tin đăng nhập không được gửi lại khi tải trang.</p>
</div>
<div class="stats">
 <div class="stat">Tọa độ<b id="coords">--</b></div><div class="stat">Máu<b id="health">--</b></div>
 <div class="stat">Độ đói<b id="food">--</b></div><div class="stat">Người chơi gần nhất<b id="nearest">--</b></div>
</div>
<div id="gui" class="box"><b id="guiTitle">Menu trong game</b><div id="slots" class="slots"></div></div>
<div class="grid">
 <div class="box"><b>📜 Nhật ký hệ thống</b><div id="logs" class="panel"></div></div>
 <div class="box"><b>💬 Chat trong game</b><div id="chat" class="panel"></div></div>
</div>
<div class="box"><label>Lệnh / tin nhắn</label><div class="actions"><input id="command" placeholder="Nhập lệnh hoặc chat..." style="flex:1;min-width:180px"><button id="send" class="blue">Gửi</button></div></div>
</main>
<script src="/socket.io/socket.io.js"></script>
<script>
const $=id=>document.getElementById(id);
let socket=null;
function append(id,text){const el=$(id),line=document.createElement('div');line.textContent=text;el.appendChild(line);while(el.children.length>150)el.removeChild(el.firstChild);el.scrollTop=el.scrollHeight;}
function connectSocket(){
  if(socket)socket.disconnect();
  socket=io({auth:{token:$('token').value}});
  socket.on('connect',()=>{});
  socket.on('connect_error',e=>append('logs','Không kết nối Dashboard: '+e.message));
  socket.on('log',m=>append('logs',m));
  socket.on('chat_msg',m=>append('chat',m));
  socket.on('status_update',d=>{$('status').textContent=d.text;$('status').style.color=d.online?'#218838':'#c43d3d';});
  socket.on('stats_update',d=>{$('coords').textContent=d.coords;$('health').textContent=d.health;$('food').textContent=d.food;$('nearest').textContent=d.nearest;});
  socket.on('window_close',()=>{$('gui').style.display='none';});
  socket.on('window_open',d=>{
    $('gui').style.display='block';$('guiTitle').textContent=d.title+' ('+d.slots.length+' ô)';
    $('slots').replaceChildren();
    d.slots.forEach((item,index)=>{
      const cell=document.createElement('button');cell.className='slot';
      cell.textContent=item?(item.displayName+' ×'+item.count):'';
      cell.title=item?item.name:'Ô trống';cell.style.background=item?'#777':'#aaa';
      cell.onclick=()=>socket.emit('click_slot',index);$('slots').appendChild(cell);
    });
  });
}
connectSocket();
$('connect').onclick=()=>{
  const username=$('username').value.trim(),password=$('password').value;
  if(!username){alert('Hãy nhập username.');return;}
  if(!socket||!socket.connected)connectSocket();
  socket.emit('connect_bot',{username,password});
};
$('disconnect').onclick=()=>socket?.emit('disconnect_bot');
function send(){const value=$('command').value.trim();if(value){socket?.emit('send_command',value);$('command').value='';}}
$('send').onclick=send;$('command').addEventListener('keydown',e=>{if(e.key==='Enter')send();});
</script>
</body></html>`);
});

io.use((socket, next) => {
  if (!isAuthorized(socket)) return next(new Error('Token Dashboard không đúng.'));
  next();
});

io.on('connection', socket => {
  socket.emit('status_update', { text: statusText, online: isOnline });
  for (const line of logHistory) socket.emit('log', line);

  socket.on('connect_bot', data => {
    if (!data || typeof data.username !== 'string') return;
    const username = data.username.trim();
    const password = typeof data.password === 'string' ? data.password : '';

    if (!username || username.length > 16 || password.length > 128) {
      socket.emit('log', 'Username hoặc mật khẩu không hợp lệ.');
      return;
    }

    activeUsername = username;
    activePassword = password;
    isRunning = true;
    intentionalEnd = false;
    reconnectDelay = 10000;
    startBot();
  });

  socket.on('disconnect_bot', () => {
    closeBot('Đã ngắt kết nối thủ công');
    log('Người dùng đã ngắt kết nối bot.');
  });

  socket.on('send_command', command => {
    if (typeof command !== 'string' || command.length > 256) return;
    if (!bot || !isRunning || !isOnline) {
      socket.emit('log', 'Bot chưa online.');
      return;
    }

    const cmd = command.trim();
    if (!cmd) return;
    if (cmd.toLowerCase() === '/menu') expectedAction = 'CLICK_24';
    if (cmd.toLowerCase() === '/afk') expectedAction = 'RANDOM_0_9';

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

server.listen(PORT, () => {
  console.log(`Dashboard đang chạy tại cổng ${PORT}`);
  if (!DASHBOARD_TOKEN) {
    console.warn('CẢNH BÁO: Chưa đặt DASHBOARD_TOKEN. Hãy chỉ mở Dashboard trong mạng tin cậy.');
  }
});

function shutdown() {
  log('Đang tắt ứng dụng...');
  closeBot('Ứng dụng đang tắt');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
'''
path = Path("/mnt/data/server.js")
path.write_text(code, encoding="utf-8")
print(f"Đã tạo {path} ({len(code.splitlines())} dòng, {path.stat().st_size} bytes).")
