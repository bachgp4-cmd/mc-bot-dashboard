const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;
const MAX_BOTS = 5;

// Lưu trữ cấu hình 5 bot (Mặc định khởi tạo 1 bot đầu tiên)
let botsConfig = [
  { id: 1, username: '_caubemocoi_', password: 'phong123@' }
];

// Đối tượng quản lý các instance bot và trạng thái riêng biệt
const activeBots = {};

function clearBotTimeouts(botId) {
  if (activeBots[botId] && activeBots[botId].timeouts) {
    activeBots[botId].timeouts.forEach(t => clearTimeout(t));
    activeBots[botId].timeouts = [];
  }
}

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Multi-Bot AFK Dashboard (Max 5 Bots)</title>
      <script src="/socket.io/socket.io.js"></script>
      <style>
        * { box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f5f5f5; color: #333; margin: 0; padding: 20px; }
        .container { max-width: 1100px; margin: 0 auto; background: #ffffff; padding: 25px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); border: 1px solid #ddd; }
        h2 { margin-top: 0; color: #2e7d32; display: flex; align-items: center; justify-content: space-between; }
        
        /* Form thêm/quản lý danh sách 5 Bot */
        .config-box { background: #fafafa; border: 1px solid #ccc; padding: 15px; border-radius: 8px; margin-bottom: 15px; }
        .bot-config-row { display: flex; gap: 10px; margin-bottom: 10px; align-items: center; }
        .bot-config-row input { flex: 1; padding: 8px 12px; border-radius: 4px; border: 1px solid #ccc; outline: none; }
        .btn-remove-config { background: #d32f2f; color: #fff; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; }

        .action-bar { display: flex; gap: 10px; margin-bottom: 15px; flex-wrap: wrap; }
        button { padding: 10px 18px; border: none; border-radius: 6px; color: white; cursor: pointer; font-weight: bold; font-size: 14px; transition: background 0.2s; }
        .btn-connect-all { background: #2e7d32; }
        .btn-disconnect-all { background: #c62828; }
        .btn-add-bot { background: #0288d1; }

        /* Navigation Tabs cho từng Bot */
        .bot-tabs { display: flex; gap: 5px; border-bottom: 2px solid #ddd; margin-bottom: 15px; overflow-x: auto; }
        .tab-btn { background: #e0e0e0; color: #333; padding: 10px 16px; border-radius: 6px 6px 0 0; cursor: pointer; border: none; font-weight: bold; }
        .tab-btn.active { background: #2e7d32; color: #fff; }

        /* Bảng thông số: Tọa độ, HP, Độ đói, Player gần nhất */
        .stats-bar { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 15px; }
        .stat-card { background: #f9f9f9; padding: 12px; border-radius: 6px; border-left: 4px solid #2e7d32; font-size: 13px; border: 1px solid #e0e0e0; }
        .stat-card b { color: #2e7d32; display: block; margin-top: 4px; font-size: 15px; font-family: monospace; }
        @media (max-width: 768px) { .stats-bar { grid-template-columns: 1fr 1fr; } }

        /* Panel Chat & Logs */
        .dashboard-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
        @media (max-width: 768px) { .dashboard-grid { grid-template-columns: 1fr; } }

        .panel { background: #fafafa; border: 1px solid #ccc; border-radius: 6px; padding: 10px; height: 300px; overflow-y: auto; font-family: 'Consolas', monospace; font-size: 13px; line-height: 1.4; white-space: pre-wrap; word-break: break-word; color: #333; }
        .panel-title { font-weight: bold; margin-bottom: 8px; color: #555; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
        
        .log-entry { margin-bottom: 4px; border-bottom: 1px solid #eee; padding-bottom: 2px; color: #444; }
        .chat-entry { color: #00796b; margin-bottom: 4px; border-bottom: 1px solid #eee; padding-bottom: 2px; font-weight: 500; }

        .control-section { margin-top: 15px; background: #fafafa; padding: 15px; border-radius: 6px; display: flex; gap: 10px; border: 1px solid #ccc; }
        input[type="text"] { flex: 1; padding: 10px; border-radius: 6px; border: 1px solid #ccc; background: #fff; color: #333; font-size: 14px; outline: none; }
        .btn-send { background: #0288d1; }
        .status-tag { font-size: 13px; background: #757575; padding: 4px 10px; border-radius: 12px; color: #fff; }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>
          <span>🤖 Quản Lý Minecraft Bot (Tối đa 5 Bot)</span>
          <span class="status-tag" id="globalStatus">Sẵn sàng</span>
        </h2>
        
        <!-- Cấu hình danh sách 5 tài khoản -->
        <div class="config-box">
          <div id="botConfigList"></div>
          <div style="margin-top: 10px;">
            <button class="btn-add-bot" onclick="addBotConfigRow()">➕ Thêm Tài Khoản Bot</button>
            <button style="background: #ff9800;" onclick="saveConfigList()">💾 Lưu Cấu Hình Bot</button>
          </div>
        </div>

        <div class="action-bar">
          <button class="btn-connect-all" onclick="connectAllBots()">🚀 Kết Nối Tất Cả Bot</button>
          <button class="btn-disconnect-all" onclick="disconnectAllBots()">🛑 Ngắt Kết Nối Tất Cả</button>
        </div>

        <!-- Navigation Tabs chọn Bot để xem chi tiết -->
        <div class="bot-tabs" id="botTabs"></div>

        <!-- Bảng hiển thị thông số Bot đang chọn -->
        <div class="stats-bar">
          <div class="stat-card">Tọa độ (X, Y, Z)<b id="statCoords">X: --, Y: --, Z: --</b></div>
          <div class="stat-card">Máu (HP)<b id="statHealth">❤️ -- / 20</b></div>
          <div class="stat-card">Độ đói / No<b id="statFood">🍖 -- / 20</b></div>
          <div class="stat-card">Player gần nhất<b id="statNearest">Không có</b></div>
        </div>

        <div class="dashboard-grid">
          <div>
            <div class="panel-title">📜 Nhật ký Bot đang chọn (Logs)</div>
            <div id="logs" class="panel"></div>
          </div>
          <div>
            <div class="panel-title">💬 Chat trong game</div>
            <div id="gameChat" class="panel"></div>
          </div>
        </div>

        <div class="control-section">
          <input type="text" id="cmdInput" placeholder="Nhập lệnh hoặc chat thay mặt Bot đang chọn..." onkeypress="handleKeyPress(event)" />
          <button class="btn-send" onclick="sendCommand()">Gửi lệnh</button>
        </div>
      </div>

      <script>
        const socket = io();
        let currentSelectedBotId = 1;
        let localConfigs = [];

        window.addEventListener('DOMContentLoaded', () => {
          socket.emit('get_initial_data');
        });

        socket.on('init_configs', (configs) => {
          localConfigs = configs;
          renderConfigRows();
          renderTabs();
        });

        function renderConfigRows() {
          const listDiv = document.getElementById('botConfigList');
          listDiv.innerHTML = '';
          localConfigs.forEach((cfg, index) => {
            const row = document.createElement('div');
            row.className = 'bot-config-row';
            row.innerHTML = \`
              <span style="font-weight:bold; min-width:60px;">Bot \${index + 1}:</span>
              <input type="text" placeholder="Username" value="\${cfg.username}" id="user_\${cfg.id}" />
              <input type="password" placeholder="Password /login" value="\${cfg.password}" id="pass_\${cfg.id}" />
              \${localConfigs.length > 1 ? \`<button class="btn-remove-config" onclick="removeBotConfig(\${cfg.id})">❌</button>\` : ''}
            \`;
            listDiv.appendChild(row);
          });
        }

        function renderTabs() {
          const tabsDiv = document.getElementById('botTabs');
          tabsDiv.innerHTML = '';
          localConfigs.forEach((cfg) => {
            const btn = document.createElement('button');
            btn.className = 'tab-btn' + (cfg.id === currentSelectedBotId ? ' active' : '');
            btn.textContent = cfg.username ? cfg.username : 'Bot ' + cfg.id;
            btn.onclick = () => switchTab(cfg.id);
            tabsDiv.appendChild(btn);
          });
        }

        function switchTab(botId) {
          currentSelectedBotId = botId;
          renderTabs();
          document.getElementById('logs').innerHTML = '';
          document.getElementById('gameChat').innerHTML = '';
          socket.emit('request_bot_data', botId);
        }

        function addBotConfigRow() {
          if (localConfigs.length >= 5) {
            alert('Tối đa chỉ hỗ trợ 5 Bot để đảm bảo tài nguyên RAM!');
            return;
          }
          const newId = localConfigs.length > 0 ? Math.max(...localConfigs.map(c => c.id)) + 1 : 1;
          localConfigs.push({ id: newId, username: 'bot_phu_' + newId, password: 'phong123@' });
          renderConfigRows();
          renderTabs();
        }

        function removeBotConfig(id) {
          localConfigs = localConfigs.filter(c => c.id !== id);
          if (currentSelectedBotId === id && localConfigs.length > 0) {
            currentSelectedBotId = localConfigs[0].id;
          }
          renderConfigRows();
          renderTabs();
        }

        function saveConfigList() {
          localConfigs.forEach(cfg => {
            const u = document.getElementById('user_' + cfg.id);
            const p = document.getElementById('pass_' + cfg.id);
            if (u) cfg.username = u.value.trim();
            if (p) cfg.password = p.value.trim();
          });
          socket.emit('save_configs', localConfigs);
          renderTabs();
          alert('Đã lưu cấu hình danh sách Bot!');
        }

        function connectAllBots() {
          saveConfigList();
          socket.emit('connect_all_bots');
        }

        function disconnectAllBots() {
          socket.emit('disconnect_all_bots');
        }

        socket.on('stats_update', (data) => {
          if (data.botId === currentSelectedBotId) {
            document.getElementById('statCoords').textContent = data.coords;
            document.getElementById('statHealth').textContent = '❤️ ' + data.health + ' / 20';
            document.getElementById('statFood').textContent = '🍖 ' + data.food + ' / 20';
            document.getElementById('statNearest').textContent = data.nearest;
          }
        });

        socket.on('log', (data) => {
          if (data.botId === currentSelectedBotId) {
            const logsDiv = document.getElementById('logs');
            logsDiv.innerHTML += '<div class="log-entry">' + data.msg + '</div>';
            logsDiv.scrollTop = logsDiv.scrollHeight;
          }
        });

        socket.on('chat_msg', (data) => {
          if (data.botId === currentSelectedBotId) {
            const chatDiv = document.getElementById('gameChat');
            chatDiv.innerHTML += '<div class="chat-entry">' + data.msg + '</div>';
            chatDiv.scrollTop = chatDiv.scrollHeight;
          }
        });

        function sendCommand() {
          const input = document.getElementById('cmdInput');
          const message = input.value.trim();
          if (message) {
            socket.emit('send_command', { botId: currentSelectedBotId, cmd: message });
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

function logToWeb(botId, msg) {
  const time = new Date().toLocaleTimeString('vi-VN');
  const formatted = '[' + time + '] ' + msg;
  console.log(`[Bot ${botId}] ${formatted}`);
  io.emit('log', { botId, msg: formatted });
}

function sendStatsToWeb(botId) {
  const bObj = activeBots[botId];
  if (!bObj || !bObj.instance || !bObj.instance.entity) return;

  const bot = bObj.instance;
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

  io.emit('stats_update', { botId, coords, health, food, nearest: nearestPlayer });
}

function startSingleBot(config) {
  const botId = config.id;
  
  if (!activeBots[botId]) {
    activeBots[botId] = { instance: null, isRunning: true, timeouts: [], hasLoggedIn: false, waitingForMenu: false, statsInterval: null, currentWindow: null };
  }

  const bObj = activeBots[botId];
  bObj.isRunning = true;

  clearBotTimeouts(botId);
  if (bObj.instance) {
    try { bObj.instance.quit(); } catch (e) {}
    bObj.instance = null;
  }
  if (bObj.statsInterval) clearInterval(bObj.statsInterval);

  bObj.hasLoggedIn = false;
  bObj.waitingForMenu = false;

  logToWeb(botId, "🔄 Đang kết nối tới kingmc.vn với tên " + config.username + "...");

  const bot = mineflayer.createBot({
    host: 'kingmc.vn',
    username: config.username,
    version: '1.20.1'
  });

  bObj.instance = bot;

  bot.on('message', (jsonMsg) => {
    const rawText = jsonMsg.toString().trim();
    if (rawText) {
      io.emit('chat_msg', { botId, msg: rawText });
    }
  });

  bot.on('spawn', () => {
    logToWeb(botId, "✅ Bot đã vào game thành công!");

    if (bObj.statsInterval) clearInterval(bObj.statsInterval);
    bObj.statsInterval = setInterval(() => sendStatsToWeb(botId), 1000);

    if (!bObj.hasLoggedIn) {
      bObj.hasLoggedIn = true;

      // Chuỗi gửi login 2 lần
      const t1 = setTimeout(() => {
        if (!bObj.isRunning || !bObj.instance) return;
        bot.chat('/login ' + config.password);
        logToWeb(botId, "🔐 Đã gửi lệnh /login lần 1");

        const t2 = setTimeout(() => {
          if (!bObj.isRunning || !bObj.instance) return;
          bot.chat('/login ' + config.password);
          logToWeb(botId, "🔐 Đã gửi lệnh /login lần 2");

          const t3 = setTimeout(() => {
            if (!bObj.isRunning || !bObj.instance) return;
            bObj.waitingForMenu = true;
            bot.chat('/menu');
            logToWeb(botId, "📋 Đã gửi lệnh /menu");
          }, 4000);

          bObj.timeouts.push(t3);
        }, 3000);

        bObj.timeouts.push(t2);
      }, 5000);

      bObj.timeouts.push(t1);
    }
  });

  bot.on('windowOpen', (window) => {
    bObj.currentWindow = window;
    let windowTitle = "Menu";
    try {
      windowTitle = window.title ? JSON.parse(window.title).text || window.title.toString() : "Menu";
    } catch (e) {
      windowTitle = window.title ? window.title.toString() : "Menu";
    }

    logToWeb(botId, "📋 Đã nhận diện Menu ngầm: " + windowTitle + " (" + window.slots.length + " ô)");

    // Chỉ click slot 24 sau lệnh /menu
    if (bObj.waitingForMenu && window.slots.length >= 25) {
      bObj.waitingForMenu = false;

      const t4 = setTimeout(() => {
        if (!bObj.isRunning || !bObj.instance || bObj.currentWindow !== window) return;
        try {
          bot.clickWindow(24, 0, 0);
          logToWeb(botId, "👉 Đã click slot thứ 24 theo lệnh /menu");

          const t5 = setTimeout(() => {
            if (!bObj.isRunning || !bObj.instance) return;
            bot.chat('/afk');
            logToWeb(botId, "💬 Đã gửi lệnh /afk");
          }, 4000);

          bObj.timeouts.push(t5);
        } catch (err) {
          logToWeb(botId, "⚠️ Lỗi click slot 24: " + err.message);
        }
      }, 3000);

      bObj.timeouts.push(t4);
    } else if (window.slots.length === 63 || window.slots.length === 54 || window.slots.length >= 10) {
      // Menu AFK: Ngẫu nhiên slot từ 0 đến 9
      const t6 = setTimeout(() => {
        if (!bObj.isRunning || !bObj.instance || bObj.currentWindow !== window) return;
        try {
          const randomSlot = Math.floor(Math.random() * 10);
          bot.clickWindow(randomSlot, 0, 0);
          logToWeb(botId, "🎲 Đã chọn ngẫu nhiên slot thứ " + randomSlot + " trong menu AFK");
        } catch (err) {
          logToWeb(botId, "⚠️ Lỗi click slot ngẫu nhiên: " + err.message);
        }
      }, 1500);

      bObj.timeouts.push(t6);
    }
  });

  bot.on('windowClose', () => {
    bObj.currentWindow = null;
  });

  bot.on('end', (reason) => {
    logToWeb(botId, "⚠️ Bot ngắt kết nối do: " + reason);
    clearBotTimeouts(botId);
    if (bObj.statsInterval) clearInterval(bObj.statsInterval);

    if (bObj.isRunning) {
      logToWeb(botId, "⏳ Tự động kết nối lại (reconnect) sau 10 giây...");
      setTimeout(() => {
        if (bObj.isRunning) {
          startSingleBot(config);
        }
      }, 10000);
    }
  });

  bot.on('error', (err) => {
    logToWeb(botId, "❌ Lỗi Bot: " + err.message);
    clearBotTimeouts(botId);
  });
}

io.on('connection', (socket) => {
  socket.on('get_initial_data', () => {
    socket.emit('init_configs', botsConfig);
  });

  socket.on('save_configs', (configs) => {
    if (configs && Array.isArray(configs)) {
      botsConfig = configs.slice(0, MAX_BOTS);
    }
  });

  socket.on('connect_all_bots', () => {
    // Kết nối lần lượt từng bot cách nhau 3 giây (Staggered connect)
    botsConfig.forEach((cfg, idx) => {
      setTimeout(() => {
        startSingleBot(cfg);
      }, idx * 3000);
    });
  });

  socket.on('disconnect_all_bots', () => {
    Object.keys(activeBots).forEach(botId => {
      const bObj = activeBots[botId];
      if (bObj) {
        bObj.isRunning = false;
        clearBotTimeouts(botId);
        if (bObj.statsInterval) clearInterval(bObj.statsInterval);
        if (bObj.instance) {
          try { bObj.instance.quit(); } catch (e) {}
          bObj.instance = null;
        }
        logToWeb(botId, "🛑 Đã ngắt kết nối thủ công.");
      }
    });
  });

  socket.on('send_command', (data) => {
    const { botId, cmd } = data;
    const bObj = activeBots[botId];
    if (bObj && bObj.instance && bObj.isRunning) {
      if (cmd.trim().toLowerCase() === '/menu') {
        bObj.waitingForMenu = true;
      }
      bObj.instance.chat(cmd);
      logToWeb(botId, "📤 [Web gửi]: " + cmd);
    }
  });
});

server.listen(PORT, () => {
  console.log("Multi-Bot Dashboard đang chạy hoàn hảo tại cổng " + PORT);
});
