const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

let lastSavedConfig = {
  host: 'kingmc.vn',
  username: '_caubemocoi_',
  password: 'phong123@',
  version: '1.20.1'
};

let bot = null;
let isRunning = false;
let reconnectTimeout = null;
let statsInterval = null;
let currentWindow = null;
let hasLoggedIn = false; // Cờ đánh dấu đã login và chạy chuỗi menu (tránh lặp)

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Bot AFK Dashboard - _caubemocoi_</title>
      <script src="/socket.io/socket.io.js"></script>
      <style>
        * { box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f5f5f5; color: #333; margin: 0; padding: 20px; }
        .container { max-width: 1050px; margin: 0 auto; background: #ffffff; padding: 25px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); border: 1px solid #ddd; }
        h2 { margin-top: 0; color: #2e7d32; display: flex; align-items: center; justify-content: space-between; }
        
        .config-box { background: #fafafa; border: 1px solid #ccc; padding: 15px; border-radius: 8px; margin-bottom: 15px; }
        .config-row { display: flex; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
        .config-group { flex: 1; min-width: 200px; }
        .config-group label { display: block; margin-bottom: 5px; font-weight: bold; font-size: 13px; color: #555; }
        .config-group input { width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #ccc; background: #fff; color: #333; font-size: 14px; outline: none; }

        .action-bar { display: flex; gap: 10px; margin-bottom: 15px; }
        button { padding: 12px 20px; border: none; border-radius: 6px; color: white; cursor: pointer; font-weight: bold; font-size: 14px; transition: background 0.2s; }
        .btn-connect { background: #4caf50; }
        .btn-connect:hover { background: #45a049; }
        .btn-disconnect { background: #d32f2f; }
        .btn-disconnect:hover { background: #c62828; }

        .stats-bar { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 15px; }
        .stat-card { background: #f9f9f9; padding: 12px; border-radius: 6px; border-left: 4px solid #2e7d32; font-size: 13px; border: 1px solid #e0e0e0; }
        .stat-card b { color: #2e7d32; display: block; margin-top: 4px; font-size: 15px; font-family: monospace; }
        @media (max-width: 768px) { .stats-bar { grid-template-columns: 1fr 1fr; } }

        .dashboard-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
        @media (max-width: 768px) { .dashboard-grid { grid-template-columns: 1fr; } }

        .panel { background: #fafafa; border: 1px solid #ccc; border-radius: 6px; padding: 10px; height: 320px; overflow-y: auto; font-family: 'Consolas', monospace; font-size: 13px; line-height: 1.4; white-space: pre-wrap; word-break: break-word; color: #333; }
        .panel-title { font-weight: bold; margin-bottom: 8px; color: #555; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
        
        .log-entry { margin-bottom: 4px; border-bottom: 1px solid #eee; padding-bottom: 2px; color: #444; }
        .chat-entry { color: #00796b; margin-bottom: 4px; border-bottom: 1px solid #eee; padding-bottom: 2px; font-weight: 500; }

        .control-section { margin-top: 15px; background: #fafafa; padding: 15px; border-radius: 6px; display: flex; gap: 10px; border: 1px solid #ccc; }
        input[type="text"], input[type="password"] { flex: 1; padding: 12px; border-radius: 6px; border: 1px solid #ccc; background: #fff; color: #333; font-size: 14px; outline: none; }
        .btn-send { background: #0288d1; }
        .btn-send:hover { background: #0277bd; }
        .status-tag { font-size: 13px; background: #d32f2f; padding: 4px 10px; border-radius: 12px; color: #fff; }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>
          <span>🤖 Minecraft Bot Dashboard</span>
          <span class="status-tag" id="statusTag">Đang ngắt kết nối</span>
        </h2>
        
        <div class="config-box">
          <div class="config-row">
            <div class="config-group">
              <label>Tên Ingame (Username):</label>
              <input type="text" id="inputUsername" placeholder="_caubemocoi_" />
            </div>
            <div class="config-group">
              <label>Mật khẩu Trong Game (/login):</label>
              <input type="password" id="inputPassword" placeholder="phong123@" />
            </div>
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 5px;">
            <label style="font-size: 13px; cursor: pointer; color: #333;">
              <input type="checkbox" id="saveCredCheckbox" checked /> Lưu thông tin đăng nhập cho các lần tiếp theo
            </label>
          </div>
        </div>

        <div class="action-bar">
          <button class="btn-connect" onclick="connectBot()">🟢 Kết Nối Bot</button>
          <button class="btn-disconnect" onclick="disconnectBot()">🔴 Ngắt Kết Nối Bot</button>
        </div>

        <div class="stats-bar">
          <div class="stat-card">Tọa độ (X, Y, Z)<b id="statCoords">X: --, Y: --, Z: --</b></div>
          <div class="stat-card">Máu (HP)<b id="statHealth">❤️ -- / 20</b></div>
          <div class="stat-card">Độ đói / No<b id="statFood">🍖 -- / 20</b></div>
          <div class="stat-card">Player gần nhất<b id="statNearest">Không có</b></div>
        </div>

        <div class="dashboard-grid">
          <div>
            <div class="panel-title">📜 Nhật ký hệ thống (Logs)</div>
            <div id="logs" class="panel"></div>
          </div>
          <div>
            <div class="panel-title">💬 Chat trong game</div>
            <div id="gameChat" class="panel"></div>
          </div>
        </div>

        <div class="control-section">
          <input type="text" id="cmdInput" placeholder="Nhập lệnh hoặc chat vào game..." onkeypress="handleKeyPress(event)" />
          <button class="btn-send" onclick="sendCommand()">Gửi lệnh</button>
        </div>
      </div>

      <script>
        const socket = io();

        window.addEventListener('DOMContentLoaded', () => {
          socket.emit('get_config');
        });

        socket.on('load_config', (config) => {
          if (config.username) document.getElementById('inputUsername').value = config.username;
          if (config.password) document.getElementById('inputPassword').value = config.password;
        });

        function connectBot() {
          const username = document.getElementById('inputUsername').value.trim();
          const password = document.getElementById('inputPassword').value.trim();
          const saveCred = document.getElementById('saveCredCheckbox').checked;

          if (!username || !password) {
            alert('Vui lòng nhập đầy đủ Username và Mật khẩu trong game!');
            return;
          }

          socket.emit('connect_bot', { username, password, saveCred });
        }

        function disconnectBot() {
          socket.emit('disconnect_bot');
        }

        socket.on('status_update', (data) => {
          const tag = document.getElementById('statusTag');
          tag.textContent = data.text;
          tag.style.background = data.online ? '#2e7d32' : '#d32f2f';
        });

        socket.on('stats_update', (data) => {
          document.getElementById('statCoords').textContent = data.coords;
          document.getElementById('statHealth').textContent = '❤️ ' + data.health + ' / 20';
          document.getElementById('statFood').textContent = '🍖 ' + data.food + ' / 20';
          document.getElementById('statNearest').textContent = data.nearest;
        });

        socket.on('log', (msg) => {
          const logsDiv = document.getElementById('logs');
          logsDiv.innerHTML += '<div class="log-entry">' + msg + '</div>';
          logsDiv.scrollTop = logsDiv.scrollHeight;
        });

        socket.on('chat_msg', (msg) => {
          const chatDiv = document.getElementById('gameChat');
          chatDiv.innerHTML += '<div class="chat-entry">' + msg + '</div>';
          chatDiv.scrollTop = chatDiv.scrollHeight;
        });

        function sendCommand() {
          const input = document.getElementById('cmdInput');
          const message = input.value.trim();
          if (message) {
            socket.emit('send_command', message);
            input.value = '';
          }
        }

        function handleKeyPress(e) {
          if (e.key === 'Enter') sendCommand();
        }
      </script>
    </body>
    </html>
  `);
});

function logToWeb(msg) {
  const time = new Date().toLocaleTimeString('vi-VN');
  const formatted = '[' + time + '] ' + msg;
  console.log(formatted);
  io.emit('log', formatted);
}

function updateStatus(text, online) {
  io.emit('status_update', { text, online });
}

function sendStatsToWeb() {
  if (!bot || !bot.entity) return;

  const pos = bot.entity.position;
  const coords = `X: ${pos.x.toFixed(1)}, Y: ${pos.y.toFixed(1)}, Z: ${pos.z.toFixed(1)}`;
  const health = bot.health !== undefined ? bot.health : 20;
  const food = bot.food !== undefined ? bot.food : 20;

  let nearestPlayer = "Không có";
  if (bot.players) {
    const players = Object.values(bot.players).filter(p => p.username !== bot.username && p.entity);
    if (players.length > 0) {
      let closest = players.reduce((prev, curr) => {
        const distPrev = prev.entity.position.distanceTo(bot.entity.position);
        const distCurr = curr.entity.position.distanceTo(bot.entity.position);
        return distCurr < distPrev ? curr : prev;
      });
      nearestPlayer = closest.username;
    }
  }

  io.emit('stats_update', { coords, health, food, nearest: nearestPlayer });
}

function startBot() {
  if (!isRunning) return;

  if (bot) {
    try { bot.quit(); } catch(e) {}
    bot = null;
  }
  if (statsInterval) clearInterval(statsInterval);
  hasLoggedIn = false; // Reset cờ mỗi khi tạo kết nối mới

  logToWeb("🔄 Đang kết nối tới " + lastSavedConfig.host + " với tên " + lastSavedConfig.username + "...");
  updateStatus('Đang kết nối...', false);

  bot = mineflayer.createBot({
    host: lastSavedConfig.host,
    username: lastSavedConfig.username,
    version: '1.20.1'
  });

  bot.on('message', (jsonMsg) => {
    const rawText = jsonMsg.toString().trim();
    if (rawText) {
      io.emit('chat_msg', rawText);
    }
  });

  bot.on('spawn', () => {
    logToWeb("✅ Bot đã vào server thành công!");
    updateStatus('Đang hoạt động (Online)', true);

    statsInterval = setInterval(sendStatsToWeb, 1000);

    // CHỈ THỰC HIỆN CHUỖI GỬI LỆNH 1 LẦN DUY NHẤT SAU KHI VÀO GAME
    if (!hasLoggedIn) {
      hasLoggedIn = true;

      setTimeout(() => {
        if (!isRunning || !bot) return;
        bot.chat('/login ' + lastSavedConfig.password);
        logToWeb("🔐 Đã gửi lệnh đăng nhập (/login)");

        setTimeout(() => {
          if (!isRunning || !bot) return;
          bot.chat('/menu');
          logToWeb("📋 Đã gửi lệnh /menu");
        }, 5000);
      }, 5000);
    }
  });

  bot.on('windowOpen', (window) => {
    currentWindow = window;
    let windowTitle = "Menu";
    try {
      windowTitle = window.title ? JSON.parse(window.title).text || window.title.toString() : "Menu";
    } catch (e) {
      windowTitle = window.title ? window.title.toString() : "Menu";
    }

    logToWeb("📋 Đã nhận diện Menu ngầm: " + windowTitle + " (" + window.slots.length + " ô)");

    // Menu chính: Chọn slot 24 sau 3s
    if (window.slots.length >= 25) {
      setTimeout(() => {
        if (!isRunning || !bot || currentWindow !== window) return;
        try {
          bot.clickWindow(24, 0, 0);
          logToWeb("👉 Đã tự động click slot thứ 24 (chọn chế độ server)");

          setTimeout(() => {
            if (!isRunning || !bot) return;
            bot.chat('/afk');
            logToWeb("💬 Đã gửi lệnh /afk");
          }, 4000);
        } catch (err) {
          logToWeb("⚠️ Lỗi click slot 24: " + err.message);
        }
      }, 3000);
    }

    // Sub-menu AFK: Chọn slot 8 sau 1.5s
    if (window.slots.length === 63 || window.slots.length === 54) {
      setTimeout(() => {
        if (!isRunning || !bot || currentWindow !== window) return;
        try {
          bot.clickWindow(8, 0, 0);
          logToWeb("🎯 Đã tự động chọn slot thứ 8 trong menu AFK");
        } catch (err) {
          logToWeb("⚠️ Lỗi click slot 8: " + err.message);
        }
      }, 1500);
    }
  });

  bot.on('windowClose', () => {
    currentWindow = null;
  });

  bot.on('end', (reason) => {
    logToWeb("⚠️ Bot bị ngắt kết nối do: " + reason);
    if (statsInterval) clearInterval(statsInterval);
    updateStatus('Mất kết nối, chờ reconnect...', false);

    if (isRunning) {
      logToWeb("⏳ Tự động kết nối lại (reconnect) sau đúng 10 giây...");
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      reconnectTimeout = setTimeout(() => {
        if (isRunning) {
          startBot();
        }
      }, 10000);
    }
  });

  bot.on('error', (err) => {
    logToWeb("❌ Lỗi Bot: " + err.message);
  });
}

setTimeout(() => {
  if (isRunning) {
    startBot();
  }
}, 1000);

io.on('connection', (socket) => {
  socket.on('get_config', () => {
    socket.emit('load_config', {
      username: lastSavedConfig.username,
      password: lastSavedConfig.password
    });
  });

  socket.on('connect_bot', (data) => {
    if (data.saveCred) {
      lastSavedConfig.username = data.username;
      lastSavedConfig.password = data.password;
    }
    lastSavedConfig.username = data.username;
    lastSavedConfig.password = data.password;

    isRunning = true;
    startBot();
  });

  socket.on('disconnect_bot', () => {
    isRunning = false;
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (statsInterval) clearInterval(statsInterval);
    if (bot) {
      try { bot.quit(); } catch (e) {}
      bot = null;
    }
    updateStatus('Đã ngắt kết nối thủ công', false);
    logToWeb("🛑 Bạn đã ngắt kết nối bot thủ công.");
  });

  socket.on('send_command', (cmd) => {
    if (bot && isRunning) {
      bot.chat(cmd);
      logToWeb("📤 [Web gửi]: " + cmd);
    } else {
      socket.emit('log', "⚠️ Bot chưa kết nối!");
    }
  });
});

server.listen(PORT, () => {
  console.log("Server Dashboard đang chạy hoàn hảo tại cổng " + PORT);
});
