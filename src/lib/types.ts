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

export interface Exercicio {
  nome: string;
  series: number;
  repeticoes: number;
  carga: string;
  descanso: string;
  observacoes?: string;
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
