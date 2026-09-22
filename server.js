// LIXEIRO INTELIGENTE COM MARGEM SEGURA DE 24 HORAS APÓS A LEITURA
const UM_DIA_EM_MS = 24 * 60 * 60 * 1000; // 24 horas exatas

const intervaloLimpeza = setInterval(async () => {
    const agora = Date.now();
    try {
        const { data: mensagens } = await supabase.from('mensagens').select('*');
        if (!mensagens) return;

        let idsRemovidos = [];
        mensagens.forEach(m => {
            // A mensagem só entra na regra de exclusão se JÁ FOI LIDA
            if (m.lida === true && m.timestamp_leitura) {
                const tempoDecorrido = agora - Number(m.timestamp_leitura);
                
                // Garante que passou RIGOROSAMENTE mais de 24 horas desde a leitura
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
}, 60000); // Verifica a cada 1 minuto
