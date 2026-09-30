// Quest — desafios de passatempo entre alunos (jogo da velha, xadrez e jogo
// da memória). O servidor é a ÚNICA fonte de verdade: o portal do aluno só
// lê as partidas (regras do Firestore bloqueiam escrita direta) e toda ação —
// convite, aceite, jogada, desistência — passa por uma callable daqui, que
// valida quem está jogando, de quem é a vez e se o lance é legal.
//
// Coleções (todas prefixadas, ver index.js):
//   questPerfis/{alunoId}    — dados públicos do aluno (nome, foto, placar,
//                              presença). Nunca expõe CPF/endereço do cadastro.
//   questPartidas/{id}       — convite + estado público da partida.
//   questSegredos/{id}       — estado oculto (ordem das cartas da memória);
//                              ilegível para qualquer cliente.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const { Chess } = require("chess.js");

const JOGOS = ["velha", "xadrez", "memoria"];
const CONVITE_VALIDADE_MS = 24 * 60 * 60 * 1000;
const MEMORIA_SIMBOLOS = ["🏋️", "🚴", "🏃", "🤸", "🥊", "🏊", "⚽", "🎾"];

// ─── Lógica pura dos jogos (sem Firestore — testável isoladamente) ───────────

const LINHAS_VELHA = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function embaralhar(lista) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Estado inicial público (+ segredo, quando o jogo tem informação oculta). */
function estadoInicial(jogo, primeiroId, segundoId) {
  if (jogo === "velha") {
    return { estado: { tabuleiro: Array(9).fill(""), simbolos: { [primeiroId]: "X", [segundoId]: "O" }, linhaVencedora: null } };
  }
  if (jogo === "xadrez") {
    return {
      estado: { fen: new Chess().fen(), lances: [], san: [], brancasId: primeiroId, pretasId: segundoId, ultimoLance: null, xeque: false },
    };
  }
  const cartas = embaralhar([...MEMORIA_SIMBOLOS, ...MEMORIA_SIMBOLOS]);
  return {
    estado: { totalCartas: cartas.length, encontradas: {}, virada: null, pares: { [primeiroId]: 0, [segundoId]: 0 }, ultimaTentativa: null, seq: 0 },
    segredo: { cartas },
  };
}

/**
 * Aplica um lance. Lança Error com mensagem em português se for ilegal.
 * Retorna { estado, proximoId, fim } — fim = null ou { vencedorId, motivo }.
 */
function aplicarLance(jogo, estado, segredo, jogadorId, oponenteId, lance) {
  if (jogo === "velha") {
    const pos = lance?.posicao;
    if (!Number.isInteger(pos) || pos < 0 || pos > 8) throw new Error("Posição inválida.");
    if (estado.tabuleiro[pos]) throw new Error("Essa casa já está ocupada.");
    const tabuleiro = [...estado.tabuleiro];
    tabuleiro[pos] = estado.simbolos[jogadorId];
    const linha = LINHAS_VELHA.find(([a, b, c]) => tabuleiro[a] && tabuleiro[a] === tabuleiro[b] && tabuleiro[a] === tabuleiro[c]) ?? null;
    const novo = { ...estado, tabuleiro, linhaVencedora: linha };
    if (linha) return { estado: novo, proximoId: null, fim: { vencedorId: jogadorId, motivo: "três em linha" } };
    if (tabuleiro.every(Boolean)) return { estado: novo, proximoId: null, fim: { vencedorId: null, motivo: "velha (tabuleiro cheio)" } };
    return { estado: novo, proximoId: oponenteId, fim: null };
  }

  if (jogo === "xadrez") {
    const { from, to, promotion } = lance ?? {};
    const quadrado = /^[a-h][1-8]$/;
    if (!quadrado.test(from ?? "") || !quadrado.test(to ?? "")) throw new Error("Casa inválida.");
    if (promotion != null && !["q", "r", "b", "n"].includes(promotion)) throw new Error("Promoção inválida.");
    // Reproduz a partida desde o início (e não só a partir do FEN) para que
    // a repetição tripla seja detectada corretamente.
    const chess = new Chess();
    for (const l of estado.lances) chess.move(l);
    const corDoJogador = estado.brancasId === jogadorId ? "w" : "b";
    if (chess.turn() !== corDoJogador) throw new Error("Não é a vez das suas peças.");
    let mov;
    try {
      mov = chess.move({ from, to, promotion: promotion ?? undefined });
    } catch {
      throw new Error("Lance ilegal.");
    }
    const novoLance = { from: mov.from, to: mov.to, ...(mov.promotion ? { promotion: mov.promotion } : {}) };
    const novo = {
      ...estado,
      fen: chess.fen(),
      lances: [...estado.lances, novoLance],
      san: [...estado.san, mov.san],
      ultimoLance: { from: mov.from, to: mov.to },
      xeque: chess.inCheck(),
    };
    let fim = null;
    if (chess.isCheckmate()) fim = { vencedorId: jogadorId, motivo: "xeque-mate" };
    else if (chess.isStalemate()) fim = { vencedorId: null, motivo: "afogamento" };
    else if (chess.isInsufficientMaterial()) fim = { vencedorId: null, motivo: "material insuficiente" };
    else if (chess.isThreefoldRepetition()) fim = { vencedorId: null, motivo: "repetição tripla" };
    else if (chess.isDrawByFiftyMoves()) fim = { vencedorId: null, motivo: "regra dos 50 lances" };
    return { estado: novo, proximoId: fim ? null : oponenteId, fim };
  }

  // memoria
  const carta = lance?.carta;
  const { cartas } = segredo;
  if (!Number.isInteger(carta) || carta < 0 || carta >= cartas.length) throw new Error("Carta inválida.");
  if (estado.encontradas[carta]) throw new Error("Esse par já foi encontrado.");
  if (estado.virada && estado.virada.carta === carta) throw new Error("Essa carta já está virada.");

  if (!estado.virada) {
    return { estado: { ...estado, virada: { carta, simbolo: cartas[carta] } }, proximoId: jogadorId, fim: null };
  }

  const primeira = estado.virada.carta;
  const acertou = cartas[primeira] === cartas[carta];
  const seq = estado.seq + 1;
  const ultimaTentativa = { cartas: [primeira, carta], simbolos: [cartas[primeira], cartas[carta]], jogadorId, acertou, seq };
  if (!acertou) {
    // Errou: as cartas voltam a ficar ocultas e a vez passa. O cliente usa
    // ultimaTentativa para mostrar as duas por um instante.
    return { estado: { ...estado, virada: null, ultimaTentativa, seq }, proximoId: oponenteId, fim: null };
  }

  const encontradas = { ...estado.encontradas, [primeira]: { simbolo: cartas[primeira], dono: jogadorId }, [carta]: { simbolo: cartas[carta], dono: jogadorId } };
  const pares = { ...estado.pares, [jogadorId]: (estado.pares[jogadorId] ?? 0) + 1 };
  const novo = { ...estado, encontradas, pares, virada: null, ultimaTentativa, seq };
  if (Object.keys(encontradas).length === cartas.length) {
    const meus = pares[jogadorId];
    const deles = pares[oponenteId] ?? 0;
    const vencedorId = meus === deles ? null : meus > deles ? jogadorId : oponenteId;
    return { estado: novo, proximoId: null, fim: { vencedorId, motivo: "todos os pares encontrados" } };
  }
  // Acertou: joga de novo.
  return { estado: novo, proximoId: jogadorId, fim: null };
}

// ─── Firestore / callables ────────────────────────────────────────────────────

function criarQuest(PREFIX) {
  const db = admin.firestore();
  const COL = {
    alunos: `${PREFIX}alunos`,
    usuarios: `${PREFIX}usuarios`,
    academias: `${PREFIX}academias`,
    perfis: `${PREFIX}questPerfis`,
    perfisAlunos: `${PREFIX}perfisAlunos`,
    partidas: `${PREFIX}questPartidas`,
    segredos: `${PREFIX}questSegredos`,
  };
  const inc = admin.firestore.FieldValue.increment;

  /** Aluno autenticado que está chamando (perfil "aluno" ativo). */
  async function alunoDoChamador(request) {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Faça login para jogar.");
    const usuario = (await db.collection(COL.usuarios).doc(uid).get()).data();
    if (!usuario || usuario.perfil !== "aluno" || !usuario.alunoId || usuario.status === "inativo") {
      throw new HttpsError("permission-denied", "Apenas alunos com acesso ativo podem usar o Quest.");
    }
    if (!usuario.academiaId) {
      throw new HttpsError("failed-precondition", "Sua conta ainda não está vinculada a uma academia. Fale com a recepção.");
    }
    return { uid, alunoId: usuario.alunoId, academiaId: usuario.academiaId };
  }

  function calcularIdade(dataNascimento) {
    const d = new Date(`${dataNascimento}T12:00:00`);
    if (!dataNascimento || Number.isNaN(d.getTime())) return null;
    const hoje = new Date();
    let idade = hoje.getFullYear() - d.getFullYear();
    if (hoje.getMonth() < d.getMonth() || (hoje.getMonth() === d.getMonth() && hoje.getDate() < d.getDate())) idade--;
    return idade;
  }

  const CAMPOS_PUBLICOS = ["nome", "fotoUrl", "fotos", "idade", "bio", "objetivos", "nivel", "horario", "modalidades", "cidade", "instagram"];

  /**
   * (Re)gera o perfil público do Quest a partir do cadastro + do Perfil que o
   * aluno editou (perfisAlunos). Só publica dados quando o aluno optou por
   * ficar visível; do contrário apaga os campos públicos. A data de
   * nascimento nunca é publicada — só a idade, e só se não estiver oculta.
   * A foto do cadastro (usada no reconhecimento facial) também não.
   */
  async function sincronizarPerfil(alunoId, uid, extras = {}) {
    const [alunoSnap, perfilSnap, usuarioSnap] = await Promise.all([
      db.collection(COL.alunos).doc(alunoId).get(),
      db.collection(COL.perfisAlunos).doc(alunoId).get(),
      db.collection(COL.usuarios).doc(uid).get(),
    ]);
    const aluno = alunoSnap.data();
    const perfil = perfilSnap.data() ?? {};
    const usuario = usuarioSnap.data();
    // Academia = a do cadastro do aluno; o login dele precisa ser da mesma.
    const academiaId = aluno?.academiaId ?? null;
    const ativo = !!aluno && !!academiaId && usuario?.perfil === "aluno" && usuario.alunoId === alunoId
      && usuario.status !== "inativo" && usuario.academiaId === academiaId;
    const visivel = ativo && perfil.visivelQuest === true;
    const academia = academiaId ? (await db.collection(COL.academias).doc(academiaId).get()).data() : null;

    const base = {
      alunoId,
      uid,
      ativo,
      visivel,
      academiaId,
      academiaNome: academia?.nome ?? null,
      ...extras,
    };
    const fotos = (perfil.fotos ?? []).map((f) => f.url).filter(Boolean).slice(0, 6);
    const publico = visivel
      ? {
          nome: (perfil.nome || aluno.nome || "Aluno").trim(),
          fotoUrl: fotos[0] ?? null,
          fotos,
          idade: perfil.esconderIdade ? null : calcularIdade(perfil.dataNascimento),
          bio: perfil.bio ?? "",
          objetivos: perfil.objetivos ?? [],
          nivel: perfil.nivel ?? null,
          horario: perfil.horario ?? null,
          modalidades: perfil.modalidades ?? [],
          cidade: perfil.cidade ?? "",
          instagram: perfil.instagram ?? "",
        }
      : Object.fromEntries(CAMPOS_PUBLICOS.map((c) => [c, admin.firestore.FieldValue.delete()]));
    await db.collection(COL.perfis).doc(alunoId).set({ ...base, ...publico }, { merge: true });
    return { ...base, ...(visivel ? publico : {}) };
  }

  function placarDelta(jogo, campo) {
    return { placar: { [jogo]: { [campo]: inc(1) }, total: { [campo]: inc(1) } } };
  }

  /** Dentro de uma transação: grava o fim da partida e atualiza os placares. */
  function finalizar(tx, ref, partida, vencedorId, motivo, extras = {}) {
    const [a, b] = partida.jogadores;
    tx.update(ref, {
      ...extras,
      status: "finalizada",
      vez: null,
      vencedorId,
      motivoFim: motivo,
      finalizadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
    });
    for (const id of [a, b]) {
      const campo = vencedorId === null ? "e" : vencedorId === id ? "v" : "d";
      tx.set(db.collection(COL.perfis).doc(id), placarDelta(partida.jogo, campo), { merge: true });
    }
  }

  const erroDe = (err) => (err instanceof HttpsError ? err : new HttpsError("failed-precondition", err.message));

  const questEntrar = onCall(async (request) => {
    const { uid, alunoId } = await alunoDoChamador(request);
    const perfil = await sincronizarPerfil(alunoId, uid, { online: true, ultimoSinal: admin.firestore.FieldValue.serverTimestamp() });
    return { alunoId, visivel: perfil.visivel };
  });

  const questDesafiar = onCall(async (request) => {
    const { alunoId, academiaId } = await alunoDoChamador(request);
    const { oponenteId, jogo } = request.data ?? {};
    if (!JOGOS.includes(jogo)) throw new HttpsError("invalid-argument", "Jogo inválido.");
    if (!oponenteId || oponenteId === alunoId) throw new HttpsError("invalid-argument", "Escolha outro aluno para desafiar.");

    const [eu, oponente] = await Promise.all([
      db.collection(COL.perfis).doc(alunoId).get(),
      db.collection(COL.perfis).doc(oponenteId).get(),
    ]);
    if (!eu.exists || !eu.data().visivel) {
      throw new HttpsError("failed-precondition", "Deixe seu perfil visível para os alunos (em Perfil › Privacidade) para poder desafiar.");
    }
    if (!oponente.exists || !oponente.data().visivel) throw new HttpsError("not-found", "Esse aluno não está disponível para desafios.");
    // Isolamento por academia: as duas pontas precisam ser da academia do login de quem desafia.
    if (eu.data().academiaId !== academiaId || oponente.data().academiaId !== academiaId) {
      throw new HttpsError("permission-denied", "Você só pode desafiar alunos da sua academia.");
    }

    const pendentes = await db.collection(COL.partidas)
      .where("desafianteId", "==", alunoId)
      .where("desafiadoId", "==", oponenteId)
      .where("status", "==", "pendente")
      .get();
    const agora = Date.now();
    if (pendentes.docs.some((d) => d.data().jogo === jogo && new Date(d.data().expiraEm).getTime() > agora)) {
      throw new HttpsError("already-exists", "Você já enviou um convite desse jogo para este aluno.");
    }

    const ref = db.collection(COL.partidas).doc();
    await ref.set({
      academiaId,
      jogo,
      status: "pendente",
      desafianteId: alunoId,
      desafiadoId: oponenteId,
      jogadores: [alunoId, oponenteId],
      jogadoresUid: [eu.data().uid, oponente.data().uid],
      nomes: { [alunoId]: eu.data().nome, [oponenteId]: oponente.data().nome },
      fotos: { [alunoId]: eu.data().fotoUrl ?? null, [oponenteId]: oponente.data().fotoUrl ?? null },
      vez: null,
      estado: null,
      vencedorId: null,
      motivoFim: null,
      criadoEm: new Date(agora).toISOString(),
      expiraEm: new Date(agora + CONVITE_VALIDADE_MS).toISOString(),
      atualizadoEm: new Date(agora).toISOString(),
    });
    return { partidaId: ref.id };
  });

  const questResponder = onCall(async (request) => {
    const { alunoId } = await alunoDoChamador(request);
    const { partidaId, acao } = request.data ?? {};
    if (!partidaId || !["aceitar", "recusar", "cancelar"].includes(acao)) throw new HttpsError("invalid-argument", "Ação inválida.");
    const ref = db.collection(COL.partidas).doc(partidaId);

    try {
      return await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new HttpsError("not-found", "Convite não encontrado.");
        const p = snap.data();
        if (p.status !== "pendente") throw new HttpsError("failed-precondition", "Esse convite não está mais pendente.");
        const agoraIso = new Date().toISOString();

        if (acao === "cancelar") {
          if (p.desafianteId !== alunoId) throw new HttpsError("permission-denied", "Só quem enviou pode cancelar o convite.");
          tx.update(ref, { status: "cancelado", atualizadoEm: agoraIso });
          return { status: "cancelado" };
        }
        if (p.desafiadoId !== alunoId) throw new HttpsError("permission-denied", "Esse convite não é para você.");
        if (new Date(p.expiraEm).getTime() <= Date.now()) {
          tx.update(ref, { status: "expirado", atualizadoEm: agoraIso });
          return { status: "expirado" };
        }
        if (acao === "recusar") {
          tx.update(ref, { status: "recusado", atualizadoEm: agoraIso });
          return { status: "recusado" };
        }

        // Aceitar: sorteia quem começa (no xadrez, quem começa joga de brancas).
        const [primeiro, segundo] = Math.random() < 0.5 ? [p.desafianteId, p.desafiadoId] : [p.desafiadoId, p.desafianteId];
        const { estado, segredo } = estadoInicial(p.jogo, primeiro, segundo);
        if (segredo) tx.set(db.collection(COL.segredos).doc(partidaId), segredo);
        tx.update(ref, { status: "andamento", estado, vez: primeiro, iniciadoEm: agoraIso, atualizadoEm: agoraIso });
        return { status: "andamento" };
      });
    } catch (err) {
      throw erroDe(err);
    }
  });

  const questJogar = onCall(async (request) => {
    const { alunoId } = await alunoDoChamador(request);
    const { partidaId, lance } = request.data ?? {};
    if (!partidaId) throw new HttpsError("invalid-argument", "Partida inválida.");
    const ref = db.collection(COL.partidas).doc(partidaId);
    const segredoRef = db.collection(COL.segredos).doc(partidaId);

    try {
      return await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new HttpsError("not-found", "Partida não encontrada.");
        const p = snap.data();
        if (!p.jogadores.includes(alunoId)) throw new HttpsError("permission-denied", "Você não participa desta partida.");
        if (p.status !== "andamento") throw new HttpsError("failed-precondition", "A partida não está em andamento.");
        if (p.vez !== alunoId) throw new HttpsError("failed-precondition", "Aguarde a sua vez.");
        const segredo = p.jogo === "memoria" ? (await tx.get(segredoRef)).data() : null;
        const oponenteId = p.jogadores.find((id) => id !== alunoId);

        const { estado, proximoId, fim } = aplicarLance(p.jogo, p.estado, segredo, alunoId, oponenteId, lance);
        if (fim) {
          finalizar(tx, ref, p, fim.vencedorId, fim.motivo, { estado });
        } else {
          tx.update(ref, { estado, vez: proximoId, atualizadoEm: new Date().toISOString() });
        }
        return { ok: true };
      });
    } catch (err) {
      throw erroDe(err);
    }
  });

  const questDesistir = onCall(async (request) => {
    const { alunoId } = await alunoDoChamador(request);
    const { partidaId } = request.data ?? {};
    if (!partidaId) throw new HttpsError("invalid-argument", "Partida inválida.");
    const ref = db.collection(COL.partidas).doc(partidaId);
    try {
      return await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new HttpsError("not-found", "Partida não encontrada.");
        const p = snap.data();
        if (!p.jogadores.includes(alunoId)) throw new HttpsError("permission-denied", "Você não participa desta partida.");
        if (p.status !== "andamento") throw new HttpsError("failed-precondition", "A partida não está em andamento.");
        finalizar(tx, ref, p, p.jogadores.find((id) => id !== alunoId), "desistência");
        return { ok: true };
      });
    } catch (err) {
      throw erroDe(err);
    }
  });

  /** Marca como expirados os convites com mais de 24h sem resposta. */
  const questExpirarConvites = onSchedule("every 60 minutes", async () => {
    const agora = Date.now();
    // Só igualdade no status (sem índice composto); a data é filtrada aqui.
    const snap = await db.collection(COL.partidas).where("status", "==", "pendente").get();
    const vencidos = snap.docs.filter((d) => new Date(d.data().expiraEm).getTime() <= agora);
    for (let i = 0; i < vencidos.length; i += 400) {
      const batch = db.batch();
      vencidos.slice(i, i + 400).forEach((d) => batch.update(d.ref, { status: "expirado", atualizadoEm: new Date(agora).toISOString() }));
      await batch.commit();
    }
    console.log(`[quest] ${vencidos.length} convite(s) expirado(s)`);
  });

  /** Cadastro alterado/excluído pela recepção → regenera o perfil público (se já existir). */
  const questSincronizarAluno = onDocumentWritten(`${COL.alunos}/{alunoId}`, async (event) => {
    const perfil = await db.collection(COL.perfis).doc(event.params.alunoId).get();
    if (!perfil.exists) return;
    await sincronizarPerfil(event.params.alunoId, perfil.data().uid);
  });

  /** Acesso ao portal criado/desativado → cria ou oculta o perfil público. */
  const questSincronizarUsuario = onDocumentWritten(`${COL.usuarios}/{uid}`, async (event) => {
    const after = event.data?.after?.data();
    const before = event.data?.before?.data();
    const alunoId = after?.alunoId ?? before?.alunoId;
    if (!alunoId || (after?.perfil ?? before?.perfil) !== "aluno") return;
    await sincronizarPerfil(alunoId, event.params.uid);
  });

  /** Aluno salvou o Perfil (fotos, bio, privacidade...) → republica a versão pública. */
  const questSincronizarPerfilAluno = onDocumentWritten(`${COL.perfisAlunos}/{alunoId}`, async (event) => {
    const dados = event.data?.after?.data() ?? event.data?.before?.data();
    if (!dados?.uid) return;
    await sincronizarPerfil(event.params.alunoId, dados.uid);
  });

  return {
    questEntrar, questDesafiar, questResponder, questJogar, questDesistir, questExpirarConvites,
    questSincronizarAluno, questSincronizarUsuario, questSincronizarPerfilAluno,
  };
}

module.exports = { criarQuest, logica: { estadoInicial, aplicarLance } };
