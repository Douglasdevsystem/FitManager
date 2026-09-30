// Realtime Firestore hooks for the admin panel. Each hook subscribes with
// onSnapshot (not a one-off getDocs), so every screen stays in sync live —
// including with what the kiosk writes at the entrance — and, thanks to the
// persistent local cache configured in lib/firebase.ts, keeps working from
// cache when the connection drops.
//
// ISOLAMENTO POR ACADEMIA: várias academias usam o mesmo banco. Toda consulta
// da equipe filtra por academiaId (da sessão, ver lib/sessao.ts) — e as regras
// do Firestore recusam qualquer consulta que não filtre. A ordenação é feita
// aqui no cliente para não exigir índices compostos (where + orderBy) num
// projeto Firebase compartilhado; a exceção é o log de auditoria, que usa
// limit() e tem índice próprio em fitmanager-kiosk/firestore.indexes.json.
import { useEffect, useState } from "react";
import { collection, collectionGroup, limit, onSnapshot, orderBy, query, where, type Query } from "firebase/firestore";
import { db, COLLECTIONS } from "./firebase";
import { useAcademiaId } from "./sessao";
import type { Aluno, Checkin, Treino, Usuario, LogAuditoria, ExecucaoTreino, ExercicioBiblioteca, AvaliacaoFisica } from "./types";

interface QueryState<T> {
  data: T[];
  loading: boolean;
  error: string | null;
}

/** Assina uma consulta em tempo real; `montar` devolve null quando ainda não há o que consultar. */
function useConsulta<T>(nome: string, montar: () => Query | null, deps: unknown[], ordenar?: (a: T, b: T) => number): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({ data: [], loading: true, error: null });

  useEffect(() => {
    const q = montar();
    if (!q) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    setState((prev) => ({ ...prev, loading: true }));
    return onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
        if (ordenar) data.sort(ordenar);
        setState({ data, loading: false, error: null });
      },
      (err) => {
        console.error(`[${nome}] falha na leitura:`, err);
        setState((prev) => ({ ...prev, loading: false, error: err.message }));
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

const porNome = (a: { nome: string }, b: { nome: string }) => (a.nome ?? "").localeCompare(b.nome ?? "", "pt-BR");

export function useAlunos(): QueryState<Aluno> {
  const academiaId = useAcademiaId();
  return useConsulta<Aluno>("useAlunos", () => query(collection(db, COLLECTIONS.alunos), where("academiaId", "==", academiaId)), [academiaId], porNome);
}

export function useCheckins(): QueryState<Checkin> {
  const academiaId = useAcademiaId();
  return useConsulta<Checkin>(
    "useCheckins",
    () => query(collection(db, COLLECTIONS.checkins), where("academiaId", "==", academiaId)),
    [academiaId],
    (a, b) => b.timestamp.localeCompare(a.timestamp),
  );
}

/** Treinos de todos os alunos da academia (painel da equipe). */
export function useTreinos(): QueryState<Treino> {
  const academiaId = useAcademiaId();
  // collectionGroup: a coleção já é prefixada — ver o comentário em
  // lib/firebase.ts sobre por que isso importa num projeto compartilhado.
  return useConsulta<Treino>(
    "useTreinos",
    () => query(collectionGroup(db, COLLECTIONS.treinos), where("academiaId", "==", academiaId)),
    [academiaId],
    (a, b) => b.dataCriacao.localeCompare(a.dataCriacao),
  );
}

/** Treinos de um único aluno (portal do aluno) — lê só a subcoleção dele. */
export function useTreinosDoAluno(alunoId: string): QueryState<Treino> {
  return useConsulta<Treino>(
    "useTreinosDoAluno",
    () => query(collection(db, COLLECTIONS.alunos, alunoId, COLLECTIONS.treinos)),
    [alunoId],
    (a, b) => b.dataCriacao.localeCompare(a.dataCriacao),
  );
}

export function useUsuarios(): QueryState<Usuario> {
  const academiaId = useAcademiaId();
  return useConsulta<Usuario>("useUsuarios", () => query(collection(db, COLLECTIONS.usuarios), where("academiaId", "==", academiaId)), [academiaId], porNome);
}

export function useLogsAuditoria(max = 100): QueryState<LogAuditoria> {
  const academiaId = useAcademiaId();
  return useConsulta<LogAuditoria>(
    "useLogsAuditoria",
    () => query(collection(db, COLLECTIONS.logsAuditoria), where("academiaId", "==", academiaId), orderBy("timestamp", "desc"), limit(max)),
    [academiaId, max],
  );
}

export function useExecucoesTreino(alunoId: string | null): QueryState<ExecucaoTreino> {
  return useConsulta<ExecucaoTreino>(
    "useExecucoesTreino",
    () => (alunoId ? query(collection(db, COLLECTIONS.alunos, alunoId, COLLECTIONS.execucoesTreino), orderBy("data", "desc"), limit(60)) : null),
    [alunoId],
  );
}

export function useAvaliacoesFisicas(alunoId: string | null): QueryState<AvaliacaoFisica> {
  return useConsulta<AvaliacaoFisica>(
    "useAvaliacoesFisicas",
    () => (alunoId ? query(collection(db, COLLECTIONS.alunos, alunoId, COLLECTIONS.avaliacoesFisicas), orderBy("data", "desc")) : null),
    [alunoId],
  );
}

export function useExerciciosBiblioteca(): QueryState<ExercicioBiblioteca> {
  const academiaId = useAcademiaId();
  return useConsulta<ExercicioBiblioteca>(
    "useExerciciosBiblioteca",
    () => query(collection(db, COLLECTIONS.exerciciosBiblioteca), where("academiaId", "==", academiaId)),
    [academiaId],
    porNome,
  );
}

/** True when the given ISO timestamp/date string falls on today's calendar date. */
export function isToday(isoString: string): boolean {
  if (!isoString) return false;
  const d = new Date(isoString);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}
