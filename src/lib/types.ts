// Firestore document shapes for the FitManager collections (see
// fitmanager-kiosk/README.md for the full schema). Field names match exactly
// what's stored in Firestore (Portuguese), so there's no silent mismatch
// between what the panel shows and what's actually saved.

export type AlunoStatus = "ativo" | "vencido" | "inativo" | "pendente";

export interface Aluno {
  id: string;
  nome: string;
  endereco: string;
  whatsapp: string;
  cpf: string;
  rg: string;
  email?: string;
  tipoPlano: string; // "mensal" | "trimestral" | "anual" (ou outro cadastrado em fitmanager_planos)
  valorPlano: number;
  dataMatricula: string; // ISO date
  dataVencimento: string; // ISO date
  status: AlunoStatus;
  fotoUrl?: string;
  faceEmbedding?: number[];
  consentimentoLGPD: boolean;
  consentimentoDataHora?: string;
  criadoEm?: unknown;
  atualizadoEm?: unknown;
}

export type CheckinStatus = "liberado" | "negado";

export interface Checkin {
  id: string;
  alunoId: string | null;
  nomeAluno: string;
  timestamp: string; // ISO datetime
  tipo: string; // "reconhecimento_facial" | "manual"
  status: CheckinStatus;
  confiancaMatch?: number | null;
  dispositivoId?: string;
}

export type GrupoMuscular = "peito" | "costas" | "pernas" | "ombros" | "braços" | "core" | "cardio" | "outro";

export const GRUPOS_MUSCULARES: GrupoMuscular[] = ["peito", "costas", "pernas", "ombros", "braços", "core", "cardio", "outro"];

export type TipoMidiaExercicio = "video" | "foto";

/** Exercício cadastrado na biblioteca compartilhada (fitmanager_exerciciosBiblioteca), reutilizável em qualquer treino. */
export interface ExercicioBiblioteca {
  id: string;
  nome: string;
  grupoMuscular: GrupoMuscular;
  descricao?: string;
  tipoMidia?: TipoMidiaExercicio;
  urlMidia?: string;
  criadoEm?: unknown;
}

/**
 * Exercício dentro de um treino específico — referencia (quando veio da
 * biblioteca) o ExercicioBiblioteca original via exercicioId, mas denormaliza
 * nome/grupoMuscular/mídia para exibir sem lookup extra. Treinos antigos
 * (criados antes da biblioteca existir) não têm exercicioId/grupoMuscular/mídia.
 */
export interface Exercicio {
  exercicioId?: string;
  nome: string;
  grupoMuscular?: GrupoMuscular;
  tipoMidia?: TipoMidiaExercicio;
  urlMidia?: string;
  series: number;
  repeticoes: number;
  carga: string;
  descanso: string;
  observacoes?: string;
  ordem?: number;
}

export interface Treino {
  id: string;
  alunoId: string; // denormalizado a partir do caminho alunos/{alunoId}/...
  alunoNome: string; // denormalizado no momento da criação, evita um lookup por card
  titulo: string;
  criadoPor: string;
  dataCriacao: string; // ISO datetime
  ativo: boolean;
  exercicios: Exercicio[];
}

export interface ExecucaoTreino {
  id: string;
  treinoId: string;
  treinoTitulo: string;
  data: string; // ISO datetime da conclusão
  horaInicio: string;
  horaFim: string;
  duracaoMin: number;
  exerciciosConcluidos: number;
  totalExercicios: number;
  criadoEm?: unknown;
}

export type UsuarioPerfil = "administrador" | "personal" | "aluno";

export interface Usuario {
  id: string; // uid do Firebase Auth
  nome: string;
  email: string;
  perfil: UsuarioPerfil;
  status: "ativo" | "inativo";
  alunoId?: string;
  academia?: { nome: string; whatsapp?: string | null };
  criadoEm?: unknown;
  ultimoLogin?: unknown;
}

export interface LogAuditoria {
  id: string;
  usuarioId: string | null;
  acao: string;
  alvoId?: string | null;
  detalhes: string;
  timestamp: unknown; // Firestore Timestamp (serverTimestamp) ou string ISO
}
