// --- SERVIDOR BACKEND (server.js) ---
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const salas = {}; // Guarda as conexões por sala

// 1. Cria o servidor HTTP para entregar os arquivos ao navegador
const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, req.url === '/' ? 'O-Observador.html' : req.url);
  
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Arquivo nao encontrado na pasta.');
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content, 'utf-8');
    }
  });
});

// 2. Cria o servidor de WebSocket para trocar mensagens em tempo real
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let minhaSala = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // Entrar na sala de comunicação
      if (data.tipo === 'join') {
        minhaSala = data.sala;
        if (!salas[minhaSala]) salas[minhaSala] = [];
        salas[minhaSala].push(ws);
      }

      // Encaminhar carta cifrada para a outra pessoa na sala
      if (data.tipo === 'carta') {
        if (salas[data.sala]) {
          salas[data.sala].forEach((cliente) => {
            if (cliente !== ws && cliente.readyState === 1) {
              cliente.send(JSON.stringify({
                tipo: 'carta',
                id: data.id,
                envelope: data.envelope
              }));
            }
          });
        }
      }

      // Encaminhar recibo de leitura
      if (data.tipo === 'recibo') {
        if (salas[data.sala]) {
          salas[data.sala].forEach((cliente) => {
            if (cliente !== ws && cliente.readyState === 1) {
              cliente.send(JSON.stringify({
                tipo: 'lido',
                id: data.id
              }));
            }
          });
        }
      }
    } catch (err) {
      console.error('Erro ao processar mensagem:', err);
    }
  });

  ws.on('close', () => {
    if (minhaSala && salas[minhaSala]) {
      salas[minhaSala] = salas[minhaSala].filter((cliente) => cliente !== ws);
    }
  });
});

// 3. Liga o servidor na porta 8080
server.listen(PORT, () => {
  console.log(`[O OBSERVADOR] Servidor rodando em http://localhost:${PORT}`);
});