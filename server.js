const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

// Cấu hình cố định
const BOT_CONFIG = {
  host: 'kingmc.vn',
  username: '_caubemocoi_',
  password: 'phong123@',
  version: '1.20.1'
};

let bot = null;
let isRunning = false; // Cờ kiểm soát trạng thái chạy thủ công
let reconnectTimeout = null; // Biến lưu lịch hẹn reconnect
let currentWindow = null;

// Web Dashboard giao diện trực quan
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
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #121212; color: #e0e0e0; margin: 0; padding: 20px; }
        .container { max-width: 1050px; margin: 0 auto; background: #1e1e1e; padding: 20px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
        h2 { margin-top: 0; color: #4caf50; display: flex; align-items: center; justify-content: space-between; }
        
        .action-bar { display: flex; gap: 10px; margin-bottom: 15px; }
        button { padding: 12px 24px; border: none; border-radius: 6px; color: white; cursor: pointer; font-weight: bold; font-size: 15px; transition: background 0.2s; }
        .btn-connect { background: #4caf50; }
        .btn-connect:hover { background: #45a049; }
        .btn-disconnect { background: #f44336; }
        .btn-disconnect:hover { background: #d32f2f; }

        /* Khung hiển thị GUI tương tác */
        #guiContainer { background: #222; border: 2px solid #4caf50; border-radius: 8px; padding: 15px; margin-bottom: 15px; display: none; text-align: center; box-shadow: 0 4px 10px rgba(0,0,0,0.3); }
        #guiTitle { font-weight: bold; color: #ffeb3b; margin-bottom: 10px; font-size: 16px; }
        .gui-grid { display: grid; grid-template-columns: repeat(9, 1fr); gap: 4px; max-width: 520px; margin: 0 auto; background: #111; padding: 8px; border-radius: 6px; }
        .gui-slot { background: #333; border: 1px solid #555; height: 42px; display: flex; align-items: center; justify-content: center; font-size: 10px; cursor: pointer; border-radius: 4px; color: #fff; transition: background 0.15s, border-color 0.15s; position: relative; overflow: hidden; }
        .gui-slot:hover { background: #4caf50; border-color: #81c784; }
        .slot-name { text-align: center; padding: 0 2px; word-break: break-all; line-height: 1.2; }
        .slot-count { position: absolute; bottom: 2px; right: 4px; font-size: 10px; color: #ffeb3b; font-weight: bold; background: rgba(0,0,0,0.6); padding: 0 2px; border-radius: 2px; }

        /* Panel Chat & Logs */
        .dashboard-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
        @media (max-width: 768px) { .dashboard-grid { grid-template-columns: 1fr; } }

        .panel { background: #000; border: 1px solid #333; border-radius: 6px; padding: 10px; height: 320px; overflow-y: auto; font-family: 'Consolas', monospace; font-size: 13px; line-height: 1.4; white-space: pre-wrap; word-break: break-word; }
        .panel-title { font-weight: bold; margin-bottom: 8px; color: #aaa; border-bottom: 1px solid #333; padding-bottom: 4px; }
        
        .log-entry { margin-bottom: 4px; border-bottom: 1px solid #111; padding-bottom: 2px; }
        .chat-entry { color: #64ffda; margin-bottom: 4px; border-bottom: 1px solid #111; padding-bottom: 2px; }

        .control-section { margin-top: 15px; background: #2a2a2a; padding: 15px; border-radius: 6px; display: flex; gap: 10px; }
        input[type="text"] { flex: 1; padding: 12px; border-radius: 6px; border: 1px solid #444; background: #1a1a1a; color: #fff; font-size: 15px; outline: none; }
        .btn-send { background: #2196f3; }
        .btn-send:hover { background: #1976d2; }
        .status-tag { font-size: 13px; background: #d32f2f; padding: 4px 10px; border-radius: 12px; color: #fff; }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>
          <span>🤖 Minecraft Bot: _caubemocoi_ (@ kingmc.vn)</span>
          <span class="status-tag" id="statusTag">Đang ngắt kết nối</span>
        </h2>
        
        <div class="action-bar">
          <button class="btn-connect" onclick="connectBot()">🟢 Kết Nối Bot</button>
          <button class="btn-disconnect" onclick="disconnectBot()">🔴 Ngắt Kết Nối Bot</button>
        </div>

        <div id="guiContainer">
          <div id="guiTitle">📋 Menu trong game</div>
          <div id="guiGrid" class="gui-grid"></div>
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

        function connectBot() {
          socket.emit('connect_bot');
        }

        function disconnectBot() {
          socket.emit('disconnect_bot');
        }

        socket.on('status_update', (data) => {
          const tag = document.getElementById('statusTag');
          tag.textContent = data.text;
          tag.style.background = data.online ? '#2e7d32' : '#d32f2f';
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

        socket.on('window_open', (data) => {
          const container = document.getElementById('guiContainer');
          const titleElem = document.getElementById('guiTitle');
          const gridElem = document.getElementById('guiGrid');
          
          container.style.display = 'block';
          titleElem.textContent = '📋 ' + data.title + ' (' + data.slots.length + ' ô)';
          gridElem.innerHTML = '';

          data.slots.forEach((item, index) => {
            const slot = document.createElement('div');
            slot.className = 'gui-slot';
            
            if (item) {
              let shortName = item.name.replace('minecraft:', '');
              slot.innerHTML = '<span class="slot-name">' + shortName + '</span>';
              if (item.count > 1) {
                const countBadge = document.createElement('span');
                countBadge.className = 'slot-count';
                countBadge.textContent = item.count;
                slot.appendChild(countBadge);
              }
              slot.title = item.displayName || item.name;
            } else {
              slot.style.opacity = '0.2';
            }

            slot.onclick = () => {
              socket.emit('click_slot', index);
            };

            gridElem.appendChild(slot);
          });
        });

        socket.on('window_close', () => {
          document.getElementById('guiContainer').style.display = 'none';
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

function startBot() {
  if (!isRunning) return;

  // Dọn dẹp bot cũ nếu còn tồn tại trước khi tạo mới
  if (bot) {
    try { bot.quit(); } catch(e) {}
    bot = null;
  }

  logToWeb("🔄 Đang kết nối tới " + BOT_CONFIG.host + "...");
  updateStatus('Đang kết nối...', false);

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

  // Quy trình tự động
  bot.on('spawn', () => {
    logToWeb("✅ Bot đã vào server thành công!");
    updateStatus('Đang hoạt động (Online)', true);

    // 1. Đợi 5s gửi mật khẩu đăng nhập
    setTimeout(() => {
      if (!isRunning || !bot) return;
      bot.chat('/login ' + BOT_CONFIG.password);
      logToWeb("🔐 Đã gửi lệnh đăng nhập (/login)");

      // 2. Đợi tiếp 5s gửi lệnh /menu
      setTimeout(() => {
        if (!isRunning || !bot) return;
        bot.chat('/menu');
        logToWeb("📋 Đã gửi lệnh /menu");
      }, 5000);
    }, 5000);
  });

  // Bắt sự kiện mở GUI / Menu
  bot.on('windowOpen', (window) => {
    currentWindow = window;
    let windowTitle = "Menu";
    try {
      windowTitle = window.title ? JSON.parse(window.title).text || window.title.toString() : "Menu";
    } catch (e) {
      windowTitle = window.title ? window.title.toString() : "Menu";
    }

    logToWeb("📋 Đã mở GUI: " + windowTitle + " (" + window.slots.length + " ô)");

    const slotsData = window.slots.map(item => item ? { name: item.name, count: item.count, displayName: item.displayName } : null);
    io.emit('window_open', {
      title: windowTitle,
      slots: slotsData
    });

    // 3. Đợi 3s chọn slot thứ 24 tính từ 0
    if (window.slots.length >= 25) {
      setTimeout(() => {
        if (!isRunning || !bot || currentWindow !== window) return;
        try {
          bot.clickWindow(24, 0, 0);
          logToWeb("👉 Đã tự động click slot thứ 24");

          // 4. Sau đó đợi 4s gửi lệnh /afk
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

    // 5. Nếu mở menu con AFK, chọn slot thứ 8 tính từ 0
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
    io.emit('window_close');
    logToWeb("❌ Đã đóng GUI.");
  });

  // Xử lý khi bị văng, kick hoặc ngắt kết nối
  bot.on('end', (reason) => {
    logToWeb("⚠️ Bot bị ngắt kết nối do: " + reason);
    io.emit('window_close');
    currentWindow = null;
    updateStatus('Mất kết nối, chờ reconnect...', false);

    // Chỉ tự động reconnect nếu người dùng KHÔNG bấm ngắt kết nối thủ công
    if (isRunning) {
      logToWeb("⏳ Sẽ tự động kết nối lại (reconnect) sau đúng 10 giây...");
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

// Lắng nghe sự kiện từ Web Socket
io.on('connection', (socket) => {
  socket.on('connect_bot', () => {
    if (!isRunning) {
      isRunning = true;
      startBot();
    }
  });

  socket.on('disconnect_bot', () => {
    isRunning = false; // Đặt cờ false để chặn tuyệt đối việc tự động reconnect
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (bot) {
      try {
        bot.quit();
      } catch (e) {}
      bot = null;
    }
    io.emit('window_close');
    updateStatus('Đã ngắt kết nối thủ công', false);
    logToWeb("🛑 Bạn đã ngắt kết nối bot thủ công. Bot sẽ không tự động kết nối lại.");
  });

  socket.on('send_command', (cmd) => {
    if (bot && isRunning) {
      bot.chat(cmd);
      logToWeb("📤 [Web gửi]: " + cmd);
    } else {
      socket.emit('log', "⚠️ Bot chưa kết nối!");
    }
  });

  socket.on('click_slot', (slotIndex) => {
    if (bot && currentWindow && isRunning) {
      try {
        bot.clickWindow(slotIndex, 0, 0, (err) => {
          if (err) {
            logToWeb("⚠️ Lỗi khi click ô " + slotIndex + ": " + err.message);
          } else {
            logToWeb("👉 Đã click tương tác vào ô số " + slotIndex);
          }
        });
      } catch (e) {
        logToWeb("⚠️ Không thể click: " + e.message);
      }
    } else {
      logToWeb("⚠️ Không có GUI nào đang mở hoặc bot chưa chạy!");
    }
  });
});

server.listen(PORT, () => {
  console.log("Server Dashboard đang chạy hoàn hảo tại cổng " + PORT);
});
