#!/usr/bin/env node
/**
 * Migração para o isolamento por academia.
 *
 * Antes, nenhum documento do FitManager dizia a qual academia pertencia, e
 * todas as academias enxergavam os dados umas das outras. Agora todo
 * documento tem academiaId e as regras do Firestore escondem o que não é da
 * academia do usuário — então os dados antigos (sem academiaId) ficam
 * invisíveis até serem atribuídos a uma academia por este script.
 *
 * Uso (na pasta fitmanager-kiosk, com o mesmo .env / service account do quiosque):
 *
 *   node scripts/migrar-academias.js
 *       Simulação: lista as academias/administradores e quantos documentos
 *       estão sem academia. Não grava nada.
 *
 *   node scripts/migrar-academias.js --aplicar
 *       Cria uma academia para cada administrador antigo que ainda não tem
 *       (a partir do nome que ele informou no cadastro) e vincula-o a ela.
 *
 *   node scripts/migrar-academias.js --academia <id-ou-email-do-admin> --aplicar
 *       Faz o passo acima e atribui TODOS os documentos sem academia à
 *       academia indicada (pelo id ou pelo e-mail do administrador dela).
 *       Rode sem --aplicar primeiro para conferir os números.
 */
const path = require("path");
try {
  require("dotenv").config({ path: path.join(__dirname, "../.env") });
} catch {
  /* dotenv é opcional */
}
const admin = require("firebase-admin");

const args = process.argv.slice(2);
const APLICAR = args.includes("--aplicar");
const alvoArg = args.includes("--academia") ? args[args.indexOf("--academia") + 1] : null;

const serviceAccountPath = path.resolve(__dirname, "..", process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./firebase-service-account.json");
admin.initializeApp({ credential: admin.credential.cert(require(serviceAccountPath)) });
const db = admin.firestore();

const P = process.env.FIRESTORE_PREFIX || "fitmanager_";
const COL = {
  academias: `${P}academias`,
  usuarios: `${P}usuarios`,
  alunos: `${P}alunos`,
  checkins: `${P}checkins`,
  treinos: `${P}Treinos`,
  exerciciosBiblioteca: `${P}exerciciosBiblioteca`,
  planos: `${P}planos`,
  logsAuditoria: `${P}logsAuditoria`,
  notificacoes: `${P}notificacoes`,
  notificacoesPendentes: `${P}notificacoesPendentes`,
  questPerfis: `${P}questPerfis`,
  questPartidas: `${P}questPartidas`,
};

const semAcademia = (d) => !d.data().academiaId;

async function gravarEmLotes(updates) {
  for (let i = 0; i < updates.length; i += 400) {
    const batch = db.batch();
    updates.slice(i, i + 400).forEach(([ref, dados]) => batch.update(ref, dados));
    await batch.commit();
  }
}

async function main() {
  console.log(`\n=== Migração para isolamento por academia (${APLICAR ? "APLICANDO" : "simulação — nada será gravado"}) ===\n`);

  // 1) Administradores e academias.
  const usuarios = await db.collection(COL.usuarios).get();
  const admins = usuarios.docs.filter((d) => d.data().perfil === "administrador");
  const academias = new Map((await db.collection(COL.academias).get()).docs.map((d) => [d.id, d.data()]));

  console.log("Administradores:");
  for (const a of admins) {
    const u = a.data();
    let academiaId = u.academiaId;
    if (!academiaId) {
      const nome = u.academia?.nome || `Academia de ${u.nome || u.email}`;
      if (APLICAR) {
        const ref = await db.collection(COL.academias).add({
          nome,
          whatsapp: u.academia?.whatsapp ?? null,
          criadoPor: a.id,
          criadoEm: admin.firestore.FieldValue.serverTimestamp(),
        });
        await a.ref.update({ academiaId: ref.id });
        academias.set(ref.id, { nome, criadoPor: a.id });
        academiaId = ref.id;
        console.log(`  + ${u.email} → academia criada "${nome}" (${ref.id})`);
      } else {
        console.log(`  ? ${u.email} → sem academia (será criada: "${nome}")`);
      }
    } else {
      console.log(`  ✓ ${u.email} → "${academias.get(academiaId)?.nome ?? "?"}" (${academiaId})`);
    }
    a._academiaId = academiaId;
  }

  // 2) Documentos sem academia.
  const [alunos, checkins, treinos, exercicios, planos, logs, notificacoes, pendentes, questPerfis, questPartidas] = await Promise.all([
    db.collection(COL.alunos).get(),
    db.collection(COL.checkins).get(),
    db.collectionGroup(COL.treinos).get(),
    db.collection(COL.exerciciosBiblioteca).get(),
    db.collection(COL.planos).get(),
    db.collection(COL.logsAuditoria).get(),
    db.collection(COL.notificacoes).get(),
    db.collection(COL.notificacoesPendentes).get(),
    db.collection(COL.questPerfis).get(),
    db.collection(COL.questPartidas).get(),
  ]);
  const usuariosNaoAdmin = usuarios.docs.filter((d) => d.data().perfil !== "administrador");
  const orfaos = {
    alunos: alunos.docs.filter(semAcademia),
    checkins: checkins.docs.filter(semAcademia),
    treinos: treinos.docs.filter(semAcademia),
    "usuarios (personal/aluno)": usuariosNaoAdmin.filter(semAcademia),
    exerciciosBiblioteca: exercicios.docs.filter(semAcademia),
    planos: planos.docs.filter(semAcademia),
    logsAuditoria: logs.docs.filter(semAcademia),
    notificacoes: notificacoes.docs.filter(semAcademia),
    notificacoesPendentes: pendentes.docs.filter(semAcademia),
    questPerfis: questPerfis.docs.filter(semAcademia),
    questPartidas: questPartidas.docs.filter(semAcademia),
  };
  console.log("\nDocumentos SEM academia (invisíveis no painel até serem atribuídos):");
  for (const [nome, docs] of Object.entries(orfaos)) console.log(`  ${nome.padEnd(28)} ${docs.length}`);

  if (!alvoArg) {
    console.log(`\nPara atribuir esses documentos a uma academia: --academia <id-ou-email-do-admin>${APLICAR ? "" : " (e --aplicar para gravar)"}`);
    return;
  }

  // 3) Academia de destino.
  const adminAlvo = admins.find((a) => a.data().email?.toLowerCase() === alvoArg.toLowerCase());
  const academiaAlvo = adminAlvo ? adminAlvo._academiaId : alvoArg;
  if (adminAlvo && !academiaAlvo) {
    // Só acontece na simulação: com --aplicar a academia dele já foi criada no passo 1.
    console.log(`\nO administrador ${alvoArg} ainda não tem academia — ela será criada e receberá os ${Object.values(orfaos).reduce((n, d) => n + d.length, 0)} documento(s) com --aplicar.`);
    return;
  }
  if (!academiaAlvo || !academias.has(academiaAlvo)) {
    console.error(`\n✗ Academia "${alvoArg}" não encontrada (use o id listado acima ou o e-mail de um administrador).`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nDestino: "${academias.get(academiaAlvo).nome}" (${academiaAlvo})`);

  // Documentos derivados usam a academia do aluno (já migrado ou migrado agora).
  const academiaDoAluno = new Map(alunos.docs.map((d) => [d.id, d.data().academiaId || academiaAlvo]));
  const updates = [];
  for (const [nome, docs] of Object.entries(orfaos)) {
    for (const d of docs) {
      const dados = d.data();
      let academiaId = academiaAlvo;
      if (nome === "treinos") academiaId = academiaDoAluno.get(d.ref.parent.parent.id) ?? academiaAlvo;
      else if (nome.startsWith("usuarios") && dados.alunoId) academiaId = academiaDoAluno.get(dados.alunoId) ?? academiaAlvo;
      else if (nome === "checkins" && dados.alunoId) academiaId = academiaDoAluno.get(dados.alunoId) ?? academiaAlvo;
      else if (nome === "questPerfis") academiaId = academiaDoAluno.get(d.id) ?? academiaAlvo;
      else if (nome === "questPartidas") academiaId = academiaDoAluno.get(dados.desafianteId) ?? academiaAlvo;
      updates.push([d.ref, { academiaId }]);
    }
  }
  console.log(`${updates.length} documento(s) a atualizar.`);

  if (!APLICAR) {
    console.log("Simulação — rode de novo com --aplicar para gravar.");
    return;
  }
  await gravarEmLotes(updates);
  console.log("✓ Migração concluída. Os perfis do Quest são regenerados automaticamente na próxima vez que cada aluno abrir o portal.");
}

main().catch((err) => {
  console.error("✗ Falha na migração:", err);
  process.exitCode = 1;
});
