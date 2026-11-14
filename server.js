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
let hasLoggedIn = false;
let currentStatusText = 'Đang ngắt kết nối';
let isOnline = false;

// Cờ kiểm soát hành động click menu tiếp theo
let expectedAction = null; // 'CLICK_24' (sau /menu) hoặc 'RANDOM_0_9' (sau /afk)

let activeSequenceTimeouts = [];

function clearAllSequenceTimeouts() {
  activeSequenceTimeouts.forEach(t => clearTimeout(t));
  activeSequenceTimeouts = [];
}

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

        /* Khung hiển thị GUI tương tác chuẩn tỷ lệ trong game */
        #guiContainer { background: #fafafa; border: 2px solid #2e7d32; border-radius: 8px; padding: 15px; margin-bottom: 15px; display: none; text-align: center; box-shadow: 0 4px 10px rgba(0,0,0,0.05); }
        #guiTitle { font-weight: bold; color: #333; margin-bottom: 10px; font-size: 15px; }
        .gui-grid { display: grid; grid-template-columns: repeat(9, 1fr); gap: 4px; max-width: 520px; margin: 0 auto; background: #c6c6c6; padding: 8px; border-radius: 6px; border: 2px solid #8b8b8b; }
        .gui-slot { background: #8b8b8b; border: 2px solid; border-color: #373737 #fff #fff #373737; height: 42px; display: flex; align-items: center; justify-content: center; font-size: 10px; cursor: pointer; border-radius: 2px; color: #fff; transition: background 0.15s; position: relative; overflow: hidden; }
        .gui-slot:hover { background: #8b8b8b88; border-color: #ffeb3b; }
        .slot-name { text-align: center; padding: 0 2px; word-break: break-all; line-height: 1.2; font-weight: bold; }
        .slot-count { position: absolute; bottom: 2px; right: 4px; font-size: 10px; color: #ffeb3b; font-weight: bold; background: rgba(0,0,0,0.6); padding: 0 2px; border-radius: 2px; }

        .dashboard-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
        @media (max-width: 768px) { .dashboard-grid { grid-template-columns: 1fr; } }

        .panel { background: #fafafa; border: 1px solid #ccc; border-radius: 6px; padding: 10px; height: 260px; overflow-y: auto; font-family: 'Consolas', monospace; font-size: 13px; line-height: 1.4; white-space: pre-wrap; word-break: break-word; color: #333; }
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

        <!-- Khung hiển thị GUI chuẩn trong game -->
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

        window.addEventListener('DOMContentLoaded', () => {
          socket.emit('get_config');
          socket.emit('request_current_status');
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
              slot.style.opacity = '0.3';
            }

            // Cho phép click trực tiếp trên web vào slot
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
  currentStatusText = text;
  isOnline = online;
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

  clearAllSequenceTimeouts();
  if (bot) {
    try { bot.quit(); } catch(e) {}
    bot = null;
  }
  if (statsInterval) clearInterval(statsInterval);
  hasLoggedIn = false;
  expectedAction = null;
  io.emit('window_close');

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
    logToWeb("✅ Bot đã kết nối vào game thành công!");
    updateStatus('Đang hoạt động (Online)', true);

    if (statsInterval) clearInterval(statsInterval);
    statsInterval = setInterval(sendStatsToWeb, 1000);

    if (!hasLoggedIn) {
      hasLoggedIn = true;

      // Gửi /login 2 lần
      const t1 = setTimeout(() => {
        if (!isRunning || !bot || !isOnline) return;
        bot.chat('/login ' + lastSavedConfig.password);
        logToWeb("🔐 Đã gửi lệnh đăng nhập (/login) lần 1");

        const t2 = setTimeout(() => {
          if (!isRunning || !bot || !isOnline) return;
          bot.chat('/login ' + lastSavedConfig.password);
          logToWeb("🔐 Đã gửi lệnh đăng nhập (/login) lần 2");

          // Gửi /menu và đặt cờ mong đợi click slot 24
          const t3 = setTimeout(() => {
            if (!isRunning || !bot || !isOnline) return;
            expectedAction = 'CLICK_24';
            bot.chat('/menu');
            logToWeb("📋 Đã gửi lệnh /menu");
          }, 4000);

          activeSequenceTimeouts.push(t3);
        }, 3000);

        activeSequenceTimeouts.push(t2);
      }, 5000);

      activeSequenceTimeouts.push(t1);
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

    logToWeb("📋 Đã mở GUI: " + windowTitle + " (" + window.slots.length + " ô)");

    // Gửi dữ liệu GUI lên Web để hiển thị trực quan
    const slotsData = window.slots.map(item => item ? { name: item.name, count: item.count, displayName: item.displayName } : null);
    io.emit('window_open', {
      title: windowTitle,
      slots: slotsData
    });

    // Xử lý tự động theo yêu cầu
    if (expectedAction === 'CLICK_24') {
      expectedAction = null; // Reset cờ
      const t4 = setTimeout(() => {
        if (!isRunning || !bot || !isOnline || currentWindow !== window) return;
        try {
          bot.clickWindow(24, 0, 0);
          logToWeb("👉 Đã tự động chọn slot 24 sau lệnh /menu");

          // Sau khi chọn slot 24, đợi 4s rồi gửi lệnh /afk và đặt cờ chọn ngẫu nhiên 0-9
          const t5 = setTimeout(() => {
            if (!isRunning || !bot || !isOnline) return;
            expectedAction = 'RANDOM_0_9';
            bot.chat('/afk');
            logToWeb("💬 Đã gửi lệnh /afk");
          }, 4000);

          activeSequenceTimeouts.push(t5);
        } catch (err) {
          logToWeb("⚠️ Lỗi click slot 24: " + err.message);
        }
      }, 3000);

      activeSequenceTimeouts.push(t4);
    } else if (expectedAction === 'RANDOM_0_9') {
      expectedAction = null; // Reset cờ
      const t6 = setTimeout(() => {
        if (!isRunning || !bot || !isOnline || currentWindow !== window) return;
        try {
          const randomSlot = Math.floor(Math.random() * 10); // Ngẫu nhiên 0 đến 9
          bot.clickWindow(randomSlot, 0, 0);
          logToWeb("🎲 Đã chọn ngẫu nhiên slot thứ " + randomSlot + " sau lệnh /afk");
        } catch (err) {
          logToWeb("⚠️ Lỗi click slot ngẫu nhiên: " + err.message);
        }
      }, 1500);

      activeSequenceTimeouts.push(t6);
    }
  });

  bot.on('windowClose', () => {
    currentWindow = null;
    io.emit('window_close');
  });

  bot.on('end', (reason) => {
    logToWeb("⚠️ Bot bị ngắt kết nối do: " + reason);

    clearAllSequenceTimeouts();
    if (statsInterval) clearInterval(statsInterval);
    hasLoggedIn = false;
    expectedAction = null;
    io.emit('window_close');
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
    clearAllSequenceTimeouts();
    updateStatus('Lỗi kết nối', false);
  });
}

io.on('connection', (socket) => {
  socket.on('get_config', () => {
    socket.emit('load_config', {
      username: lastSavedConfig.username,
      password: lastSavedConfig.password
    });
  });

  socket.on('request_current_status', () => {
    socket.emit('status_update', { text: currentStatusText, online: isOnline });
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
    clearAllSequenceTimeouts();
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (statsInterval) clearInterval(statsInterval);
    if (bot) {
      try { bot.quit(); } catch (e) {}
      bot = null;
    }
    io.emit('window_close');
    updateStatus('Đã ngắt kết nối thủ công', false);
    logToWeb("🛑 Bạn đã ngắt kết nối bot thủ công.");
  });

  socket.on('send_command', (cmd) => {
    if (bot && isRunning && isOnline) {
      const cleanCmd = cmd.trim().toLowerCase();
      if (cleanCmd === '/menu') {
        expectedAction = 'CLICK_24';
      } else if (cleanCmd === '/afk') {
        expectedAction = 'RANDOM_0_9';
      }
      bot.chat(cmd);
      logToWeb("📤 [Web gửi]: " + cmd);
    } else {
      socket.emit('log', "⚠️ Bot chưa kết nối!");
    }
  });

  socket.on('click_slot', (slotIndex) => {
    if (bot && currentWindow && isRunning && isOnline) {
      try {
        bot.clickWindow(slotIndex, 0, 0, (err) => {
          if (err) {
            logToWeb("⚠️ Lỗi click slot " + slotIndex + ": " + err.message);
          } else {
            logToWeb("👉 Bạn đã click thủ công vào slot số " + slotIndex);
          }
        });
      } catch (e) {
        logToWeb("⚠️ Không thể click slot: " + e.message);
      }
    } else {
      logToWeb("⚠️ Không có GUI nào đang mở hoặc bot chưa kết nối!");
    }
  });
});

server.listen(PORT, () => {
  console.log("Server Dashboard đang chạy hoàn hảo tại cổng " + PORT);
});
