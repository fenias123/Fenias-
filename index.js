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

app.get('/', (req, res) => res.send('✅ Bot ativo!'));
app.get('/api/obter-pendentes', (req, res) => {
  if (pedidoPendente) return res.json({ temPedido: true, megas: pedidoPendente.pacote, pacote: pedidoPendente.pacote, numero: pedidoPendente.numero, valor: pedidoPendente.valor || "0", referencia: pedidoPendente.referencia || "DIRETO" });
  return res.json({ temPedido: false });
});
app.post('/api/confirmar', async (req, res) => {
  if (!pedidoPendente) return res.status(400).json({ sucesso: false });
  try {
    if (sock && pedidoPendente.jid && pedidoPendente.messageKey) {
      await sock.sendMessage(pedidoPendente.jid, { text: `✅ CONCLUÍDO\n\nPacote: ${pedidoPendente.pacote}\nNúmero: ${pedidoPendente.numero}`, edit: pedidoPendente.messageKey });
    }
    pedidoPendente = null;
    return res.json({ sucesso: true });
  } catch (e) { return res.status(500).json({ sucesso: false }); }
});

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({ version, logger: pino({ level: 'silent' }), auth: state, browser: ["Ubuntu", "Chrome", "20.0.04"] });
  sock.ev.on('creds.update', saveCreds);
  if (!sock.authState.creds.registered) {
    setTimeout(async () => { try { const code = await sock.requestPairingCode("258841066314"); console.log(`\n🔑 CÓDIGO: ${code}\n`); } catch (err) {} }, 3000);
  }
  sock.ev.on('connection.update', (u) => {
    if (u.connection === 'close' && u.lastDisconnect?.error?.output?.statusCode!== DisconnectReason.loggedOut) connectToWhatsApp();
    if (u.connection === 'open') console.log('✅ Conectado!');
  });

  // ===== BOAS-VINDAS COM FOTO DE PERFIL =====
  sock.ev.on('group-participants.update', async (update) => {
    try {
      const { id, participants, action } = update;
      if (id!== GRUPO_PERMITIDO) return;
      if (action!== 'add') return;
      for (const participant of participants) {
        const numero = participant.split('@')[0];
        let ppUrl = null;
        try { ppUrl = await sock.profilePictureUrl(participant, 'image'); } catch (e) { ppUrl = null; }
        const mensagem = `👋 BEM-VINDO @${numero}!\n\n📶 Aqui vendemos MEGAS Vodacom baratos\n\nDigite:\n*tabela* - ver preços diários\n*semanal* - 7 dias\n*mensal* - 30 dias\n*diamante* - ilimitado\n*pagamento* - como pagar\n\n⚠️ Leia as regras no grupo!`;
        if (ppUrl) {
          await sock.sendMessage(id, { image: { url: ppUrl }, caption: mensagem, mentions: [participant] });
        } else {
          await sock.sendMessage(id, { text: mensagem, mentions: [participant] });
        }
      }
    } catch (e) { console.log('Erro boas-vindas:', e); }
  });

  // ===== PROTEGE FOTO E NOME DO GRUPO =====
  sock.ev.on('groups.update', async (updates) => {
    try {
      for (const update of updates) {
        if (update.id!== GRUPO_PERMITIDO) continue;
        if (update.subject || update.desc) {
          console.log(`Grupo alterado: ${update.subject || update.desc}`);
          // Se quiser, pode avisar que só ADM pode mudar
          // await sock.sendMessage(update.id, { text: `⚠️ Perfil do grupo só pode ser alterado por ADMs` });
        }
      }
    } catch (e) {}
  });

  sock.ev.on('messages.upsert', async (m) => {
    try {
      const msg = m.messages[0];
      if (!msg ||!msg.message || msg.key.fromMe) return;
      const jid = msg.key.remoteJid;
      if (jid.endsWith('@g.us') && jid!== GRUPO_PERMITIDO) return;
      const senderJid = obterJidReal(msg);
      const senderNumero = senderJid.split('@')[0];
      const textoProcessar = (msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.groupStatusMentionMessage?.message?.protocolMessage?.key?.id || "").trim();
      let textoReal = (msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || "").trim();
      if (!textoReal && msg.message.groupStatusMentionMessage) textoReal = "STATUS_MENCIONADO";
      if (!textoReal) return;
      const comando = textoReal.toLowerCase();

      let isSenderAdmin = false; let groupAdmins = [];
      if (jid.endsWith('@g.us')) {
        const meta = await sock.groupMetadata(jid).catch(() => null);
        if (meta) { groupAdmins = meta.participants.filter(p => p.admin!== null).map(p => p.id); isSenderAdmin = groupAdmins.includes(senderJid); }
      }

      if (comando === 'id') { await sock.sendMessage(jid, { text: `ID: ${jid}` }, { quoted: msg }); return; }
      if (comando === 'adm on' || comando === 'adm') {
        await sock.sendMessage(jid, { text: `✅ ESTAMOS ONLINE\n\nDigite:\ntabela - diários\nsemanal - 7 dias\nmensal - 30 dias\ndiamante - ilimitado\npagamento - como pagar` }, { quoted: msg }); return;
      }
      if (/(pe[cç]o|pesso|preciso|quero|kero|manda)\s*(megas?|mbs?|mega|internet|saldo)/i.test(comando) || (['megas','mega','mb','mbs','saldo'].includes(comando) && textoReal.length < 20)) {
        await sock.sendMessage(jid, { text: `💳 PAGAMENTO\n\nM-Pesa: 856150578\nE-Mola: 877114280\nNome: Fenias Eduardo Pedro\n\nEnvia:\n1. Comprovativo em TEXTO\n2. Número que recebe` }, { quoted: msg }); return;
      }
      if (comando === 'tabela') {
        await sock.sendMessage(jid, { text: `📶 DIÁRIOS - VODACOM\n\n10MT = 512MB\n15MT = 750MB\n20MT = 1GB\n25MT = 1262MB\n30MT = 1536MB\n35MT = 1774MB\n40MT = 2GB\n45MT = 2286MB\n50MT = 2560MB\n55MT = 2798MB\n60MT = 3GB\n65MT = 3310MB\n70MT = 3584MB\n75MT = 3822MB\n80MT = 4GB\n85MT = 4334MB\n90MT = 4608MB\n100MT = 5GB\n120MT = 6144MB\n140MT = 7168MB\n160MT = 8200MB\n180MT = 9216MB\n200MT = 10240MB\n\nOutros: semanal | mensal | diamante` }, { quoted: msg }); return;
      }
      if (comando === 'semanal') {
        await sock.sendMessage(jid, { text: `📅 SEMANAL - 7 DIAS\n\n28MT = 857MB\n46MT = 1741MB\n82MT = 2970MB\n93MT = 3482MB\n143MT = 5325MB\n185MT = 7270MB\n\nSem Txuna crédito` }, { quoted: msg }); return;
      }
      if (comando === 'mensal') {
        await sock.sendMessage(jid, { text: `📅 MENSAL - 30 DIAS\n\n95MT = 2.8GB\n155MT = 5929MB\n175MT = 6953MB\n195MT = 7977MB\n255MT = 11049MB\n295MT = 13097MB\n\nSó Vodacom. Sem Txuna` }, { quoted: msg }); return;
      }
      if (comando === 'diamante' || comando === 'diamantes') {
        await sock.sendMessage(jid, { text: `💎 DIAMANTE - 30 DIAS\nChamadas + SMS ilimitadas\n\n450MT = 11GB\n510MT = 15GB\n650MT = 21GB\n830MT = 30GB\n1230MT = 50GB` }, { quoted: msg }); return;
      }
      if (comando === 'pagamento') {
        await sock.sendMessage(jid, { text: `💳 PAGAMENTO\n\nM-Pesa: 856150578\nE-Mola: 877114280\nNome: Fenias Eduardo Pedro` }, { quoted: msg }); return;
      }
      if (comando === '.link') {
        if (jid.endsWith('@g.us') &&!isSenderAdmin) return;
        try { await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: false, id: msg.key.id, participant: senderJid } }); } catch (e) {}
        await sock.sendMessage(jid, { text: `LINK DO GRUPO\nhttps://chat.whatsapp.com/EtV0CHusTxK0Uz41bV2X5h` }); return;
      }
      if (comando === '.fechar') {
        if (jid.endsWith('@g.us') &&!isSenderAdmin) return;
        try { await sock.groupSettingUpdate(jid, 'announcement'); } catch (e) {}
        await sock.sendMessage(jid, { text: `🔒 GRUPO FECHADO` }); return;
      }
      if (comando === '.abrir') {
        if (jid.endsWith('@g.us') &&!isSenderAdmin) return;
        try { await sock.groupSettingUpdate(jid, 'not_announcement'); } catch (e) {}
        await sock.sendMessage(jid, { text: `✅ GRUPO ABERTO\n\nDigite tabela` }); return;
      }
      if (jid.endsWith('@g.us') && comando.startsWith('.ban')) {
        if (!isSenderAdmin) return;
        const ctx = msg.message.extendedTextMessage?.contextInfo;
        let targetJid = ctx?.participant || ctx?.mentionedJid?.[0];
        if (!targetJid) return;
        if (groupAdmins.includes(targetJid)) return;
        await sock.groupParticipantsUpdate(jid, [targetJid], 'remove').catch(() => {}); return;
      }

      // ===== BANIR LINK + APAGAR STATUS NO PERFIL DO GRUPO =====
      if (jid.endsWith('@g.us') &&!isSenderAdmin) {
        const isStatusNoGrupo = msg.message.groupStatusMentionMessage || msg.message.groupStatusMentionedJid || textoReal === "STATUS_MENCIONADO";
        const contemLink = /(https?:\/\/|chat\.whatsapp\.com|wa\.me|www\.)/i.test(textoReal);
        if (contemLink) {
          try {
            await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: false, id: msg.key.id, participant: senderJid } });
            await sock.groupParticipantsUpdate(jid, [senderJid], 'remove');
            await sock.sendMessage(jid, { text: `🚫 @${senderNumero} removido por enviar link.`, mentions: [senderJid] });
          } catch (e) {}
          return;
        }
        if (isStatusNoGrupo) {
          try {
            await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: false, id: msg.key.id, participant: senderJid } });
            await sock.sendMessage(jid, { text: `⚠️ Status no perfil do grupo apagado @${senderNumero}`, mentions: [senderJid] });
          } catch (e) {}
          return;
        }
      }

      const matchValor = textoReal.match(/(\d+[\d\.,]*)\s*(MT|Meticais)/i);
      if (matchValor) {
        let val = matchValor[1].replace(/,/g, ''); let valorLimpo = Math.floor(parseFloat(val)).toString();
        let tipoItem = tabelaPrecos[valorLimpo]; if (!tipoItem) return;
        const matchRef = textoReal.match(/\b(PP\d{6}\.\d{4}\.[A-Z0-9]+)\b/i) || textoReal.match(/\b(DI\d+[A-Z0-9]*)\b/i) || textoReal.match(/\b(CO\d{6}\.\d{4}\.[A-Z0-9]+)\b/i) || textoReal.match(/\b(CI\d{6}\.\d{4}\.[A-Z0-9]+)\b/i) || textoReal.match(/Confirmado\s+([A-Z0-9]+)/i);
        let referencia = matchRef? (matchRef[1] || matchRef[0]) : null;
        if (referencia) referencia = referencia.replace(/^Confirmado\s+/i, '').replace(/[\.\,\;]$/, '').trim();
        if (referencia) {
          if (referenciasUtilizadas.has(referencia)) {
            await sock.sendMessage(jid, { text: `❌ ID JÁ USADO: ${referencia}`, mentions: [senderJid] }, { quoted: msg }); return;
          }
          let numeroDestino = null;
          const geral = textoReal.match(/(84|85|86|87)\d{7}/g);
          if (geral) numeroDestino = geral[geral.length - 1];
          if (!numeroDestino) {
            pedidoPendenteIncompleto = { pacote: tipoItem, valor: valorLimpo, referencia };
            await sock.sendMessage(jid, { text: `⚠️ Recebido: ${referencia} - ${tipoItem}\nFalta o número.`, mentions: [senderJid] }, { quoted: msg }); return;
          }
          const dataHoraAtual = new Date().toLocaleString('pt-PT', { timeZone: 'Africa/Maputo' });
          referenciasUtilizadas.set(referencia, { usuarioJid: senderJid, numeroLimpo: senderNumero, dataHora: dataHoraAtual });
          const resp = await sock.sendMessage(jid, { text: `✅ RECEBIDO\n\nRef: ${referencia}\nPacote: ${tipoItem}\nNúmero: ${numeroDestino}\nValor: ${valorLimpo}MT\n\nA processar...` }, { quoted: msg }).catch(() => {});
          pedidoPendente = { numero: numeroDestino, pacote: tipoItem, valor: valorLimpo, referencia, jid, messageKey: resp?.key };
        }
      }
    } catch (err) { console.error(err); }
  });
}
connectToWhatsApp();
app.listen(PORT, () => console.log(`Rodando na ${PORT}`));
