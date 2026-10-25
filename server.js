const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

// Cấu hình thông tin bot
const BOT_CONFIG = {
  host: 'kingmc.vn',
  username: '_caubemocoi_',
  password: 'phong123@',
  version: '1.20.1'
};

let bot = null;
let antiAfkInterval = null;

// Giao diện Web Dashboard
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Minecraft Bot Dashboard - _caubemocoi_</title>
      <script src="/socket.io/socket.io.js"></script>
      <style>
        * { box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #121212; color: #e0e0e0; margin: 0; padding: 20px; }
        .container { max-width: 1000px; margin: 0 auto; background: #1e1e1e; padding: 20px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
        h2 { margin-top: 0; color: #4caf50; display: flex; align-items: center; justify-content: space-between; }
        
        .status-bar { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 15px; }
        .stat-card { background: #2a2a2a; padding: 12px; border-radius: 6px; border-left: 4px solid #4caf50; font-size: 14px; }
        .stat-card b { color: #4caf50; display: block; margin-top: 4px; font-size: 16px; }

        .dashboard-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
        @media (max-width: 768px) { .dashboard-grid { grid-template-columns: 1fr; } }

        .panel { background: #000; border: 1px solid #333; border-radius: 6px; padding: 10px; height: 300px; overflow-y: auto; font-family: 'Consolas', monospace; font-size: 13px; line-height: 1.4; white-space: pre-wrap; word-break: break-word; }
        .panel-title { font-weight: bold; margin-bottom: 8px; color: #aaa; border-bottom: 1px solid #333; padding-bottom: 4px; }
        
        .log-entry { margin-bottom: 4px; border-bottom: 1px solid #111; padding-bottom: 2px; }
        .chat-entry { color: #64ffda; margin-bottom: 4px; }

        .control-section { margin-top: 15px; background: #2a2a2a; padding: 15px; border-radius: 6px; display: flex; gap: 10px; }
        input[type="text"] { flex: 1; padding: 12px; border-radius: 6px; border: 1px solid #444; background: #1a1a1a; color: #fff; font-size: 15px; outline: none; }
        input[type="text"]:focus { border-color: #4caf50; }
        button { padding: 12px 24px; border: none; border-radius: 6px; background: #4caf50; color: white; cursor: pointer; font-weight: bold; font-size: 15px; transition: background 0.2s; }
        button:hover { background: #45a049; }
        .status-tag { font-size: 13px; background: #2e7d32; padding: 4px 10px; border-radius: 12px; color: #fff; }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>
          <span>🎮 Bot Dashboard: _caubemocoi_</span>
          <span class="status-tag" id="status">Online 24/7</span>
        </h2>
        
        <div class="status-bar">
          <div class="stat-card">Trạng thái<b id="botStatus">Đang kết nối...</b></div>
          <div class="stat-card">Tọa độ (X, Y, Z)<b id="botCoords">Đang cập nhật...</b></div>
          <div class="stat-card">Máu & Đói<b id="botHealth">❤️ -- | 🍖 --</b></div>
          <div class="stat-card">Người chơi gần nhất<b id="nearestPlayer">Không có</b></div>
        </div>

        <div class="dashboard-grid">
          <div>
            <div class="panel-title">📜 Nhật ký hệ thống</div>
            <div id="logs" class="panel"></div>
          </div>
          <div>
            <div class="panel-title">💬 Chat trong game</div>
            <div id="gameChat" class="panel"></div>
          </div>
        </div>

        <div class="control-section">
          <input type="text" id="cmdInput" placeholder="Nhập lệnh (VD: /menu, /afk, /spawn) hoặc chat..." onkeypress="handleKeyPress(event)" />
          <button onclick="sendCommand()">Gửi lệnh</button>
        </div>
      </div>

      <script>
        const socket = io();
        const logsDiv = document.getElementById('logs');
        const chatDiv = document.getElementById('gameChat');

        socket.on('log', (msg) => {
          const item = document.createElement('div');
          item.className = 'log-entry';
          item.textContent = msg;
          logsDiv.appendChild(item);
          logsDiv.scrollTop = logsDiv.scrollHeight;
        });

        socket.on('chat_msg', (msg) => {
          const item = document.createElement('div');
          item.className = 'chat-entry';
          item.textContent = msg;
          chatDiv.appendChild(item);
          chatDiv.scrollTop = chatDiv.scrollHeight;
        });

        socket.on('update_stats', (data) => {
          document.getElementById('botStatus').textContent = data.status;
          document.getElementById('botCoords').textContent = data.coords;
          document.getElementById('botHealth').textContent = '❤️ ' + data.health + ' | 🍖 ' + data.food;
          document.getElementById('nearestPlayer').textContent = data.nearestPlayer;
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
  const formatted = `[${time}] ${msg}`;
  console.log(formatted);
  io.emit('log', formatted);
}

function sendStatsToWeb() {
  if (!bot || !bot.entity) return;
  const pos = bot.entity.position;
  const coords = `X: ${pos.x.toFixed(1)}, Y: ${pos.y.toFixed(1)}, Z: ${pos.z.toFixed(1)}`;
  
  let nearestPlayerName = "Không có";
  const filterPlayer = (p) => p.username !== bot.username;
  const player = bot.players ? Object.values(bot.players).find(p => p.entity && filterPlayer(p)) : null;
  if (player) {
    nearestPlayerName = player.username;
  }

  io.emit('update_stats', {
    status: 'Đang hoạt động (Online)',
    coords: coords,
    health: bot.health || 20,
    food: bot.food || 20,
    nearestPlayer: nearestPlayerName
  });
}

function startBot() {
  logToWeb("🔄 Đang khởi động kết nối tới kingmc.vn với tên _caubemocoi_...");

  bot = mineflayer.createBot({
    host: BOT_CONFIG.host,
    username: BOT_CONFIG.username,
    version: BOT_CONFIG.version
  });

  bot.on('message', (jsonMsg) => {
    const rawText = jsonMsg.toString().trim();
    if (rawText) {
      io.emit('chat_msg', rawText);
    }
  });

  bot.on('spawn', () => {
    logToWeb("✅ Bot đã kết nối vào server thành công!");

    setTimeout(() => {
      bot.chat(`/login ${BOT_CONFIG.password}`);
      logToWeb(`🔐 Đã gửi lệnh /login`);

      setTimeout(() => {
        bot.chat('/menu');
        logToWeb(`📋 Đã gõ lệnh /menu để mở bảng chọn server`);
      }, 3000);
    }, 3000);
  });

  bot.on('windowOpen', async (window) => {
    const title = window.title ? window.title.toString() : 'GUI';
    logToWeb(`📋 Phát hiện mở Menu: "${title}" (Tổng ô: ${window.slots.length})`);

    if (window.slots.length >= 25) {
      setTimeout(() => {
        bot.clickWindow(24, 0, 0);
        logToWeb("👉 Đã click Slot 24 (KingSMP)!");

        setTimeout(() => {
          bot.chat('/afk');
          logToWeb("💬 Đã gửi lệnh /afk");
        }, 4000);
      }, 1500);
    }

    if (window.slots.length >= 7 && window.slots.length < 25) {
      setTimeout(() => {
        bot.clickWindow(6, 0, 0);
        logToWeb("🎯 Đã click Slot 6 trong bảng AFK!");
      }, 1500);
    }
  });

  if (antiAfkInterval) clearInterval(antiAfkInterval);
  antiAfkInterval = setInterval(() => {
    if (bot && bot.entity) {
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 500);
      logToWeb("⚡ Anti-AFK: Đã nhảy!");
    }
    sendStatsToWeb();
  }, 3000);

  bot.on('error', (err) => logToWeb(`❌ Lỗi: ${err.message}`));
  bot.on('end', () => {
    logToWeb("⚠️ Bot bị ngắt kết nối. Đang tự động kết nối lại sau 10 giây...");
    if (antiAfkInterval) clearInterval(antiAfkInterval);
    setTimeout(startBot, 10000);
  });
}

io.on('connection', (socket) => {
  socket.on('send_command', (cmd) => {
    if (bot) {
      bot.chat(cmd);
      logToWeb(`📤 [Web gửi]: ${cmd}`);
    } else {
      socket.emit('log', '⚠️ Bot chưa sẵn sàng!');
    }
  });
});

startBot();

server.listen(PORT, () => {
  console.log(`Server Dashboard đang chạy tại cổng ${PORT}`);
});
