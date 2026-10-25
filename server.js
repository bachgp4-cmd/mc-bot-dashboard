const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let bot = null;
let afkInterval = null;
let isAfkMenu = false; // Cờ theo dõi trạng thái mở menu (Menu chính hay Menu /afk)

let botState = {
  status: 'disconnected', // disconnected, connecting, online
  health: 20,
  food: 20,
  position: { x: 0, y: 0, z: 0 },
  logs: []
};

function addLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  const logMsg = `[${timestamp}] ${message}`;
  console.log(logMsg);
  botState.logs.push(logMsg);
  if (botState.logs.length > 50) botState.logs.shift();
  io.emit('log', logMsg);
}

function updateState(newData) {
  botState = { ...botState, ...newData };
  io.emit('state', botState);
}

// Giao diện Web Dashboard
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Minecraft Bot Control Panel</title>
        <script src="/socket.io/socket.io.js"></script>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #121212; color: #e0e0e0; margin: 0; padding: 20px; }
            .container { max-width: 900px; margin: auto; background: #1e1e1e; padding: 20px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
            h1 { color: #4CAF50; text-align: center; margin-top: 0; }
            .card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; margin-bottom: 20px; }
            .card { background: #2d2d2d; padding: 15px; border-radius: 8px; border-left: 5px solid #4CAF50; }
            .card h3 { margin: 0 0 10px 0; font-size: 14px; color: #aaa; }
            .card p { margin: 0; font-size: 18px; font-weight: bold; }
            .controls { display: flex; gap: 10px; margin-bottom: 20px; }
            button { flex: 1; padding: 12px; font-size: 16px; font-weight: bold; border: none; border-radius: 5px; cursor: pointer; transition: 0.2s; }
            .btn-start { background: #4CAF50; color: white; }
            .btn-start:hover { background: #45a049; }
            .btn-stop { background: #f44336; color: white; }
            .btn-stop:hover { background: #da190b; }
            #logs { background: #0f0f0f; color: #00ff00; padding: 15px; border-radius: 5px; height: 250px; overflow-y: auto; font-family: monospace; font-size: 13px; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🤖 Minecraft Bot Dashboard</h1>
            
            <div class="controls">
                <button class="btn-start" onclick="startBot()">Vào Server (Start Bot)</button>
                <button class="btn-stop" onclick="stopBot()">Thoát Server (Stop Bot)</button>
            </div>

            <div class="card-grid">
                <div class="card">
                    <h3>Trạng thái</h3>
                    <p id="status">Đang ngắt kết nối</p>
                </div>
                <div class="card">
                    <h3>Máu (Health)</h3>
                    <p id="health">20 / 20</p>
                </div>
                <div class="card">
                    <h3>Độ đói (Food)</h3>
                    <p id="food">20 / 20</p>
                </div>
                <div class="card" style="border-left-color: #2196F3;">
                    <h3>Tọa độ (X, Y, Z)</h3>
                    <p id="position">X: 0, Y: 0, Z: 0</p>
                </div>
            </div>

            <h3>Nhật ký hoạt động (Logs)</h3>
            <div id="logs"></div>
        </div>

        <script>
            const socket = io();

            function startBot() { socket.emit('start'); }
            function stopBot() { socket.emit('stop'); }

            socket.on('state', (state) => {
                let statusText = 'Đang ngắt kết nối';
                if (state.status === 'connecting') statusText = 'Đang kết nối...';
                if (state.status === 'online') statusText = 'Trực tuyến (Online)';

                document.getElementById('status').innerText = statusText;
                document.getElementById('health').innerText = (state.health || 20) + ' / 20';
                document.getElementById('food').innerText = (state.food || 20) + ' / 20';
                document.getElementById('position').innerText = \`X: \${state.position.x}, Y: \${state.position.y}, Z: \${state.position.z}\`;
            });

            socket.on('log', (msg) => {
                const logsDiv = document.getElementById('logs');
                logsDiv.innerHTML += msg + '<br>';
                logsDiv.scrollTop = logsDiv.scrollHeight;
            });
        </script>
    </body>
    </html>
  `);
});

// Xử lý sự kiện Socket.IO
io.on('connection', (socket) => {
  socket.emit('state', botState);
  botState.logs.forEach(log => socket.emit('log', log));

  socket.on('start', () => {
    if (bot) {
      addLog('Bot đang hoạt động rồi!');
      return;
    }
    
    isAfkMenu = false; // Reset lại cờ khi bắt đầu phiên mới
    addLog('Đang khởi động bot kết nối tới kingmc.vn...');
    updateState({ status: 'connecting' });

    try {
      bot = mineflayer.createBot({
        host: 'kingmc.vn',
        username: '_caubemocoi_',
        version: false
      });

      bot.on('spawn', () => {
        addLog('Bot đã vào server thành công!');
        updateState({ status: 'online' });

        // Tự động gõ lệnh /login và /menu
        setTimeout(() => {
          bot.chat('/login phong123@');
          addLog('Đã gửi lệnh /login phong123@');
          
          setTimeout(() => {
            bot.chat('/menu');
            addLog('Đã mở Menu chính...');
          }, 6000);
        }, 5000);

        // Kích hoạt Anti-AFK nhảy mỗi 40 giây
        if (afkInterval) clearInterval(afkInterval);
        afkInterval = setInterval(() => {
          if (bot && bot.entity) {
            bot.setControlState('jump', true);
            setTimeout(() => bot.setControlState('jump', false), 500);
            addLog('⚡ Auto Anti-AFK: Đã nhảy!');
          }
        }, 40000);
      });

      bot.on('windowOpen', async (window) => {
        if (!isAfkMenu) {
          // Lần mở menu đầu tiên: Chọn Slot 24 vào KingSMP
          addLog('Đang ở Menu chính! Chờ 2 giây để click Slot 24 (KingSMP)...');
          setTimeout(async () => {
            try {
              await bot.clickWindow(24, 0, 0);
              addLog('Đã click Slot 24 vào KingSMP thành công!');
              
              // Đợi thêm 5 giây để vào game ổn định rồi gõ lệnh /afk
              setTimeout(() => {
                isAfkMenu = true; // Đánh dấu lần mở menu tiếp theo là của /afk
                bot.chat('/afk');
                addLog('Đã gửi lệnh /afk. Đang chờ bảng chọn slot AFK...');
              }, 5000);

            } catch (err) {
              addLog('Lỗi khi click Slot 24: ' + err.message);
            }
          }, 2000);
        } else {
          // Lần mở menu thứ hai: Chọn Slot thứ 6 (index 5) trong bảng /afk
          addLog('Đã mở bảng /afk! Chờ 1.5 giây để click Slot 6...');
          setTimeout(async () => {
            try {
              await bot.clickWindow(5, 0, 0); // Slot số 6 (index 5)
              addLog('Đã chọn thành công Slot số 6 của /afk!');
            } catch (err) {
              addLog('Lỗi khi click Slot AFK: ' + err.message);
            }
          }, 1500);
        }
      });

      // Cập nhật tọa độ và chỉ số thời gian thực
      bot.on('physicsTick', () => {
        if (bot && bot.entity) {
          updateState({
            health: bot.health,
            food: bot.food,
            position: {
              x: Math.round(bot.entity.position.x),
              y: Math.round(bot.entity.position.y),
              z: Math.round(bot.entity.position.z)
            }
          });
        }
      });

      bot.on('end', (reason) => {
        addLog('Bot đã thoát/mất kết nối: ' + reason);
        if (afkInterval) clearInterval(afkInterval);
        bot = null;
        updateState({ status: 'disconnected', health: 0, food: 0 });
      });

      bot.on('error', (err) => {
        addLog('Lỗi bot: ' + err.message);
      });

    } catch (e) {
      addLog('Lỗi khởi tạo: ' + e.message);
      bot = null;
      updateState({ status: 'disconnected' });
    }
  });

  socket.on('stop', () => {
    if (bot) {
      addLog('Đang yêu cầu bot ngắt kết nối khỏi server...');
      if (afkInterval) clearInterval(afkInterval);
      bot.quit();
      bot = null;
      updateState({ status: 'disconnected' });
    } else {
      addLog('Bot hiện không chạy trong server.');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Web Dashboard đang chạy tại: http://localhost:${PORT}`);
});