const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'SUA_URL_DO_SUPABASE';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'SUA_CHAVE_ANON_DO_SUPABASE';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const app = express();
const servidor = http.createServer(app);

const wss = new WebSocket.Server({ 
    server: servidor,
    maxPayload: 50 * 1024 * 1024 
});

app.use(express.static(path.join(__dirname, 'public')));

const USUARIOS_AUTORIZADOS = {
    "mario": { id: "user_mario", nome: "Mario Luis" },
    "gal": { id: "user_gal", nome: "Gal" },
    "amigos": { id: "user_amigos", nome: "Amigos" }
};

async function buscarHistoricoDoBanco() {
    try {
        const { data, error } = await supabase
            .from('mensagens')
            .select('*')
            .order('timestamp_criacao', { ascending: true });
        
        if (error) {
            console.error("Erro ao buscar histórico do Supabase:", error);
            return [];
        }

        return data.map(m => ({
            id: m.id,
            remetente: m.remetente,
            nomeRemetente: m.nome_remetente,
            tipoMidia: m.tipo_midia,
            conteudo: m.conteudo,
            citacao: m.citacao,
            reacoes: m.reacoes || {},
            lida: m.lida,
            timestampCriacao: Number(m.timestamp_criacao),
            timestampLeitura: m.timestamp_leitura ? Number(m.timestamp_leitura) : null
        }));
    } catch (e) {
        console.error("Erro de conexão com Supabase:", e);
        return [];
    }
}

wss.on('connection', async (ws) => {
    ws.isAlive = true;
    ws.usuarioAtual = null;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', async (mensagem) => {
        try {
            const dados = JSON.parse(mensagem);

            if (dados.tipoEvent === 'login') {
                const credencial = dados.senha ? dados.senha.toLowerCase().trim() : '';
                if (USUARIOS_AUTORIZADOS[credencial]) {
                    ws.usuarioAtual = USUARIOS_AUTORIZADOS[credencial];
                    const historicoAtual = await buscarHistoricoDoBanco();
                    
                    ws.send(JSON.stringify({
                        tipo: 'login_sucesso',
                        id: ws.usuarioAtual.id,
                        nome: ws.usuarioAtual.nome,
                        conteudo: historicoAtual
                    }));
                } else {
                    ws.send(JSON.stringify({ tipo: 'login_erro' }));
                }
            }
            else if (dados.tipoEvent === 'nova_mensagem') {
                if (!ws.usuarioAtual) return;

                const novaMsg = {
                    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                    remetente: ws.usuarioAtual.id,
                    nomeRemetente: ws.usuarioAtual.nome,
                    tipoMidia: dados.conteudo.tipoMidia,
                    conteudo: dados.conteudo.conteudo,
                    citacao: dados.conteudo.citacao || null,
                    reacoes: {},
                    lida: false,
                    timestampCriacao: Date.now(),
                    timestampLeitura: null
                };
                
                await supabase.from('mensagens').insert([{
                    id: novaMsg.id,
                    remetente: novaMsg.remetente,
                    nome_remetente: novaMsg.nomeRemetente,
                    tipo_midia: novaMsg.tipoMidia,
                    conteudo: novaMsg.conteudo,
                    citacao: novaMsg.citacao,
                    reacoes: novaMsg.reacoes,
                    lida: novaMsg.lida,
                    timestamp_criacao: novaMsg.timestampCriacao,
                    timestamp_leitura: novaMsg.timestampLeitura
                }]);

                wss.clients.forEach((cliente) => {
                    if (cliente.readyState === WebSocket.OPEN) {
                        cliente.send(JSON.stringify({
                            tipo: 'nova_mensagem',
                            conteudo: novaMsg
                        }));
                    }
                });
            } 
            else if (dados.tipoEvent === 'adicionar_reacao') {
                if (!ws.usuarioAtual) return;
                
                const { data: msgList } = await supabase.from('mensagens').select('*').eq('id', dados.idMensagem);
                if (msgList && msgList.length > 0) {
                    const msgAlvo = msgList[0];
                    let reacoes = msgAlvo.reacoes || {};
                    const emoji = dados.emoji;

                    if (!reacoes[emoji]) {
                        reacoes[emoji] = [];
                    }
                    const index = reacoes[emoji].indexOf(ws.usuarioAtual.id);
                    if (index > -1) {
                        reacoes[emoji].splice(index, 1);
                        if (reacoes[emoji].length === 0) delete reacoes[emoji];
                    } else {
                        reacoes[emoji].push(ws.usuarioAtual.id);
                    }

                    await supabase.from('mensagens').update({ reacoes: reacoes }).eq('id', dados.idMensagem);

                    wss.clients.forEach((cliente) => {
                        if (cliente.readyState === WebSocket.OPEN) {
                            cliente.send(JSON.stringify({
                                tipo: 'atualizar_reacoes',
                                idMensagem: dados.idMensagem,
                                reacoes: reacoes
                            }));
                        }
                    });
                }
            }
            else if (dados.tipoEvent === 'confirmar_leitura') {
                const { data: msgList } = await supabase.from('mensagens').select('*').eq('id', dados.idMensagem);
                if (msgList && msgList.length > 0) {
                    const msgAlvo = msgList[0];
                    if (!msgAlvo.lida) {
                        const tempoLeitura = Date.now();
                        await supabase.from('mensagens').update({ 
                            lida: true, 
                            timestamp_leitura: tempoLeitura 
                        }).eq('id', dados.idMensagem);
                    }
                }

                wss.clients.forEach((cliente) => {
                    if (cliente.readyState === WebSocket.OPEN) {
                        cliente.send(JSON.stringify({
                            tipo: 'mensagem_lida_confirmada',
                            idMensagem: dados.idMensagem
                        }));
                    }
                });
            }
            else if (dados.tipoEvent === 'digitando') {
                if (!ws.usuarioAtual) return;
                wss.clients.forEach((cliente) => {
                    if (cliente !== ws && cliente.readyState === WebSocket.OPEN) {
                        cliente.send(JSON.stringify({
                            tipo: 'usuario_digitando',
                            remetente: ws.usuarioAtual.nome,
                            estado: dados.estado
                        }));
                    }
                });
            }
            else if (dados.tipoEvent === 'limpar_historico') {
                await supabase.from('mensagens').delete().neq('id', '');
                wss.clients.forEach((cliente) => {
                    if (cliente.readyState === WebSocket.OPEN) {
                        cliente.send(JSON.stringify({ tipo: 'historico_limpo' }));
                    }
                });
            }
        } catch (erro) {
            console.error("Erro ao processar pacote:", erro);
        }
    });

    ws.on('error', (erro) => { console.error("Erro no WebSocket:", erro); });
});

const intervaloMonitor = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 25000);

const UM_DIA_EM_MS = 24 * 60 * 60 * 1000;
const intervaloLimpeza = setInterval(async () => {
    const agora = Date.now();
    try {
        const { data: mensagens } = await supabase.from('mensagens').select('*');
        if (!mensagens) return;

        let idsRemovidos = [];
        mensagens.forEach(m => {
            if (m.lida === true && m.timestamp_leitura) {
                const tempoDecorrido = agora - Number(m.timestamp_leitura);
                if (tempoDecorrido > UM_DIA_EM_MS) {
                    idsRemovidos.push(m.id);
                }
            }
        });

        if (idsRemovidos.length > 0) {
            await supabase.from('mensagens').delete().in('id', idsRemovidos);

            wss.clients.forEach(c => {
                if (c.readyState === WebSocket.OPEN) {
                    c.send(JSON.stringify({
                        tipo: 'apagar_antigas',
                        ids: idsRemovidos
                    }));
                }
            });
        }
    } catch (e) {
        console.error("Erro na limpeza automática do Supabase:", e);
    }
}, 60000);

wss.on('close', () => {
    clearInterval(intervaloMonitor);
    clearInterval(intervaloLimpeza);
});

const PORTA = process.env.PORT || 3000;
servidor.listen(PORTA, '0.0.0.0', () => {
    console.log(`[O OBSERVADOR] Servidor rodando na porta ${PORTA}`);
});
