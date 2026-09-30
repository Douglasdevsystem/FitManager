// Sessão do usuário logado + academia a que ele pertence. Todo dado do
// FitManager é isolado por academiaId (várias academias usam o mesmo banco),
// então as telas leem a academia daqui — nunca de um valor fixo.
import { createContext, useContext } from "react";
import { addDoc, collection, doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db, COLLECTIONS } from "./firebase";
import type { Academia, Usuario } from "./types";

export interface Sessao {
  uid: string;
  usuario: Usuario;
  /** "" só para aluno antigo ainda não migrado (ver carregarSessao). */
  academiaId: string;
  academia: Academia | null;
}

export const SessaoContext = createContext<Sessao | null>(null);

export function useSessao(): Sessao {
  const sessao = useContext(SessaoContext);
  if (!sessao) throw new Error("useSessao() usado fora de um <SessaoContext.Provider>.");
  return sessao;
}

export const useAcademiaId = () => useSessao().academiaId;

export class SemAcademiaError extends Error {}

/**
 * Carrega o usuário e a academia dele. Um administrador criado antes do
 * isolamento por academia (sem academiaId) ganha uma academia na hora, a
 * partir dos dados que já tinha — os dados antigos dele são vinculados
 * depois pelo script fitmanager-kiosk/scripts/migrar-academias.js.
 */
export async function carregarSessao(uid: string): Promise<Sessao> {
  const snap = await getDoc(doc(db, COLLECTIONS.usuarios, uid));
  if (!snap.exists()) throw new SemAcademiaError("Usuário não encontrado.");
  const usuario = { id: snap.id, ...snap.data() } as Usuario;

  let academiaId = usuario.academiaId ?? null;
  if (!academiaId && usuario.perfil === "administrador") {
    const ref = await addDoc(collection(db, COLLECTIONS.academias), {
      nome: usuario.academia?.nome ?? "Minha academia",
      whatsapp: usuario.academia?.whatsapp ?? null,
      criadoPor: uid,
      criadoEm: serverTimestamp(),
    });
    await updateDoc(doc(db, COLLECTIONS.usuarios, uid), { academiaId: ref.id });
    academiaId = ref.id;
    usuario.academiaId = ref.id;
  }
  if (!academiaId) {
    // Aluno antigo ainda não migrado: o portal funciona (treinos, histórico...
    // são lidos pelo caminho do próprio aluno), só o Quest fica indisponível.
    if (usuario.perfil === "aluno") return { uid, usuario, academiaId: "", academia: null };
    throw new SemAcademiaError("Sua conta ainda não está vinculada a uma academia. Fale com o administrador.");
  }

  const academiaSnap = await getDoc(doc(db, COLLECTIONS.academias, academiaId));
  const academia = academiaSnap.exists() ? ({ id: academiaSnap.id, ...academiaSnap.data() } as Academia) : null;
  return { uid, usuario, academiaId, academia };
}
