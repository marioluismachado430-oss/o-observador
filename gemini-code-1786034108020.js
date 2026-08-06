const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const salas = {}; // Estrutura: { nomeSala: [Array de Conexões WebSocket] }

const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, req.url === '/' ? 'O-Observador.html' : req.url);
  
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Arquivo nao encontrado');
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content, 'utf-8');
    }
  });
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let minhaSala = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // Entrada em uma sala
      if (data.tipo === 'join') {
        minhaSala = data.sala;
        if (!salas[minhaSala]) salas[minhaSala] = [];
        salas[minhaSala].push(ws);
      }

      // Encaminhamento de mensagens cifradas
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

      // Trata o recibo de leitura (envia confirmação do leitor de volta ao remetente)
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
      console.error('Erro de WebSocket:', err);
    }
  });

  ws.on('close', () => {
    if (minhaSala && salas[minhaSala]) {
      salas[minhaSala] = salas[minhaSala].filter((cliente) => cliente !== ws);
    }
  });
});

server.listen(PORT, () => {
  console.log(`[O OBSERVADOR] Servidor rodando em http://localhost:${PORT}`);
});