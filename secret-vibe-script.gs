// =====================================================================
// ZIGTAB — Secret Vibe: Fotos Exclusivas
// Google Apps Script — Backend de verificação e coleta de contatos
//
// COMO USAR:
//   1. Acesse script.google.com e crie um novo projeto
//   2. Cole este código substituindo o conteúdo existente
//   3. Clique em "Implantar" → "Nova implantação"
//   4. Tipo: App da Web
//      - Executar como: Eu (sua conta Google)
//      - Quem pode acessar: Qualquer pessoa
//   5. Copie a URL gerada e cole em secret-vibe-fotos.html (SCRIPT_URL)
// =====================================================================

const CONFIG = {
  SHEET_ID:       '1EVQPC0zhMT4rcinNDQB4kC8cni0Bey2bpAIf9fRl3rw',
  FOLDER_ID:      '1u8jn4caifgbBizTcVRn6dCTDWQpaJG1p',
  GUEST_SHEET:    'LISTA PAGAMENTES',
  CONTACTS_SHEET: 'CONTATOS SECRET VIBE',
  NAME_COLUMN:    'B',   // coluna com os nomes na planilha
  NAME_START_ROW: 2,     // primeira linha de dados (pula o cabeçalho)
  NAME_END_ROW:   300,
  MATCH_THRESHOLD: 0.72, // 0–1: quanto maior, mais exigente a busca
};

// ─────────────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────────────

function doGet(e) {
  const p        = e.parameter;
  const callback = p.callback; // suporte a JSONP
  let result;

  try {
    switch (p.action) {
      case 'verify':
        result = verifyName(p.name);
        break;
      case 'save':
        result = saveContact(p.name, p.phone, p.whatsapp);
        break;
      default:
        result = { error: 'Ação desconhecida.' };
    }
  } catch (err) {
    result = { error: err.message };
  }

  const json = JSON.stringify(result);

  // JSONP — resolve CORS para chamadas de páginas externas
  if (callback) {
    return ContentService
      .createTextOutput(`${callback}(${json})`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────────────────
// VERIFICAÇÃO DE NOME
// ─────────────────────────────────────────────────────────────────────

function verifyName(inputName) {
  if (!inputName || String(inputName).trim().length < 3) {
    return { found: false, reason: 'nome muito curto' };
  }

  const range = `${CONFIG.NAME_COLUMN}${CONFIG.NAME_START_ROW}:${CONFIG.NAME_COLUMN}${CONFIG.NAME_END_ROW}`;
  const values = SpreadsheetApp
    .openById(CONFIG.SHEET_ID)
    .getSheetByName(CONFIG.GUEST_SHEET)
    .getRange(range)
    .getValues()
    .flat()
    .filter(v => v && String(v).trim().length > 0);

  let best = { name: null, score: 0 };

  for (const guestName of values) {
    const score = nameSimilarity(String(guestName), inputName);
    if (score > best.score) {
      best = { name: guestName, score };
    }
  }

  if (best.score >= CONFIG.MATCH_THRESHOLD) {
    return { found: true, name: best.name };
  }

  return { found: false };
}

// ─────────────────────────────────────────────────────────────────────
// SALVAR CONTATO + RETORNAR FOTOS
// ─────────────────────────────────────────────────────────────────────

function saveContact(name, phone, whatsapp) {
  const ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  let sheet   = ss.getSheetByName(CONFIG.CONTACTS_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.CONTACTS_SHEET);
    const header = sheet.getRange('A1:D1');
    header.setValues([['Nome', 'WhatsApp', 'E-mail', 'Acessou em']]);
    header.setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  sheet.appendRow([
    name     || '',
    phone    || '',
    whatsapp || '',
    new Date(),
  ]);

  // Lista todas as imagens da pasta do Drive
  const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const files  = folder.getFiles();
  const photos = [];

  while (files.hasNext()) {
    const file = files.next();
    if (file.getMimeType().startsWith('image/')) {
      photos.push(file.getId());
    }
  }

  return { success: true, photos };
}

// ─────────────────────────────────────────────────────────────────────
// ALGORITMO DE SIMILARIDADE DE NOMES
// ─────────────────────────────────────────────────────────────────────

function normalize(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/\s+/g, ' ')
    .trim();
}

function nameSimilarity(guestName, inputName) {
  const g = normalize(guestName);
  const q = normalize(inputName);

  // Correspondência exata
  if (g === q) return 1.0;

  // Um contém o outro (busca parcial)
  if (g.includes(q) || q.includes(g)) return 0.95;

  const gParts = g.split(' ');
  const qParts = q.split(' ');

  // Primeiro nome igual + último nome igual
  if (gParts[0] === qParts[0] && gParts[gParts.length - 1] === qParts[qParts.length - 1]) {
    return 0.90;
  }

  // Apenas primeiro nome igual
  if (gParts[0] === qParts[0]) return 0.76;

  // Distância de Levenshtein normalizada
  const dist   = levenshtein(g, q);
  const maxLen = Math.max(g.length, q.length);
  return 1 - dist / maxLen;
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;

  // Inicializa matriz
  const dp = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = new Array(n + 1).fill(0);
    dp[i][0] = i;
  }
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}
