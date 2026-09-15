// Realtime Firestore hooks for the admin panel. Each hook subscribes with
// onSnapshot (not a one-off getDocs), so every screen stays in sync live —
// including with what the kiosk writes at the entrance — and, thanks to the
// persistent local cache configured in lib/firebase.ts, keeps working from
// cache when the connection drops.
import { useEffect, useState } from "react";
import { collection, collectionGroup, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db, COLLECTIONS } from "./firebase";
import type { Aluno, Checkin, Treino, Usuario, LogAuditoria } from "./types";

interface QueryState<T> {
  data: T[];
  loading: boolean;
  error: string | null;
}

export function useAlunos(): QueryState<Aluno> {
  const [state, setState] = useState<QueryState<Aluno>>({ data: [], loading: true, error: null });

  useEffect(() => {
    const q = query(collection(db, COLLECTIONS.alunos), orderBy("nome"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Aluno);
        setState({ data, loading: false, error: null });
      },
      (err) => {
        console.error("[useAlunos] falha ao ler fitmanager_alunos:", err);
        setState((prev) => ({ ...prev, loading: false, error: err.message }));
      }
    );
    return unsubscribe;
  }, []);

  return state;
}

export function useCheckins(): QueryState<Checkin> {
  const [state, setState] = useState<QueryState<Checkin>>({ data: [], loading: true, error: null });

  useEffect(() => {
    const q = query(collection(db, COLLECTIONS.checkins), orderBy("timestamp", "desc"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Checkin);
        setState({ data, loading: false, error: null });
      },
      (err) => {
        console.error("[useCheckins] falha ao ler fitmanager_checkins:", err);
        setState((prev) => ({ ...prev, loading: false, error: err.message }));
      }
    );
    return unsubscribe;
  }, []);

  return state;
}

export function useTreinos(): QueryState<Treino> {
  const [state, setState] = useState<QueryState<Treino>>({ data: [], loading: true, error: null });

  useEffect(() => {
    // collectionGroup: lista treinos de TODOS os alunos de uma vez (a
    // coleção já é prefixada — ver o comentário em lib/firebase.ts sobre
    // por que isso importa num projeto Firebase compartilhado).
    const q = query(collectionGroup(db, COLLECTIONS.treinos), orderBy("dataCriacao", "desc"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Treino);
        setState({ data, loading: false, error: null });
      },
      (err) => {
        console.error("[useTreinos] falha ao ler treinos:", err);
        setState((prev) => ({ ...prev, loading: false, error: err.message }));
      }
    );
    return unsubscribe;
  }, []);

  return state;
}

export function useUsuarios(): QueryState<Usuario> {
  const [state, setState] = useState<QueryState<Usuario>>({ data: [], loading: true, error: null });

  useEffect(() => {
    const q = query(collection(db, COLLECTIONS.usuarios), orderBy("nome"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Usuario);
        setState({ data, loading: false, error: null });
      },
      (err) => {
        console.error("[useUsuarios] falha ao ler fitmanager_usuarios:", err);
        setState((prev) => ({ ...prev, loading: false, error: err.message }));
      }
    );
    return unsubscribe;
  }, []);

  return state;
}

export function useLogsAuditoria(max = 100): QueryState<LogAuditoria> {
  const [state, setState] = useState<QueryState<LogAuditoria>>({ data: [], loading: true, error: null });

  useEffect(() => {
    const q = query(collection(db, COLLECTIONS.logsAuditoria), orderBy("timestamp", "desc"), limit(max));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as LogAuditoria);
        setState({ data, loading: false, error: null });
      },
      (err) => {
        console.error("[useLogsAuditoria] falha ao ler fitmanager_logsAuditoria:", err);
        setState((prev) => ({ ...prev, loading: false, error: err.message }));
      }
    );
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [max]);

  return state;
}

/** True when the given ISO timestamp/date string falls on today's calendar date. */
export function isToday(isoString: string): boolean {
  if (!isoString) return false;
  const d = new Date(isoString);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}
