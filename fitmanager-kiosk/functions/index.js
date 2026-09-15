const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// This Firebase project is shared with another system — every FitManager
// collection is prefixed so these functions can never touch that system's
// data. Set FIRESTORE_PREFIX in functions/.env (must match the kiosk's and
// the admin panel's prefix). Defaults to "fitmanager_" if unset.
const PREFIX = process.env.FIRESTORE_PREFIX || "fitmanager_";
const COL = {
  alunos: `${PREFIX}alunos`,
  checkins: `${PREFIX}checkins`,
  notificacoesPendentes: `${PREFIX}notificacoesPendentes`,
  logsAuditoria: `${PREFIX}logsAuditoria`,
};

/**
 * Fires whenever the kiosk records a checkin. The admin panel's "Últimos
 * check-ins" widget listens to the checkins collection directly via a
 * realtime Firestore listener — this trigger just mirrors the event into
 * the audit log, which is the one place the schema already tracks
 * "who did what, when" (see logsAuditoria in fitmanager-kiosk/README.md).
 */
exports.onCheckinCreated = onDocumentCreated(`${COL.checkins}/{checkinId}`, async (event) => {
  const checkin = event.data?.data();
  if (!checkin) return;

  console.log(`[functions] novo checkin: ${checkin.nomeAluno} (${checkin.status})`);

  await db.collection(COL.logsAuditoria).add({
    usuarioId: null, // evento do kiosk, não de um usuário logado no painel
    acao: "checkin_reconhecimento_facial",
    alvoId: checkin.alunoId,
    detalhes: `${checkin.status === "liberado" ? "Acesso liberado" : "Acesso negado"} — ${checkin.nomeAluno} (${checkin.dispositivoId})`,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
});

/**
 * Daily sweep for students whose plan expires within 5 days. Queues an
 * entry in notificacoesPendentes for each one — the actual WhatsApp send
 * (via the Evolution API instance configured in the admin panel's
 * Configurações > Notificações / WhatsApp) is a separate dispatcher to wire
 * up once those credentials exist; this function only decides WHO to notify.
 * Once sent, the dispatcher should log the result in `${PREFIX}notificacoes`
 * (see the schema doc), not here.
 */
exports.checkVencimentos = onSchedule("every day 08:00", async () => {
  const in5Days = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const snapshot = await db
    .collection(COL.alunos)
    .where("status", "==", "ativo")
    .where("dataVencimento", "<=", in5Days)
    .get();

  console.log(`[functions] ${snapshot.size} aluno(s) com plano vencendo nos próximos 5 dias`);

  const batch = db.batch();
  snapshot.forEach((doc) => {
    const data = doc.data();
    batch.set(db.collection(COL.notificacoesPendentes).doc(), {
      tipo: "aviso_vencimento",
      alunoId: doc.id,
      nomeAluno: data.nome,
      whatsapp: data.whatsapp,
      dataVencimento: data.dataVencimento,
      criadoEm: admin.firestore.FieldValue.serverTimestamp(),
      statusEnvio: "pendente",
    });
  });
  await batch.commit();
});

/**
 * Callable from the admin panel to force-regenerate a student's embedding
 * (e.g. after replacing their photo, or if the automatic trigger below
 * failed for some reason).
 */
exports.regenerateEmbedding = onCall(async (request) => {
  const alunoId = request.data?.alunoId;
  if (!alunoId) throw new HttpsError("invalid-argument", "alunoId é obrigatório");

  const alunoRef = db.collection(COL.alunos).doc(alunoId);
  const alunoSnap = await alunoRef.get();
  if (!alunoSnap.exists) throw new HttpsError("not-found", "Aluno não encontrado");

  const { fotoUrl } = alunoSnap.data();
  if (!fotoUrl) throw new HttpsError("failed-precondition", "Aluno não tem foto cadastrada");

  const { generateEmbeddingFromPhoto } = require("./face-embedding");
  const embedding = await generateEmbeddingFromPhoto(fotoUrl);
  await alunoRef.update({ faceEmbedding: embedding, faceEmbeddingVersion: "face-api-v1" });

  return { ok: true, embeddingLength: embedding.length };
});

/**
 * Auto-generates the embedding whenever a student's photo is set/changed
 * and no embedding exists yet — the automatic step described in the
 * cadastro flow, so the admin never has to trigger it by hand.
 */
exports.onAlunoWritten = onDocumentWritten(`${COL.alunos}/{alunoId}`, async (event) => {
  const after = event.data?.after?.data();
  if (!after?.fotoUrl || after.faceEmbedding) return;

  try {
    const { generateEmbeddingFromPhoto } = require("./face-embedding");
    const embedding = await generateEmbeddingFromPhoto(after.fotoUrl);
    await event.data.after.ref.update({ faceEmbedding: embedding, faceEmbeddingVersion: "face-api-v1" });
    console.log(`[functions] embedding gerado automaticamente para ${event.params.alunoId}`);
  } catch (err) {
    console.error(`[functions] falha ao gerar embedding para ${event.params.alunoId}:`, err.message);
  }
});
