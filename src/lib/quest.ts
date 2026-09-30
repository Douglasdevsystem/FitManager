// Quest — tipos, leitura em tempo real e chamadas às Cloud Functions.
// O cliente NUNCA grava partidas diretamente (as regras do Firestore
// bloqueiam): toda ação passa por uma callable que valida a jogada no
// servidor (fitmanager-kiosk/functions/quest.js).
import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where, type Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions, COLLECTIONS } from "./firebase";

export type QuestJogo = "velha" | "xadrez" | "memoria";
export type QuestStatus = "pendente" | "recusado" | "cancelado" | "expirado" | "andamento" | "finalizada";

export const JOGOS: Record<QuestJogo, { nome: string; icone: string; descricao: string }> = {
  velha: { nome: "Jogo da velha", icone: "⭕", descricao: "Três em linha vence." },
  xadrez: { nome: "Xadrez", icone: "♟️", descricao: "Regras completas, com xeque-mate." },
  memoria: { nome: "Jogo da memória", icone: "🃏", descricao: "Quem formar mais pares vence." },
};

export interface Placar { v?: number; d?: number; e?: number }

export interface QuestPerfil {
  id: string; // alunoId
  alunoId: string;
  uid: string;
  ativo: boolean;
  visivel: boolean;
  academiaId: string | null;
  academiaNome?: string | null;
  nome?: string;
  fotoUrl?: string | null;
  fotos?: string[];
  idade?: number | null;
  bio?: string;
  objetivos?: string[];
  nivel?: string | null;
  horario?: string | null;
  modalidades?: string[];
  cidade?: string;
  instagram?: string;
  online?: boolean;
  ultimoSinal?: Timestamp | null;
  placar?: Partial<Record<QuestJogo | "total", Placar>>;
}

export interface EstadoVelha { tabuleiro: string[]; simbolos: Record<string, "X" | "O">; linhaVencedora: number[] | null }
export interface EstadoXadrez {
  fen: string;
  lances: { from: string; to: string; promotion?: string }[];
  san: string[];
  brancasId: string;
  pretasId: string;
  ultimoLance: { from: string; to: string } | null;
  xeque: boolean;
}
export interface EstadoMemoria {
  totalCartas: number;
  encontradas: Record<string, { simbolo: string; dono: string }>;
  virada: { carta: number; simbolo: string } | null;
  pares: Record<string, number>;
  ultimaTentativa: { cartas: [number, number]; simbolos: [string, string]; jogadorId: string; acertou: boolean; seq: number } | null;
  seq: number;
}

export interface QuestPartida {
  id: string;
  jogo: QuestJogo;
  status: QuestStatus;
  desafianteId: string;
  desafiadoId: string;
  jogadores: [string, string];
  nomes: Record<string, string>;
  fotos: Record<string, string | null>;
  vez: string | null;
  estado: EstadoVelha | EstadoXadrez | EstadoMemoria | null;
  vencedorId: string | null;
  motivoFim: string | null;
  criadoEm: string;
  expiraEm: string;
  atualizadoEm: string;
  finalizadoEm?: string;
}

/** Status efetivo: um convite pendente passado das 24h já conta como expirado, mesmo antes da varredura do servidor. */
export function statusEfetivo(p: QuestPartida): QuestStatus {
  return p.status === "pendente" && new Date(p.expiraEm).getTime() <= Date.now() ? "expirado" : p.status;
}

const ONLINE_JANELA_MS = 2.5 * 60 * 1000;
export function estaOnline(p: QuestPerfil, agora = Date.now()) {
  const ts = p.ultimoSinal?.toMillis?.() ?? 0;
  return p.online === true && agora - ts < ONLINE_JANELA_MS;
}

// ─── Leitura em tempo real ────────────────────────────────────────────────────

export function useQuestPerfis(academiaId: string, ativo: boolean) {
  const [state, setState] = useState<{ data: QuestPerfil[]; loading: boolean; error: string | null }>({ data: [], loading: true, error: null });
  useEffect(() => {
    if (!ativo) return;
    // Só alunos visíveis da MESMA academia (as regras recusam qualquer outra consulta).
    const q = query(collection(db, COLLECTIONS.questPerfis), where("academiaId", "==", academiaId), where("visivel", "==", true));
    return onSnapshot(
      q,
      (snap) => setState({ data: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as QuestPerfil), loading: false, error: null }),
      (err) => {
        console.error("[useQuestPerfis]", err);
        setState((s) => ({ ...s, loading: false, error: err.message }));
      },
    );
  }, [academiaId, ativo]);
  return state;
}

export function useMeuQuestPerfil(alunoId: string, ativo: boolean) {
  const [perfil, setPerfil] = useState<QuestPerfil | null>(null);
  useEffect(() => {
    if (!ativo) return;
    return onSnapshot(
      doc(db, COLLECTIONS.questPerfis, alunoId),
      (snap) => setPerfil(snap.exists() ? ({ id: snap.id, ...snap.data() } as QuestPerfil) : null),
      (err) => console.error("[useMeuQuestPerfil]", err),
    );
  }, [alunoId, ativo]);
  return perfil;
}

export function useQuestPartidas(uid: string | null) {
  const [state, setState] = useState<{ data: QuestPartida[]; loading: boolean; error: string | null }>({ data: [], loading: true, error: null });
  useEffect(() => {
    if (!uid) return;
    // Sem orderBy para não exigir índice composto (o projeto Firebase é
    // compartilhado); a ordenação é feita aqui.
    const q = query(collection(db, COLLECTIONS.questPartidas), where("jogadoresUid", "array-contains", uid));
    return onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as QuestPartida);
        data.sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm));
        setState({ data, loading: false, error: null });
      },
      (err) => {
        console.error("[useQuestPartidas]", err);
        setState((s) => ({ ...s, loading: false, error: err.message }));
      },
    );
  }, [uid]);
  return state;
}

// ─── Presença ─────────────────────────────────────────────────────────────────

/**
 * Enquanto o portal estiver aberto: garante o perfil público (questEntrar) e
 * envia um sinal de vida a cada minuto. Ao esconder a aba, marca offline.
 */
export function useQuestPresenca(alunoId: string) {
  const [pronto, setPronto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const ref = doc(db, COLLECTIONS.questPerfis, alunoId);
    const sinal = (online: boolean) => updateDoc(ref, { online, ultimoSinal: serverTimestamp() }).catch(() => {});
    const onVisibilidade = () => sinal(document.visibilityState === "visible");

    questApi.entrar()
      .then(() => {
        if (cancelado) return;
        setPronto(true);
        timer = setInterval(() => document.visibilityState === "visible" && sinal(true), 60_000);
        document.addEventListener("visibilitychange", onVisibilidade);
      })
      .catch((err) => {
        console.error("[Quest] não foi possível ativar o perfil:", err);
        if (!cancelado) setErro((err as Error)?.message || "O Quest ainda não está disponível. Tente novamente mais tarde.");
      });

    return () => {
      cancelado = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilidade);
      sinal(false);
    };
  }, [alunoId]);

  return { pronto, erro };
}

// ─── Ações (Cloud Functions) ──────────────────────────────────────────────────

function chamar<T = unknown>(nome: string) {
  const fn = httpsCallable(functions, nome);
  return async (dados?: unknown): Promise<T> => {
    try {
      return (await fn(dados)).data as T;
    } catch (err) {
      // HttpsError do servidor já vem com mensagem em português.
      const msg = (err as { message?: string })?.message;
      throw new Error(msg && !/^internal$/i.test(msg) ? msg : "Não foi possível completar a ação. Verifique sua conexão.");
    }
  };
}

export const questApi = {
  entrar: chamar<{ alunoId: string; visivel: boolean }>("questEntrar"),
  desafiar: (oponenteId: string, jogo: QuestJogo) => chamar<{ partidaId: string }>("questDesafiar")({ oponenteId, jogo }),
  responder: (partidaId: string, acao: "aceitar" | "recusar" | "cancelar") => chamar("questResponder")({ partidaId, acao }),
  jogar: (partidaId: string, lance: unknown) => chamar("questJogar")({ partidaId, lance }),
  desistir: (partidaId: string) => chamar("questDesistir")({ partidaId }),
};
