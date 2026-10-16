const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 10000;
const GRUPO_PERMITIDO = '120363398379819803@g.us';

let pedidoPendente = null;
let pedidoPendenteIncompleto = null;
let sock = null;
const referenciasUtilizadas = new Map();

// TABELA ATUALIZADA - BASEADA NA TUA LISTA DE HOJE
const tabelaPrecos = {
  "10": "512MB", "15": "750MB", "20": "1024MB", "25": "1262MB", "30": "1536MB",
  "35": "1774MB", "40": "2048MB", "45": "2286MB", "50": "2560MB", "55": "2798MB",
  "60": "3072MB", "65": "3310MB", "70": "3584MB", "75": "3822MB", "80": "4096MB",
  "85": "4334MB", "90": "4608MB", "100": "5120MB", "120": "6144MB", "140": "7168MB",
  "160": "8200MB", "180": "9216MB", "200": "10240MB",
  "28": "857MB SEMANAL", "46": "1741MB SEMANAL", "82": "2970MB SEMANAL", "93": "3482MB SEMANAL", "143": "5325MB SEMANAL", "185": "7270MB SEMANAL",
  "95": "2.8GB MENSAL", "155": "5929MB MENSAL", "175": "6953MB MENSAL", "195": "7977MB MENSAL", "255": "11049MB MENSAL", "295": "13097MB MENSAL",
  "450": "11GB DIAMANTE", "510": "15GB DIAMANTE", "650": "21GB DIAMANTE", "830": "30GB DIAMANTE", "1230": "50GB DIAMANTE"
};

function obterJidReal(msg) {
  let sender = msg.key.participant || msg.key.remoteJid;
  if (sender.includes(':')) sender = sender.split(':')[0] + '@s.whatsapp.net';
  return sender;
}

app.get('/', (req, res) => res.send('✅ Bot do WhatsApp ativo!'));
app.get('/api/obter-pendentes', (req, res) => {
  if (pedidoPendente) return res.json({ temPedido: true, megas: pedidoPendente.pacote, pacote: pedidoPendente.pacote, numero: pedidoPendente.numero, valor: pedidoPendente.valor || "0", referencia: pedidoPendente.referencia || "DIRETO" });
  return res.json({ temPedido: false });
});
app.post('/api/confirmar', async (req, res) => {
  if (!pedidoPendente) return res.status(400).json({ sucesso: false, mensagem: "Nenhum pedido pendente" });
  try {
    if (sock && pedidoPendente.jid && pedidoPendente.messageKey) {
      await sock.sendMessage(pedidoPendente.jid, { text: `✅ *ENVIO CONCLUÍDO!*\n\n📊 Pacote: ${pedidoPendente.pacote}\n📱 Número: ${pedidoPendente.numero}\n\n🚀 Processado!`, edit: pedidoPendente.messageKey });
    }
    pedidoPendente = null;
    return res.json({ sucesso: true });
  } catch (error) { return res.status(500).json({ sucesso: false, erro: error.message }); }
});

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({ version, logger: pino({ level: 'silent' }), auth: state, printQRInTerminal: false, browser: ["Ubuntu", "Chrome", "20.0.04"] });
  sock.ev.on('creds.update', saveCreds);
  if (!sock.authState.creds.registered) {
    const phoneNumber = "258841066314";
    setTimeout(async () => {
      try { const code = await sock.requestPairingCode(phoneNumber); console.log(`\n🔑 CÓDIGO: ${code}\n`); } catch (err) { console.error(err); }
    }, 3000);
  }
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error?.output?.statusCode!== DisconnectReason.loggedOut);
      if (shouldReconnect) connectToWhatsApp();
    } else if (connection === 'open') console.log('✅ Bot conectado!');
  });

  sock.ev.on('messages.upsert', async (m) => {
    try {
      const msg = m.messages[0];
      if (!msg ||!msg.message || msg.key.fromMe) return;
      const jid = msg.key.remoteJid;
      const isGroup = jid.endsWith('@g.us');
      if (isGroup && jid!== GRUPO_PERMITIDO) return;
      const senderJid = obterJidReal(msg);
      const senderNumero = senderJid.split('@')[0];
      const textoProcessar = (msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || "").trim();
      if (!textoProcessar) return;
      const comando = textoProcessar.toLowerCase();

      let isSenderAdmin = false; let groupAdmins = [];
      if (isGroup) {
        const meta = await sock.groupMetadata(jid).catch(() => null);
        if (meta) { groupAdmins = meta.participants.filter(p => p.admin!== null).map(p => p.id); isSenderAdmin = groupAdmins.includes(senderJid); }
      }

      if (comando === 'id') { await sock.sendMessage(jid, { text: `🔑 ID: \`${jid}\`` }, { quoted: msg }); return; }
      if (comando === '.link') {
        if (isGroup &&!isSenderAdmin) return;
        try { await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: false, id: msg.key.id, participant: senderJid } }); } catch (e) {}
        await sock.sendMessage(jid, { text: `🔗 LINK DO GRUPO\n\nhttps://chat.whatsapp.com/EtV0CHusTxK0Uz41bV2X5h` }); return;
      }
      if (comando === '.fechar') {
        if (isGroup &&!isSenderAdmin) return;
        try { await sock.groupSettingUpdate(jid, 'announcement'); } catch (e) {}
        await sock.sendMessage(jid, { text: `🔒 GRUPO FECHADO\n\nPara urgências fale com um ADM` }); return;
      }
      if (comando === '.abrir') {
        if (isGroup &&!isSenderAdmin) return;
        try { await sock.groupSettingUpdate(jid, 'not_announcement'); } catch (e) {}
        await sock.sendMessage(jid, { text: `🌅 BOM DIA, FAMÍLIA! ☀️\n\nDia novo = internet nova! 📶\n\n📋 tabela — ver pacotes\n💳 pagamento — como pagar` }); return;
      }
      if (comando === 'adm on') {
        if (isGroup &&!isSenderAdmin) return;
        await sock.sendMessage(jid, { text: `📢 ADM ON 📢\n\n✅ Grupo aberto\n🔹 tabela = preços megas\n🔹 saldo = semanal\n🔹 diamantes = especiais\n🔹 pagamento = números` }, { quoted: msg }); return;
      }
      if (comando === 'tabela') {
        const tabelaTexto = `🔥 TABELA DA VODACOM 🔥\nDISPONÍVEIS\n\n512MB ➜ 10MT\n750MB ➜ 15MT\n1024MB ➜ 20MT\n1262MB ➜ 25MT\n1536MB ➜ 30MT\n1774MB ➜ 35MT\n2048MB ➜ 40MT\n2286MB ➜ 45MT\n2560MB ➜ 50MT\n2798MB ➜ 55MT\n3072MB ➜ 60MT\n3310MB ➜ 65MT\n3584MB ➜ 70MT\n3822MB ➜ 75MT\n4096MB ➜ 80MT\n4334MB ➜ 85MT\n4608MB ➜ 90MT\n5120MB ➜ 100MT\n6144MB ➜ 120MT\n10240MB ➜ 200MT\n\n💡 Tenha pacote mensal ativo!\n✅ Sistema Seguro`;
        await sock.sendMessage(jid, { text: tabelaTexto }, { quoted: msg }); return;
      }
      if (comando === 'saldo') {
        const saldoTexto = `🔥 TABELA SEMANAL 🔥\nSALDOS DISPONÍVEIS\n\n857MB ➜ 28MT\n1741MB ➜ 46MT\n2970MB ➜ 82MT\n3482MB ➜ 93MT\n5325MB ➜ 143MT\n7270MB ➜ 185MT`;
        await sock.sendMessage(jid, { text: saldoTexto }, { quoted: msg }); return;
      }
      if (comando === 'diamante' || comando === 'diamantes') {
        await sock.sendMessage(jid, { text: `🔥 PACOTES DIAMANTE 🔥\n\n11GB + Chamadas/SMS ➜ 450MT\n15GB ➜ 510MT\n21GB ➜ 650MT\n30GB ➜ 830MT\n50GB ➜ 1230MT\n\nVálido só Vodacom` }, { quoted: msg }); return;
      }
      if (comando === 'pagamento') {
        await sock.sendMessage(jid, { text: `💳 PAGAMENTO:\n\ne-Mola 877114280\nM-Pesa 856150578\nNome: Fenias Eduardo Pedro\n\nEnvie comprovativo em TEXTO + número destino` }, { quoted: msg }); return;
      }

      if (isGroup && comando.startsWith('.ban')) {
        if (!isSenderAdmin) return;
        const ctx = msg.message.extendedTextMessage?.contextInfo;
        let targetJid = ctx?.participant || ctx?.mentionedJid?.[0];
        if (!targetJid) { await sock.sendMessage(jid, { text: '⚠️ Responda a mensagem de quem quer banir com.ban' }, { quoted: msg }); return; }
        if (groupAdmins.includes(targetJid)) { await sock.sendMessage(jid, { text: '⚠️ Não pode banir ADM' }, { quoted: msg }); return; }
        await sock.sendMessage(jid, { text: `🚫 @${targetJid.split('@')[0]} removido`, mentions: [targetJid] });
        await sock.groupParticipantsUpdate(jid, [targetJid], 'remove').catch(() => {}); return;
      }

      if (isGroup) {
        const contemLink = /(https?:\/\/[^\s]+)|(chat\.whatsapp\.com\/[^\s]+)|(wa\.me\/[^\s]+)/i.test(textoProcessar);
        if (contemLink &&!isSenderAdmin) {
          try {
            await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: false, id: msg.key.id, participant: senderJid } });
            await sock.groupParticipantsUpdate(jid, [senderJid], 'remove');
            await sock.sendMessage(jid, { text: `🚫 @${senderNumero} removido por link`, mentions: [senderJid] });
          } catch (err) {}
          return;
        }
      }

      if (comando.startsWith('.comprar')) {
        if (isGroup &&!isSenderAdmin) return;
        const partes = textoProcessar.split(/\s+/);
        if (partes.length < 3) { await sock.sendMessage(jid, { text: 'Use:.comprar [pacote] [número]' }, { quoted: msg }); return; }
        const pacoteDesejado = partes[1].toUpperCase(); const numeroDestino = partes[2];
        if (!/^(84|85|86|87)\d{7}$/.test(numeroDestino)) { await sock.sendMessage(jid, { text: 'Número inválido' }, { quoted: msg }); return; }
        const resp = await sock.sendMessage(jid, { text: `🚀 PEDIDO DIRETO\nPacote: ${pacoteDesejado}\nNúmero: ${numeroDestino}\n⏳ Processando...` }, { quoted: msg }).catch(() => {});
        pedidoPendente = { numero: numeroDestino, pacote: pacoteDesejado, valor: "0", referencia: "DIRETO", jid, messageKey: resp?.key }; return;
      }

      const isReply = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
      if (isReply && pedidoPendenteIncompleto) {
        const numeroMatch = textoProcessar.match(/(84|85|86|87)\d{7}/);
        if (numeroMatch) {
          const numeroDestino = numeroMatch[0];
          const dataHoraAtual = new Date().toLocaleString('pt-PT', { timeZone: 'Africa/Maputo' });
          referenciasUtilizadas.set(pedidoPendenteIncompleto.referencia, { usuarioJid: senderJid, numeroLimpo: senderNumero, dataHora: dataHoraAtual });
          const resp = await sock.sendMessage(jid, { text: `✅ PEDIDO RECEBIDO!\nRef: ${pedidoPendenteIncompleto.referencia}\nItem: ${pedidoPendenteIncompleto.pacote}\nNúmero: ${numeroDestino}\nValor: ${pedidoPendenteIncompleto.valor} MT` }, { quoted: msg }).catch(() => {});
          pedidoPendente = { numero: numeroDestino, pacote: pedidoPendenteIncompleto.pacote, valor: pedidoPendenteIncompleto.valor, referencia: pedidoPendenteIncompleto.referencia, jid, messageKey: resp?.key };
          pedidoPendenteIncompleto = null; return;
        }
      }

      const matchValor = textoProcessar.match(/(\d+[\d\.,]*)\s*(MT|Meticais)/i);
      if (matchValor) {
        let val = matchValor[1].replace(/,/g, ''); let valorLimpo = Math.floor(parseFloat(val)).toString();
        let tipoItem = tabelaPrecos[valorLimpo]; if (!tipoItem) return;
        const matchRef = textoProcessar.match(/\b(PP\d{6}\.\d{4}\.[A-Z0-9]+)\b/i) || textoProcessar.match(/\b(DI\d+[A-Z0-9]*)\b/i) || textoProcessar.match(/\b(CO\d{6}\.\d{4}\.[A-Z0-9]+)\b/i) || textoProcessar.match(/\b(CI\d{6}\.\d{4}\.[A-Z0-9]+)\b/i) || textoProcessar.match(/Confirmado\s+([A-Z0-9]+)/i);
        let referencia = matchRef? (matchRef[1] || matchRef[0]) : null;
        if (referencia) referencia = referencia.replace(/^Confirmado\s+/i, '').replace(/[\.\,\;]$/, '').trim();
        if (referencia) {
          if (referenciasUtilizadas.has(referencia)) {
            const dados = referenciasUtilizadas.get(referencia);
            await sock.sendMessage(jid, { text: `❌ @${senderNumero} ID JÁ USADO: ${referencia}\nUsado em: ${dados.dataHora} por @${dados.numeroLimpo}`, mentions: [senderJid, dados.usuarioJid] }, { quoted: msg }); return;
          }
          let numeroDestino = null;
          const linhas = textoProcessar.split('\n').map(l => l.trim()).filter(l => l.length > 0);
          if (linhas.length > 0) { const m = linhas[linhas.length - 1].match(/(84|85|86|87)\d{7}/); if (m) numeroDestino = m[0]; }
          if (!numeroDestino) { const g = textoProcessar.match(/(84|85|86|87)\d{7}/g); if (g) numeroDestino = g[g.length - 1]; }
          if (!numeroDestino) {
            pedidoPendenteIncompleto = { pacote: tipoItem, valor: valorLimpo, referencia };
            await sock.sendMessage(jid, { text: `⚠️ @${senderNumero} COMPROVATIVO OK MAS FALTA NÚMERO! (Ref: ${referencia})\nResponda com o número`, mentions: [senderJid] }, { quoted: msg }); return;
          }
          const dataHoraAtual = new Date().toLocaleString('pt-PT', { timeZone: 'Africa/Maputo' });
          referenciasUtilizadas.set(referencia, { usuarioJid: senderJid, numeroLimpo: senderNumero, dataHora: dataHoraAtual });
          const resp = await sock.sendMessage(jid, { text: `✅ PEDIDO RECEBIDO!\nRef: ${referencia}\nItem: ${tipoItem}\nNúmero: ${numeroDestino}\nValor: ${valorLimpo} MT\n⏳ Processando...` }, { quoted: msg }).catch(() => {});
          pedidoPendente = { numero: numeroDestino, pacote: tipoItem, valor: valorLimpo, referencia, jid, messageKey: resp?.key };
        }
      }
    } catch (err) { console.error('Erro:', err); }
  });
}
connectToWhatsApp();
app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
