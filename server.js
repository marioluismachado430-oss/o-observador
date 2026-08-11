// server.js - Servidor com Histórico Persistente (Estilo WhatsApp)
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const servidor = http.createServer(app);
const wss = new WebSocket.Server({ server: servidor });

// Array para guardar o histórico de mensagens enquanto o servidor estiver ativo
let historicoMensagens = [];

// Disponibiliza os ficheiros da pasta 'public'
app.use(express.static('public'));

wss.on('connection', (ws) => {
    console.log('Novo dispositivo conectado. A enviar histórico...');

    // 1. Envia todo o histórico armazenado para o novo cliente assim que ele se conecta
    historicoMensagens.forEach((msgAntiga) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msgAntiga));
        }
    });

    // 2. Ouve novas mensagens enviadas por qualquer cliente
    ws.on('message', (dadosBrutos) => {
        try {
            const mensagemObj = JSON.parse(dadosBrutos);
            
            // Guarda a mensagem no histórico do servidor
            historicoMensagens.push(mensagemObj);

            // Limita o histórico às últimas 100 mensagens para poupar memória do servidor
            if (historicoMensagens.length > 100) {
                historicoMensagens.shift();
            }

            // Retransmite a mensagem para todos os *outros* clientes conectados em tempo real
            wss.clients.forEach((cliente) => {
                if (cliente !== ws && cliente.readyState === WebSocket.OPEN) {
                    cliente.send(JSON.stringify(mensagemObj));
                }
            });
        } catch (erro) {
            console.error("Erro ao processar mensagem:", erro);
        }
    });

    ws.on('close', () => {
        console.log('Dispositivo desconectado.');
    });
});

// Inicialização da porta para o Render
const PORTA = process.env.PORTA || process.env.PORT || 3000;
servidor.listen(PORTA, () => {
    console.log(`Servidor a correr na porta ${PORTA}`);
});
