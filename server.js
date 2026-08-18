/**
 * server.js - Servidor de Comunicação Real-Time para "O Observador"
 * Responsável pelo gerenciamento de WebSockets, histórico de mensagens,
 * confirmações de leitura e sincronização de estado entre dispositivos.
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const servidor = http.createServer(app);

// Configuração do servidor WebSocket com suporte a mídias de até 10MB
const wss = new WebSocket.Server({ 
    server: servidor,
    maxPayload: 10 * 1024 * 1024 
});

// Estrutura de histórico de mensagens mantida na memória do servidor
let historicoMensagens = [];

// Serve os arquivos estáticos da pasta 'public' (HTML, CSS, JS)
app.use(express.static('public'));

wss.on('connection', (ws) => {
    ws.isAlive = true;

    // Resposta ao sinal de batimento cardíaco (ping/pong) para manter conexão ativa
    ws.on('pong', () => { ws.isAlive = true; });

    // Envia o histórico existente assim que o dispositivo se conecta
    try {
        ws.send(JSON.stringify({
            tipo: 'historico',
            conteudo: historicoMensagens
        }));
    } catch (erro) {
        console.error("Erro ao enviar histórico inicial:", erro);
    }

    // Processamento de mensagens recebidas dos clientes
    ws.on('message', (dadosBrutos) => {
        try {
            const pacote = JSON.parse(dadosBrutos);

            // 1. Tratamento de Novas Mensagens (Texto, Imagem, Áudio)
            if (pacote.tipoEvent === 'nova_mensagem') {
                historicoMensagens.push(pacote.conteudo);
                if (historicoMensagens.length > 100) historicoMensagens.shift();

                // Retransmite para todos os clientes conectados
                wss.clients.forEach((cliente) => {
                    if (cliente.readyState === WebSocket.OPEN) {
                        cliente.send(JSON.stringify({
                            tipo: 'nova_mensagem',
                            conteudo: pacote.conteudo
                        }));
                    }
                });
            }

            // 2. Tratamento de Confirmação de Leitura e Remoção
            else if (pacote.tipoEvent === 'confirmar_leitura') {
                const idMsg = pacote.idMensagem;
                
                // Atualiza o estado no histórico
                const msgIndex = historicoMensagens.findIndex(m => m.id === idMsg);
                if (msgIndex !== -1) {
                    historicoMensagens[msgIndex].lida = true;
                }

                // Notifica todos os clientes para atualizar status e remover a mensagem
                wss.clients.forEach((cliente) => {
                    if (cliente.readyState === WebSocket.OPEN) {
                        cliente.send(JSON.stringify({
                            tipo: 'mensagem_lida_confirmada',
                            idMensagem: idMsg
                        }));
                    }
                });
            }

            // 3. Tratamento de Indicador de "Digitando..."
            else if (pacote.tipoEvent === 'digitando') {
                wss.clients.forEach((cliente) => {
                    if (cliente !== ws && cliente.readyState === WebSocket.OPEN) {
                        cliente.send(JSON.stringify({
                            tipo: 'usuario_digitando',
                            remetente: pacote.remetente,
                            estado: pacote.estado
                        }));
                    }
                });
            }

        } catch (erro) {
            console.error("Erro ao processar pacote no servidor:", erro);
        }
    });

    ws.on('close', () => {
        console.log("Dispositivo desconectado.");
    });
});

// Monitoramento de conexões ativas a cada 20 segundos
const intervalo = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 20000);

wss.on('close', () => {
    clearInterval(intervalo);
});

// Inicialização na porta configurada pelo ambiente ou porta padrão 3000
const PORTA = process.env.PORT || 3000;
servidor.listen(PORTA, '0.0.0.0', () => {
    console.log(`Servidor O Observador rodando na porta ${PORTA}`);
});
