// --- BACKEND DO SERVIDOR (server.js) ---

// 1. Importação das ferramentas necessárias
const express = require('express');
const path = require('path');
const http = require('http'); // Necessário para integrar páginas e mensagens
const { WebSocketServer } = require('ws'); // O motor de comunicação em tempo real

const app = express();

// 2. Configuração do servidor visual (Interface e Segurança)
// Define que todos os arquivos visuais estão na pasta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Quando acederem à página, entrega o index.html com o bloqueio de senha
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 3. Criação do servidor HTTP base
// Este servidor vai suportar tanto o Express quanto os WebSockets na mesma porta
const server = http.createServer(app);

// 4. Configuração do Servidor de Mensagens (O Observador)
const wss = new WebSocketServer({ server });
const salas = {}; // Prepara a estrutura para guardar as conexões (salas)

wss.on('connection', (ws) => {
    console.log('[O OBSERVADOR] Novo utilizador conectado ao sistema de comunicação.');

    // O que acontece quando o servidor recebe uma mensagem
    ws.on('message', (message) => {
        try {
            // Converte a mensagem recebida (em formato de texto/buffer) para o formato JSON
            const dados = JSON.parse(message);
            
            // Retransmite a mensagem para todos os outros utilizadores conectados
            wss.clients.forEach((cliente) => {
                // Verifica se o cliente não é quem enviou e se a conexão dele está aberta (readyState === 1)
                if (cliente !== ws && cliente.readyState === 1) { 
                    cliente.send(JSON.stringify(dados));
                }
            });

        } catch (erro) {
            console.error("[ERRO] Falha ao processar a mensagem:", erro);
        }
    });

    // O que acontece quando alguém sai do aplicativo
    ws.on('close', () => {
        console.log('[O OBSERVADOR] Um utilizador desconectou.');
    });
});

// 5. Configuração da Porta para o Render (0.0.0.0 evita a desconexão por inatividade de IP)
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[O OBSERVADOR] Sistema online na porta ${PORT}. Servindo páginas e recebendo mensagens!`);
});
