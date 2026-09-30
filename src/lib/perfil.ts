// Perfil do aluno (tela "Perfil" do portal, estilo Tinder). O documento em
// fitmanager_perfisAlunos/{alunoId} é privado (aluno + equipe); a Cloud
// Function questSincronizarPerfilAluno publica uma versão sem a data de
// nascimento em fitmanager_questPerfis quando o aluno deixa o perfil visível.
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db, COLLECTIONS } from "./firebase";

export interface FotoPerfil { url: string; path: string }

export type SexoPerfil = "masculino" | "feminino" | "outro" | "nao_informar" | "";

export interface PerfilAluno {
  uid: string;
  nome: string;
  dataNascimento: string; // YYYY-MM-DD
  sexo: SexoPerfil;
  cidade: string;
  bio: string;
  objetivos: string[];
  nivel: string;
  horario: string;
  modalidades: string[];
  instagram: string;
  fotos: FotoPerfil[];
  visivelQuest: boolean;
  esconderIdade: boolean;
  atualizadoEm?: unknown;
}

export const MAX_FOTOS = 6;
export const MAX_BIO = 300;
export const MAX_OBJETIVOS = 3;

export const SEXOS: { id: SexoPerfil; label: string }[] = [
  { id: "masculino", label: "Masculino" },
  { id: "feminino", label: "Feminino" },
  { id: "outro", label: "Outro" },
  { id: "nao_informar", label: "Prefiro não dizer" },
];

export const OBJETIVOS = [
  { id: "emagrecer", label: "Emagrecer", icone: "🔥" },
  { id: "ganhar_massa", label: "Ganhar massa", icone: "💪" },
  { id: "definicao", label: "Definição", icone: "✨" },
  { id: "condicionamento", label: "Condicionamento", icone: "🫀" },
  { id: "saude", label: "Saúde e bem-estar", icone: "🌿" },
  { id: "performance", label: "Performance esportiva", icone: "🏅" },
  { id: "reabilitacao", label: "Reabilitação", icone: "🩹" },
];

export const NIVEIS = [
  { id: "iniciante", label: "Iniciante", icone: "🌱" },
  { id: "intermediario", label: "Intermediário", icone: "⚡" },
  { id: "avancado", label: "Avançado", icone: "🔥" },
];

export const HORARIOS = [
  { id: "manha", label: "Manhã", icone: "🌅" },
  { id: "tarde", label: "Tarde", icone: "☀️" },
  { id: "noite", label: "Noite", icone: "🌙" },
];

export const MODALIDADES = [
  "Musculação", "Funcional", "Corrida", "CrossFit", "HIIT", "Calistenia", "Spinning", "Ciclismo",
  "Natação", "Pilates", "Yoga", "Alongamento", "Lutas", "Dança",
];

export const rotulo = (lista: { id: string; label: string; icone?: string }[], id: string | null | undefined) => {
  const item = lista.find((i) => i.id === id);
  return item ? `${item.icone ? `${item.icone} ` : ""}${item.label}` : null;
};

export function perfilVazio(nomeCadastro: string, uid: string): PerfilAluno {
  return {
    uid, nome: nomeCadastro, dataNascimento: "", sexo: "", cidade: "", bio: "", objetivos: [], nivel: "", horario: "",
    modalidades: [], instagram: "", fotos: [], visivelQuest: false, esconderIdade: false,
  };
}

export function calcularIdade(dataNascimento: string): number | null {
  if (!dataNascimento) return null;
  const d = new Date(`${dataNascimento}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const hoje = new Date();
  let idade = hoje.getFullYear() - d.getFullYear();
  if (hoje.getMonth() < d.getMonth() || (hoje.getMonth() === d.getMonth() && hoje.getDate() < d.getDate())) idade--;
  return idade;
}

/** % de preenchimento + a próxima dica para completar o perfil. */
export function completude(p: PerfilAluno) {
  const itens: [boolean, number, string][] = [
    [p.fotos.length >= 1, 15, "Adicione uma foto principal"],
    [p.fotos.length >= 3, 10, "Adicione pelo menos 3 fotos"],
    [p.nome.trim().length >= 2, 5, "Informe seu nome"],
    [!!p.dataNascimento, 10, "Informe sua data de nascimento"],
    [!!p.sexo, 5, "Informe seu sexo"],
    [p.cidade.trim().length > 0, 5, "Informe sua cidade"],
    [p.bio.trim().length >= 20, 15, "Escreva uma bio (mínimo de 20 caracteres)"],
    [p.objetivos.length > 0, 10, "Escolha seus objetivos"],
    [!!p.nivel, 5, "Escolha seu nível"],
    [!!p.horario, 5, "Diga em que horário costuma treinar"],
    [p.modalidades.length > 0, 15, "Escolha suas modalidades favoritas"],
  ];
  const pct = itens.reduce((acc, [ok, peso]) => acc + (ok ? peso : 0), 0);
  const faltando = itens.filter(([ok]) => !ok).map(([, , dica]) => dica);
  return { pct, faltando };
}

/** Documento privado do perfil em tempo real (null enquanto não existir). */
export function usePerfilAluno(alunoId: string) {
  const [state, setState] = useState<{ perfil: PerfilAluno | null; loading: boolean }>({ perfil: null, loading: true });
  useEffect(() => {
    return onSnapshot(
      doc(db, COLLECTIONS.perfisAlunos, alunoId),
      (snap) => setState({ perfil: snap.exists() ? (snap.data() as PerfilAluno) : null, loading: false }),
      (err) => {
        console.error("[usePerfilAluno]", err);
        setState({ perfil: null, loading: false });
      },
    );
  }, [alunoId]);
  return state;
}
