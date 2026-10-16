const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// Variáveis de estado em memória
let pedidoPendente = null;
let pedidoPendenteIncompleto = null;
let sock = null;

// Map para armazenar histórico de comprovativos já utilizados
const referenciasUtilizadas = new Map();

// ==========================================
// Mapeamento Automático de Valores Permitidos
// ==========================================
const tabelaPrecos = {
  // MEGAS VODACOM
  "93": "5GB",
  "178": "10GB",
  "267": "15GB",
  "356": "20GB",
  "445": "25GB",
  "534": "30GB",
  "712": "40GB",
  "890": "50GB",
  "1068": "60GB",
  "1246": "70GB",
  "1424": "80GB",
  "1602": "90GB",
  "1780": "100GB",
  "2670": "150GB",
  "3560": "200GB",
  "4450": "250GB",
  "5340": "300GB",

  // SALDO
  "18": "20MT Saldo",
  "20": "20MT Saldo",
  "27": "30MT Saldo",
  "30": "30MT Saldo",
  "45": "50MT Saldo",
  "50": "50MT Saldo",
  "85": "100MT Saldo",
  "100": "100MT Saldo",
  "135": "150MT Saldo",
  "150": "150MT Saldo",
  "175": "200MT Saldo",
  "200": "200MT Saldo",
  "255": "300MT Saldo",
  "300": "350MT Saldo",
  "345": "400MT Saldo",
  "400": "400MT Saldo",
  "385": "450MT Saldo",
  "450": "450MT Saldo",
  "410": "500MT Saldo",
  "500": "500MT Saldo",
  "495": "600MT Saldo",
  "600": "600MT Saldo",
  "580": "700MT Saldo",
  "700": "700MT Saldo",
  "665": "800MT Saldo",
  "800": "800MT Saldo",
  "750": "900MT Saldo",
  "900": "900MT Saldo",
  "825": "1.000MT Saldo",
  "1000": "1.000MT Saldo"
};

// Função para extrair o JID real do remetente
function obterJidReal(msg) {
  let sender = msg.key.participant || msg.key.remoteJid;
  if (sender.includes(':')) {
    sender = sender.split(':')[0] + '@s.whatsapp.net';
  }
  return sender;
}

// ==========================================
// ROTAS DA API HTTP
// ==========================================

app.get('/', (req, res) => {
  res.send('✅ Bot do WhatsApp ativo!');
});

app.get('/api/obter-pendentes', (req, res) => {
  if (pedidoPendente) {
    return res.json({
      temPedido: true,
      megas: pedidoPendente.pacote,
      pacote: pedidoPendente.pacote,
      numero: pedidoPendente.numero,
      valor: pedidoPendente.valor || "0",
      referencia: pedidoPendente.referencia || "DIRETO"
    });
  }
  
  return res.json({
    temPedido: false
  });
});

app.post('/api/confirmar', async (req, res) => {
  if (!pedidoPendente) {
    return res.status(400).json({ sucesso: false, mensagem: "Nenhum pedido pendente para confirmar." });
  }

  try {
    if (sock && pedidoPendente.jid && pedidoPendente.messageKey) {
      await sock.sendMessage(pedidoPendente.jid, {
        text: `✅ *ENVIO CONCLUÍDO COM SUCESSO!*\n\n📊 Pacote: ${pedidoPendente.pacote}\n📱 Número: ${pedidoPendente.numero}\n\n🚀 *Status:* Processado com sucesso!`,
        edit: pedidoPendente.messageKey
      });
    }

    console.log(`[SUCESSO] Pedido para ${pedidoPendente.numero} concluído e mensagem atualizada.`);
    pedidoPendente = null;

    return res.json({ sucesso: true, mensagem: "Pedido confirmado e mensagem atualizada." });
  } catch (error) {
    console.error("Erro ao confirmar pedido ou editar mensagem:", error);
    return res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// ==========================================
// CONEXÃO WHATSAPP (Baileys)
// ==========================================

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    auth: state,
    printQRInTerminal: false,
    browser: ["Ubuntu", "Chrome", "20.0.04"]
  });

  sock.ev.on('creds.update', saveCreds);

  if (!sock.authState.creds.registered) {
    // Número atualizado para envio do código de pareamento
    const phoneNumber = "258841066314";
    
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phoneNumber);
        console.log('\n========================================');
        console.log(`🔑 CÓDIGO DE PAREAMENTO PARA 841066314: ${code}`);
        console.log('========================================\n');
      } catch (err) {
        console.error("Erro ao solicitar código de emparelhamento:", err);
      }
    }, 3000);
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
      console.log('Conexão fechada. Reconectando...', shouldReconnect);
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      console.log('✅ Bot conectado com sucesso!');
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    try {
      const msg = m.messages[0];
      if (!msg || !msg.message || msg.key.fromMe) return;

      const jid = msg.key.remoteJid;
      const isGroup = jid.endsWith('@g.us');

      const senderJid = obterJidReal(msg);
      const senderNumero = senderJid.split('@')[0];

      const textoProcessar = (
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        ""
      ).trim();

      if (!textoProcessar) return;

      const comando = textoProcessar.toLowerCase();

      let isSenderAdmin = false;
      let groupAdmins = [];

      if (isGroup) {
        const groupMetadata = await sock.groupMetadata(jid).catch(() => null);
        if (groupMetadata) {
          groupAdmins = groupMetadata.participants
            .filter(p => p.admin !== null)
            .map(p => p.id);
          isSenderAdmin = groupAdmins.includes(senderJid);
        }
      }

      // COMANDO PARA REVELAR O ID DO GRUPO
      if (comando === 'id') {
        await sock.sendMessage(jid, { text: `🔑 *ID deste Grupo:* \n\`${jid}\`` }, { quoted: msg }).catch(() => {});
        return;
      }

      // 1. COMANDOS DE TEXTO E GESTÃO DO GRUPO (.link, .fechar, .abrir)
      if (comando === '.link') {
        if (isGroup && !isSenderAdmin) return;
        try {
          await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: false, id: msg.key.id, participant: senderJid } });
        } catch (e) {}

        const linkTexto = `┏━━━━━━━━━━━━━━━━━━━━━┓\n` +
                          `   🔗 *LINK DO GRUPO*\n` +
                          `┗━━━━━━━━━━━━━━━━━━━━━┛\n\n` +
                          `https://chat.whatsapp.com/EtV0CHusTxK0Uz41bV2X5h`;

        await sock.sendMessage(jid, { text: linkTexto }).catch(() => {});
        return;
      }

      if (comando === '.fechar') {
        if (isGroup && !isSenderAdmin) return;
        try {
          await sock.groupSettingUpdate(jid, 'announcement');
        } catch (err) {
          console.error("Erro ao fechar grupo:", err);
        }

        const fecharTexto = `┏━━━━━━━━━━━━━━━┓\n` +
                            `🔒 GRUPO FECHADO\n` +
                            `┗━━━━━━━━━━━━━━━┛\n\n` +
                            `📦 Para solicitações urgentes 🚨 de Stock ou saldo, por favor, entre em contacto com um dos ADM`;

        await sock.sendMessage(jid, { text: fecharTexto }).catch(() => {});
        return;
      }

      if (comando === '.abrir') {
        if (isGroup && !isSenderAdmin) return;
        try {
          await sock.groupSettingUpdate(jid, 'not_announcement');
        } catch (err) {
          console.error("Erro ao abrir grupo:", err);
        }

        const abrirTexto = `╭━━━━━━━━━━━━━━━━━━━╮\n` +
                           `   🌅 *BOM DIA, FAMÍLIA!* ☀️\n` +
                           `╰━━━━━━━━━━━━━━━━━━━╯\n\n` +
                           `Dia novo = internet nova! 📶✨\n` +
                           `Não arranques o dia a zero de MBs 😅\n\n` +
                           `💎 *Ativação rápida • Preço justo • Sem stress*\n\n` +
                           `📋 \`tabela\` — ver pacotes\n` +
                           `💳 \`pagamento\` — como pagar\n` +
                           `━━━━━━━━━━━━━━━━━━━`;

        await sock.sendMessage(jid, { text: abrirTexto }).catch(() => {});
        return;
      }

      if (comando === 'adm on') {
        if (isGroup && !isSenderAdmin) return;
        const admOnTexto = `*📢 ADM ON 📢*\n\n` +
          `* ✅ O grupo está aberto e estamos a atender normalmente.\n` +
          `📌 Para facilitar o atendimento:\n\n` +
          `* 🔹 Digite *tabela* para consultar os preços de megas.\n` +
          `* 🔹 Digite *saldo* para consultar saldo.\n` +
          `* 🔹 Digite *diamantes* para pacotes especiais.\n` +
          `* 🔹 Digite *pagamento* para ver os números.\n\n` +
          `🚨 Atendimento Automático 🤖`;

        await sock.sendMessage(jid, { text: admOnTexto }, { quoted: msg }).catch(() => {});
        return;
      }

      if (comando === 'tabela') {
        const tabelaTexto = `🔥 𝐓𝐀𝐁𝐄𝐋𝐀 𝐃𝐀 𝐕𝐎𝐃𝐀𝐂𝐎𝐌 🔥\n` +
          `📦 Stocks DISPONÍVEIS\n\n` +
          `🔹 5GB ➜ 93MT\n` +
          `🔹 10GB ➜ 178MT\n` +
          `🔹 15GB ➜ 267MT\n` +
          `🔹 20GB ➜ 356MT\n` +
          `🔹 25GB ➜ 445MT\n` +
          `🔹 30GB ➜ 534MT\n` +
          `🔹 40GB ➜ 712MT\n` +
          `🔹 50GB ➜ 890MT\n` +
          `🔹 60GB ➜ 1.068MT\n` +
          `🔹 70GB ➜ 1.246MT\n` +
          `🔹 80GB ➜ 1.424MT\n` +
          `🔹 90GB ➜ 1.602MT\n` +
          `🔹 100GB ➜ 1.780MT\n` +
          `🔹 150GB ➜ 2.670MT\n` +
          `🔹 200GB ➜ 3.560MT\n` +
          `🔹 250GB ➜ 4.450MT\n` +
          `🔹 300GB ➜ 5.340MT\n\n` +
          `💡 *Dica:* Tenha um pacote mensal ativo para acumular a validade!\n\n` +
          `✅ Sistema Seguro\n` +
          `⚡ Entrega Rápida`;

        await sock.sendMessage(jid, { text: tabelaTexto }, { quoted: msg }).catch(() => {});
        return;
      }

      if (comando === 'saldo') {
        const saldoTexto = `🔥 𝐓𝐀𝐁𝐄🇱𝐀 𝐃🇪 𝐒𝐀🇱𝐃𝐎 🔥\n` +
          `📦 𝐒𝐀🇱𝐃𝐎𝐒 𝐃𝐈𝐒𝐏𝐎𝐍Í𝐕𝐄𝐈𝐒\n\n` +
          `🔹 20MT ➜ 18MT\n` +
          `🔹 30MT ➜ 27MT\n` +
          `🔹 50MT ➜ 45MT\n` +
          `🔹 100MT ➜ 85MT\n` +
          `🔹 150MT ➜ 135MT\n` +
          `🔹 200MT ➜ 175MT\n` +
          `🔹 300MT ➜ 255MT\n` +
          `🔹 350MT ➜ 300MT\n` +
          `🔹 400MT ➜ 345MT\n` +
          `🔹 450MT ➜ 385MT\n` +
          `🔹 500MT ➜ 410MT\n` +
          `🔹 600MT ➜ 495MT\n` +
          `🔹 700MT ➜ 580MT\n` +
          `🔹 800MT ➜ 665MT\n` +
          `🔹 900MT ➜ 750MT\n` +
          `🔹 1.000MT ➜ 825MT\n\n` +
          `✅ Sistema Seguro\n` +
          `⚡ Entrega Rápida\n` +
          `📞 Atendimento Garantido`;

        await sock.sendMessage(jid, { text: saldoTexto }, { quoted: msg }).catch(() => {});
        return;
      }

      if (comando === 'diamante' || comando === 'diamantes') {
        const diamanteTexto = `🔥 *PACOTES ESPECIAIS (DIAMANTE)* 🔥\n\n` +
          `🔹 11GB + Chamadas/SMS ➜ 50MT\n` +
          `🔹 12.5GB + Chamadas/SMS ➜ 500MT\n` +
          `🔹 24GB + Chamadas/SMS ➜ 1.050MT`;

        await sock.sendMessage(jid, { text: diamanteTexto }, { quoted: msg }).catch(() => {});
        return;
      }

      if (comando === 'pagamento') {
        const pagamentoTexto = `💳 *FORMAS DE PAGAMENTO:*\n\n` +
          `🪪 *e-Mola*\n📲 870903364\n👤 Tito’s Ernesto Lonzo\n\n` +
          `🪪 *M-Pesa*\n📲 857740432\n👤 Tito’s Ernesto Lonzo\n\n` +
          `📥 *COMO EFETUAR A COMPRA:*\n` +
          `Após realizar o pagamento, envie no grupo:\n` +
          `1. 📩 A mensagem/comprovativo de confirmação\n` +
          `2. 📲 O número beneficiário que vai receber os megas`;

        await sock.sendMessage(jid, { text: pagamentoTexto }, { quoted: msg }).catch(() => {});
        return;
      }

      // 2. MODERAÇÃO (.ban) e ANTI-LINK
      if (isGroup) {
        if (comando.startsWith('.ban')) {
          if (!isSenderAdmin) {
            await sock.sendMessage(jid, { text: '⚠️ Apenas administradores podem usar o comando .ban.' }, { quoted: msg }).catch(() => {});
            return;
          }

          const quotedContext = msg.message.extendedTextMessage?.contextInfo;
          let targetJid = quotedContext?.participant || quotedContext?.mentionedJid?.[0];

          if (!targetJid) {
            await sock.sendMessage(jid, { text: '⚠️ Responda à mensagem da pessoa que deseja banir com .ban.' }, { quoted: msg }).catch(() => {});
            return;
          }

          if (groupAdmins.includes(targetJid)) {
            await sock.sendMessage(jid, { text: '⚠️ Não é possível banir um administrador.' }, { quoted: msg }).catch(() => {});
            return;
          }

          await sock.sendMessage(jid, { text: `🚫 @${targetJid.split('@')[0]} foi removido pelo administrador.`, mentions: [targetJid] }).catch(() => {});
          await sock.groupParticipantsUpdate(jid, [targetJid], 'remove').catch(() => {});
          return;
        }

        const contemLink = /(https?:\/\/[^\s]+)|(chat\.whatsapp\.com\/[^\s]+)|(wa\.me\/[^\s]+)/i.test(textoProcessar);
        if (contemLink && !isSenderAdmin) {
          try {
            await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: false, id: msg.key.id, participant: senderJid } });
            await sock.groupParticipantsUpdate(jid, [senderJid], 'remove');
            await sock.sendMessage(jid, { text: `🚫 @${senderNumero} foi removido por enviar link.`, mentions: [senderJid] });
          } catch (err) {
            console.error('Erro na remoção:', err);
          }
          return;
        }
      }

      // 3. COMPRA DIRETA (.comprar)
      if (comando.startsWith('.comprar')) {
        if (isGroup && !isSenderAdmin) {
          await sock.sendMessage(jid, { text: '⚠️ Apenas administradores podem usar o comando .comprar.' }, { quoted: msg }).catch(() => {});
          return;
        }

        const partes = textoProcessar.split(/\s+/);
        if (partes.length < 3) {
          await sock.sendMessage(jid, { text: '⚠️ Formato incorreto. Use: *.comprar [pacote] [número]*' }, { quoted: msg }).catch(() => {});
          return;
        }

        const pacoteDesejado = partes[1].toUpperCase();
        const numeroDestino = partes[2];

        if (!/^(84|85|86|87)\d{7}$/.test(numeroDestino)) {
          await sock.sendMessage(jid, { text: '⚠️ Número inválido. Deve começar com 84, 85, 86 ou 87 e ter 9 dígitos.' }, { quoted: msg }).catch(() => {});
          return;
        }

        const respostaInicial = await sock.sendMessage(jid, {
          text: `🚀 *PEDIDO DE COMPRA DIRETA INICIADO!*\n\n📊 Pacote: ${pacoteDesejado}\n📱 Número: ${numeroDestino}\n\n⏳ A processar no sistema...`
        }, { quoted: msg }).catch(() => {});

        pedidoPendente = {
          numero: numeroDestino,
          pacote: pacoteDesejado,
          valor: "0",
          referencia: "DIRETO",
          jid: jid,
          messageKey: respostaInicial?.key
        };
        return;
      }

      // 4. RESPOSTA Para Pedido Incompleto (Falta de número)
      const isReply = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
      if (isReply && pedidoPendenteIncompleto) {
        const numeroMatch = textoProcessar.match(/(84|85|86|87)\d{7}/);
        if (numeroMatch) {
          const numeroDestino = numeroMatch[0];
          const dataHoraAtual = new Date().toLocaleString('pt-PT', { timeZone: 'Africa/Maputo' });

          referenciasUtilizadas.set(pedidoPendenteIncompleto.referencia, {
            usuarioJid: senderJid,
            numeroLimpo: senderNumero,
            dataHora: dataHoraAtual
          });

          const respostaInicial = await sock.sendMessage(jid, {
            text: `✅ *PEDIDO RECEBIDO!*\n\n💰 Referência: ${pedidoPendenteIncompleto.referencia}\n📊 Item: ${pedidoPendenteIncompleto.pacote}\n📱 Número: ${numeroDestino}\n💳 Valor: ${pedidoPendenteIncompleto.valor} MT\n\n⏳ A processar pelo sistema...`
          }, { quoted: msg }).catch(() => {});

          pedidoPendente = {
            numero: numeroDestino,
            pacote: pedidoPendenteIncompleto.pacote,
            valor: pedidoPendenteIncompleto.valor,
            referencia: pedidoPendenteIncompleto.referencia,
            jid: jid,
            messageKey: respostaInicial?.key
          };

          pedidoPendenteIncompleto = null;
          return;
        }
      }

      // ==========================================
      // 5. DETEÇÃO AUTOMÁTICA DE COMPROVATIVO (M-Pesa / e-Mola)
      // ==========================================
      const matchValor = textoProcessar.match(/(\d+[\d\.,]*)\s*(MT|Meticais)/i);

      if (matchValor) {
        let val = matchValor[1].replace(/,/g, '');
        let valorLimpo = Math.floor(parseFloat(val)).toString();

        let tipoItem = tabelaPrecos[valorLimpo];

        // Se o valor não constar na tabela, o bot cala-se e não diz nada
        if (!tipoItem) return;

        const matchRef = textoProcessar.match(/\b(PP\d{6}\.\d{4}\.[A-Z0-9]+)\b/i) ||
                         textoProcessar.match(/\b(DI\d+[A-Z0-9]*)\b/i) ||
                         textoProcessar.match(/\b(CO\d{6}\.\d{4}\.[A-Z0-9]+)\b/i) || 
                         textoProcessar.match(/\b(CI\d{6}\.\d{4}\.[A-Z0-9]+)\b/i) ||
                         textoProcessar.match(/Confirmado\s+([A-Z0-9]+)/i);

        let referencia = matchRef ? (matchRef[1] || matchRef[0]) : null;
        if (referencia) {
          referencia = referencia.replace(/^Confirmado\s+/i, '').replace(/[\.\,\;]$/, '').trim();
        }

        if (referencia) {
          if (referenciasUtilizadas.has(referencia)) {
            const dadosUsado = referenciasUtilizadas.get(referencia);
            const mensagemDuplicado = `❌ @${senderNumero}\n` +
              `_________________________\n\n` +
              `🚫 *ID JÁ UTILIZADO*\n` +
              `_________________________\n\n` +
              `🔑 *ID:* ${referencia}\n` +
              `📅 *Usado em:* ${dadosUsado.dataHora}\n` +
              `👤 *Membro:* @${dadosUsado.numeroLimpo}\n\n` +
              `⚠️ *Este comprovativo já foi submetido anteriormente.*`;

            await sock.sendMessage(jid, {
              text: mensagemDuplicado,
              mentions: [senderJid, dadosUsado.usuarioJid]
            }, { quoted: msg }).catch(() => {});
            return;
          }

          const linhas = textoProcessar.split('\n').map(l => l.trim()).filter(l => l.length > 0);
          let numeroDestino = null;

          if (linhas.length > 0) {
            const ultimaLinha = linhas[linhas.length - 1];
            const matchUltima = ultimaLinha.match(/(84|85|86|87)\d{7}/);
            if (matchUltima) {
              numeroDestino = matchUltima[0];
            }
          }

          if (!numeroDestino) {
            const geralMatch = textoProcessar.match(/(84|85|86|87)\d{7}/g);
            if (geralMatch && geralMatch.length > 0) {
              numeroDestino = geralMatch[geralMatch.length - 1];
            }
          }

          if (!numeroDestino) {
            pedidoPendenteIncompleto = {
              pacote: tipoItem,
              valor: valorLimpo,
              referencia: referencia
            };

            await sock.sendMessage(jid, {
              text: `⚠️ @${senderNumero} — *COMPROVATIVO DETETADO, MAS FALTA O NÚMERO!* (Ref: ${referencia})\n\n👉 *Por favor, responda a esta mensagem enviando apenas o número de destino!*`,
              mentions: [senderJid]
            }, { quoted: msg }).catch(() => {});
            return;
          }

          const dataHoraAtual = new Date().toLocaleString('pt-PT', { timeZone: 'Africa/Maputo' });

          referenciasUtilizadas.set(referencia, {
            usuarioJid: senderJid,
            numeroLimpo: senderNumero,
            dataHora: dataHoraAtual
          });

          const respostaInicial = await sock.sendMessage(jid, {
            text: `✅ *PEDIDO RECEBIDO!*\n\n💰 Referência: ${referencia}\n📊 Item: ${tipoItem}\n📱 Número: ${numeroDestino}\n💳 Valor: ${valorLimpo} MT\n\n⏳ O seu pedido já está sendo processado pelo sistema, aguarde...`
          }, { quoted: msg }).catch(() => {});

          pedidoPendente = {
            numero: numeroDestino,
            pacote: tipoItem,
            valor: valorLimpo,
            referencia: referencia,
            jid: jid,
            messageKey: respostaInicial?.key
          };
        }
      }
    } catch (err) {
      console.error('Erro geral ao processar mensagem:', err);
    }
  });
}

connectToWhatsApp();

app.listen(PORT, () => {
  console.log(`Servidor a rodar na porta ${PORT}`);
});
