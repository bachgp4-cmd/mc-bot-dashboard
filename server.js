const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

// Cấu hình thông tin bot chính xác với tên _caubemocoi_
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
      <title>Minecraft Bot Dashboard & Live Chat</title>
      <script src="/socket.io/socket.io.js"></script>
      <style>
        * { box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #121212; color: #e0e0e0; margin: 0; padding: 20px; }
        .container { max-width: 900px; margin: 0 auto; background: #1e1e1e; padding: 20px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
        h2 { margin-top: 0; color: #4caf50; display: flex; align-items: center; justify-content: space-between; }
        #logs { background: #000; border: 1px solid #333; height: 420px; overflow-y: auto; padding: 12px; font-family: 'Consolas', 'Courier New', monospace; font-size: 14px; line-height: 1.4; border-radius: 6px; white-space: pre-wrap; word-break: break-word; }
        .log-entry { margin-bottom: 4px; border-bottom: 1px solid #111; padding-bottom: 2px; }
        .chat-box { display: flex; gap: 10px; margin-top: 15px; }
        input[type="text"] { flex: 1; padding: 12px; border-radius: 6px; border: 1px solid #444; background: #2a2a2a; color: #fff; font-size: 15px; outline: none; }
        input[type="text"]:focus { border-color: #4caf50; }
        button { padding: 12px 24px; border: none; border-radius: 6px; background: #4caf50; color: white; cursor: pointer; font-weight: bold; font-size: 15px; transition: background 0.2s; }
        button:hover { background: #45a049; }
        .status-tag { font-size: 14px; background: #2e7d32; padding: 4px 10px; border-radius: 12px; color: #fff; }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>
          <span>🎮 Minecraft Bot - kingmc.vn</span>
          <span class="status-tag" id="status">Online 24/7</span>
        </h2>
        
        <!-- Khung xem Chat / Log game -->
        <div id="logs"></div>

        <!-- Khung gửi lệnh / Chat -->
        <div class="chat-box">
          <input type="text" id="cmdInput" placeholder="Nhập tin nhắn chat hoặc lệnh (VD: /spawn, Hi mọi người)..." onkeypress="handleKeyPress(event)" />
          <button onclick="sendCommand()">Gửi</button>
        </div>
      </div>

      <script>
        const socket = io();
        const logsDiv = document.getElementById('logs');

        function appendLog(msg) {
          const item = document.createElement('div');
          item.className = 'log-entry';
          item.textContent = msg;
          logsDiv.appendChild(item);
          logsDiv.scrollTop = logsDiv.scrollHeight;
        }

        socket.on('log', (msg) => appendLog(msg));
        socket.on('chat_msg', (msg) => appendLog("[GAME CHAT] " + msg));

        function sendCommand() {
          const input = document.getElementById('cmdInput');
          const message = input.value.trim();
          if (message) {
            socket.emit('send_command', message);
            appendLog('📤 [Bạn gửi]: ' + message);
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

// Broadcast log tới tất cả client đang mở Web
function logToWeb(msg) {
  const time = new Date().toLocaleTimeString('vi-VN');
  const formatted = `[${time}] ${msg}`;
  console.log(formatted);
  io.emit('log', formatted);
}

// Khởi tạo bot Mineflayer
function startBot() {
  logToWeb("🔄 Đang khởi động kết nối tới server kingmc.vn với tên _caubemocoi_...");

  bot = mineflayer.createBot({
    host: BOT_CONFIG.host,
    username: BOT_CONFIG.username,
    version: BOT_CONFIG.version
  });

  // 1. Nhận tin nhắn CHAT TRONG GAME
  bot.on('message', (jsonMsg) => {
    const rawText = jsonMsg.toString().trim();
    if (rawText) {
      io.emit('chat_msg', rawText);
    }
  });

  // 2. Xử lý khi Bot Spawn vào Server
  bot.on('spawn', () => {
    logToWeb("✅ Bot đã kết nối vào server!");

    // Tự động gõ /login
    setTimeout(() => {
      bot.chat(`/login ${BOT_CONFIG.password}`);
      logToWeb(`🔐 Đã gửi lệnh /login`);
    }, 4000);
  });

  // 3. Tự động tương tác Menu GUI (Chọn KingSMP và AFK Slot 6)
  bot.on('windowOpen', async (window) => {
    const title = window.title ? window.title.toString() : '';
    logToWeb(`📋 Mở Menu/GUI: "${title}"`);

    // Chọn Slot 24 để vào KingSMP
    if (window.slots.length >= 25 && window.slots[24]) {
      setTimeout(() => {
        bot.clickWindow(24, 0, 0);
        logToWeb("👉 Đã click Slot 24 vào KingSMP!");
        
        // Sau khi sang KingSMP, thực hiện /afk
        setTimeout(() => {
          bot.chat('/afk');
          logToWeb("💬 Đã gửi lệnh /afk");
        }, 5000);
      }, 2000);
    }

    // Nếu mở menu /afk -> Chọn Slot 6
    if (window.slots.length >= 7 && window.slots[6]) {
      setTimeout(() => {
        bot.clickWindow(6, 0, 0);
        logToWeb("🎯 Đã chọn Slot 6 AFK thành công!");
      }, 1500);
    }
  });

  // 4. Vòng lặp Anti-AFK (Nhảy mỗi 40s)
  if (antiAfkInterval) clearInterval(antiAfkInterval);
  antiAfkInterval = setInterval(() => {
    if (bot && bot.entity) {
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 500);
      logToWeb("⚡ Anti-AFK: Nhảy!");
    }
  }, 40000);

  // Xử lý lỗi & Tự kết nối lại (Auto-Reconnect)
  bot.on('error', (err) => logToWeb(`❌ Lỗi Bot: ${err.message}`));
  bot.on('end', () => {
    logToWeb("⚠️ Bot bị ngắt kết nối. Đang tự động kết nối lại sau 10 giây...");
    if (antiAfkInterval) clearInterval(antiAfkInterval);
    setTimeout(startBot, 10000);
  });
}

// Lắng nghe sự kiện từ Web Dashboard để gửi lệnh/chat vào game
io.on('connection', (socket) => {
  socket.on('send_command', (cmd) => {
    if (bot) {
      bot.chat(cmd);
    } else {
      socket.emit('log', '⚠️ Bot chưa sẵn sàng hoặc chưa kết nối!');
    }
  });
});

startBot();

server.listen(PORT, () => {
  console.log(`Server Dashboard đang chạy tại cổng ${PORT}`);
});
