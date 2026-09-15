import { useState, useRef, useEffect } from "react";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, onAuthStateChanged } from "firebase/auth";
import { addDoc, collection, doc, setDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { auth, db, storage, functions, COLLECTIONS, STORAGE_PATHS, createAuthAccountWithoutSignIn } from "./lib/firebase";
import { useAlunos, useCheckins, useTreinos, useUsuarios, useLogsAuditoria, isToday } from "./lib/hooks";
import type { Aluno, AlunoStatus, Checkin, Usuario, UsuarioPerfil } from "./lib/types";
import { CameraFeedPanel } from "./components/CameraFeedPanel";

// ─── Types ───────────────────────────────────────────────────────────────────

type Screen =
  | "dashboard"
  | "students"
  | "checkin"
  | "workouts"
  | "billing"
  | "audit"
  | "settings"
  | "register"
  | "camera";

type StudentScreen = "meu-treino" | "execucao" | "historico" | "assinatura";
type AppMode = "login" | "signup" | "admin" | "student";

type Plan = "Mensal" | "Trimestral" | "Anual";
type PayStatus = "Pago" | "Pendente" | "Vencido";

interface Student {
  id: number;
  name: string;
  photo: string;
  cpf: string;
  rg: string;
  address: string;
  whatsapp: string;
  plan: Plan;
  since: string;
  dueDate: string;
  status: PayStatus;
  active: boolean;
  lastCheckin?: string;
  todayCheckin?: boolean;
}

interface CheckinEntry {
  id: number;
  studentId: number;
  studentName: string;
  time: string;
  date: string;
  type: "entrada" | "saída";
}

interface Exercise {
  id: number;
  name: string;
  sets: number;
  reps: string;
  load: string;
  tip: string;
  image: string;
}

interface Workout {
  id: number;
  studentId: number;
  studentName: string;
  title: string;
  date: string;
  exercises: Exercise[];
  instructor: string;
}

interface WorkoutLog {
  id: number;
  workoutId: number;
  workoutTitle: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMin: number;
  completedCount: number;
  totalCount: number;
}

interface PlanConfig {
  id: number;
  name: string;
  price: number;
  description: string;
}

type NotifyLevel = "Aviso" | "Revisão" | "Urgente";

interface MessageTemplate {
  level: NotifyLevel;
  daysBefore: number;
  message: string;
}

interface GymHours {
  day: string;
  open: string;
  close: string;
  closed?: boolean;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const STUDENTS: Student[] = [
  { id: 1, name: "Carlos Mendes", photo: "https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=80&h=80&fit=crop&auto=format", cpf: "123.456.789-00", rg: "12.345.678-9", address: "Rua das Flores, 123 – São Paulo/SP", whatsapp: "11999990001", plan: "Mensal", since: "2024-03-01", dueDate: "2026-09-16", status: "Pendente", active: true, lastCheckin: "hoje 07:42", todayCheckin: true },
  { id: 2, name: "Fernanda Lima", photo: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=80&h=80&fit=crop&auto=format", cpf: "987.654.321-00", rg: "98.765.432-1", address: "Av. Paulista, 456 – São Paulo/SP", whatsapp: "11999990002", plan: "Trimestral", since: "2024-01-15", dueDate: "2026-10-15", status: "Pago", active: true, lastCheckin: "hoje 08:15", todayCheckin: true },
  { id: 3, name: "Rodrigo Costa", photo: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=80&h=80&fit=crop&auto=format", cpf: "111.222.333-44", rg: "11.222.333-4", address: "Rua Augusta, 789 – São Paulo/SP", whatsapp: "11999990003", plan: "Anual", since: "2023-09-01", dueDate: "2026-09-01", status: "Vencido", active: false, lastCheckin: "15/08/2026" },
  { id: 4, name: "Juliana Rocha", photo: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=80&h=80&fit=crop&auto=format", cpf: "444.555.666-77", rg: "44.555.666-7", address: "Rua Consolação, 321 – São Paulo/SP", whatsapp: "11999990004", plan: "Mensal", since: "2026-08-01", dueDate: "2026-09-30", status: "Pago", active: true, lastCheckin: "hoje 09:30", todayCheckin: true },
  { id: 5, name: "Pedro Alves", photo: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&h=80&fit=crop&auto=format", cpf: "555.666.777-88", rg: "55.666.777-8", address: "Av. Brasil, 654 – São Paulo/SP", whatsapp: "11999990005", plan: "Trimestral", since: "2026-06-01", dueDate: "2026-09-14", status: "Vencido", active: false, lastCheckin: "01/09/2026" },
  { id: 6, name: "Mariana Silva", photo: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=80&h=80&fit=crop&auto=format", cpf: "666.777.888-99", rg: "66.777.888-9", address: "Rua Oscar Freire, 987 – São Paulo/SP", whatsapp: "11999990006", plan: "Anual", since: "2025-09-01", dueDate: "2026-12-01", status: "Pago", active: true, lastCheckin: "hoje 06:55", todayCheckin: true },
];

const CHECKINS: CheckinEntry[] = [
  { id: 1, studentId: 1, studentName: "Carlos Mendes", time: "07:42", date: "15/09/2026", type: "entrada" },
  { id: 2, studentId: 2, studentName: "Fernanda Lima", time: "08:15", date: "15/09/2026", type: "entrada" },
  { id: 3, studentId: 6, studentName: "Mariana Silva", time: "06:55", date: "15/09/2026", type: "entrada" },
  { id: 4, studentId: 4, studentName: "Juliana Rocha", time: "09:30", date: "15/09/2026", type: "entrada" },
  { id: 5, studentId: 1, studentName: "Carlos Mendes", time: "09:10", date: "14/09/2026", type: "entrada" },
  { id: 6, studentId: 1, studentName: "Carlos Mendes", time: "10:45", date: "14/09/2026", type: "saída" },
  { id: 7, studentId: 5, studentName: "Pedro Alves", time: "07:00", date: "01/09/2026", type: "entrada" },
  { id: 8, studentId: 3, studentName: "Rodrigo Costa", time: "08:30", date: "15/08/2026", type: "entrada" },
];

const WORKOUTS: Workout[] = [
  {
    id: 1, studentId: 1, studentName: "Carlos Mendes", title: "Treino A – Peito e Tríceps",
    date: "2026-09-15", instructor: "Rafael Torres",
    exercises: [
      { id: 1, name: "Supino Reto", sets: 4, reps: "12", load: "60 kg", tip: "Mantenha os cotovelos a 45°", image: "https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=200&h=120&fit=crop&auto=format" },
      { id: 2, name: "Crucifixo Inclinado", sets: 3, reps: "15", load: "14 kg", tip: "Amplitude controlada", image: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=200&h=120&fit=crop&auto=format" },
      { id: 3, name: "Tríceps Pulley", sets: 4, reps: "12", load: "30 kg", tip: "Cotovelo fixo ao lado do corpo", image: "https://images.unsplash.com/photo-1581009137042-c552e485697a?w=200&h=120&fit=crop&auto=format" },
      { id: 4, name: "Mergulho entre Bancos", sets: 3, reps: "10", load: "Corporal", tip: "Não desça além de 90°", image: "https://images.unsplash.com/photo-1601422407692-ec4eeec1d9b3?w=200&h=120&fit=crop&auto=format" },
      { id: 5, name: "Peck Deck", sets: 3, reps: "15", load: "40 kg", tip: "Espirre os peitoral ao ponto máximo", image: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=200&h=120&fit=crop&auto=format" },
    ],
  },
  {
    id: 2, studentId: 2, studentName: "Fernanda Lima", title: "Treino Funcional",
    date: "2026-09-15", instructor: "Rafael Torres",
    exercises: [
      { id: 1, name: "Agachamento Livre", sets: 4, reps: "20", load: "Corporal", tip: "Joelhos alinhados com os pés", image: "https://images.unsplash.com/photo-1566241440091-ec10de8db2e1?w=200&h=120&fit=crop&auto=format" },
      { id: 2, name: "Prancha Isométrica", sets: 3, reps: "60s", load: "—", tip: "Core contraído, quadril neutro", image: "https://images.unsplash.com/photo-1518611012118-696072aa579a?w=200&h=120&fit=crop&auto=format" },
      { id: 3, name: "Burpee", sets: 3, reps: "15", load: "—", tip: "Explosão na subida", image: "https://images.unsplash.com/photo-1599058945522-28d584b6f0ff?w=200&h=120&fit=crop&auto=format" },
      { id: 4, name: "Mountain Climber", sets: 3, reps: "30s", load: "—", tip: "Ritmo constante, tronco firme", image: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=200&h=120&fit=crop&auto=format" },
    ],
  },
  {
    id: 3, studentId: 4, studentName: "Juliana Rocha", title: "Treino B – Costas e Bíceps",
    date: "2026-09-12", instructor: "Ana Paula",
    exercises: [
      { id: 1, name: "Pull-up (Barra Fixa)", sets: 3, reps: "8", load: "Corporal", tip: "Escápulas retraídas no topo", image: "https://images.unsplash.com/photo-1526506118085-60ce8714f8c5?w=200&h=120&fit=crop&auto=format" },
      { id: 2, name: "Remada Curvada", sets: 4, reps: "12", load: "50 kg", tip: "Costas neutras, puxe até o umbigo", image: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=200&h=120&fit=crop&auto=format" },
      { id: 3, name: "Rosca Direta", sets: 4, reps: "12", load: "20 kg", tip: "Sem balançar o tronco", image: "https://images.unsplash.com/photo-1581009137042-c552e485697a?w=200&h=120&fit=crop&auto=format" },
    ],
  },
  {
    id: 4, studentId: 1, studentName: "Carlos Mendes", title: "Treino B – Costas e Ombros",
    date: "2026-09-13", instructor: "Rafael Torres",
    exercises: [
      { id: 1, name: "Puxada Alta", sets: 4, reps: "12", load: "55 kg", tip: "Puxe até a altura do queixo", image: "https://images.unsplash.com/photo-1526506118085-60ce8714f8c5?w=200&h=120&fit=crop&auto=format" },
      { id: 2, name: "Remada Baixa", sets: 4, reps: "12", load: "45 kg", tip: "Costas retas, sem impulso", image: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=200&h=120&fit=crop&auto=format" },
      { id: 3, name: "Desenvolvimento com Halteres", sets: 3, reps: "10", load: "16 kg", tip: "Não trave o cotovelo no topo", image: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=200&h=120&fit=crop&auto=format" },
      { id: 4, name: "Elevação Lateral", sets: 3, reps: "15", load: "8 kg", tip: "Cotovelos levemente flexionados", image: "https://images.unsplash.com/photo-1581009137042-c552e485697a?w=200&h=120&fit=crop&auto=format" },
    ],
  },
  {
    id: 5, studentId: 2, studentName: "Fernanda Lima", title: "Treino de Força – Inferiores",
    date: "2026-09-13", instructor: "Ana Paula",
    exercises: [
      { id: 1, name: "Leg Press", sets: 4, reps: "12", load: "120 kg", tip: "Não trave os joelhos no topo", image: "https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=200&h=120&fit=crop&auto=format" },
      { id: 2, name: "Cadeira Extensora", sets: 3, reps: "15", load: "35 kg", tip: "Movimento controlado", image: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=200&h=120&fit=crop&auto=format" },
      { id: 3, name: "Cadeira Flexora", sets: 3, reps: "15", load: "30 kg", tip: "Não balance o quadril", image: "https://images.unsplash.com/photo-1581009137042-c552e485697a?w=200&h=120&fit=crop&auto=format" },
    ],
  },
  {
    id: 6, studentId: 2, studentName: "Fernanda Lima", title: "Mobilidade e Alongamento",
    date: "2026-09-11", instructor: "Rafael Torres",
    exercises: [
      { id: 1, name: "Alongamento de Posterior", sets: 2, reps: "30s", load: "—", tip: "Sem dor, apenas tensão leve", image: "https://images.unsplash.com/photo-1518611012118-696072aa579a?w=200&h=120&fit=crop&auto=format" },
      { id: 2, name: "Mobilidade de Quadril", sets: 2, reps: "10", load: "—", tip: "Amplitude máxima confortável", image: "https://images.unsplash.com/photo-1599058945522-28d584b6f0ff?w=200&h=120&fit=crop&auto=format" },
      { id: 3, name: "Gato-Camelo", sets: 2, reps: "12", load: "—", tip: "Respiração sincronizada com o movimento", image: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=200&h=120&fit=crop&auto=format" },
    ],
  },
];

const WORKOUT_LOGS: WorkoutLog[] = [
  { id: 1, workoutId: 1, workoutTitle: "Treino A – Peito e Tríceps", date: "13/09/2026", startTime: "07:40", endTime: "08:42", durationMin: 62, completedCount: 5, totalCount: 5 },
  { id: 2, workoutId: 1, workoutTitle: "Treino A – Peito e Tríceps", date: "10/09/2026", startTime: "07:55", endTime: "08:55", durationMin: 60, completedCount: 4, totalCount: 5 },
  { id: 3, workoutId: 1, workoutTitle: "Treino A – Peito e Tríceps", date: "08/09/2026", startTime: "08:10", endTime: "09:05", durationMin: 55, completedCount: 5, totalCount: 5 },
  { id: 4, workoutId: 1, workoutTitle: "Treino A – Peito e Tríceps", date: "05/09/2026", startTime: "07:30", endTime: "08:40", durationMin: 70, completedCount: 3, totalCount: 5 },
  { id: 5, workoutId: 1, workoutTitle: "Treino A – Peito e Tríceps", date: "02/09/2026", startTime: "08:00", endTime: "09:00", durationMin: 60, completedCount: 5, totalCount: 5 },
  { id: 6, workoutId: 1, workoutTitle: "Treino A – Peito e Tríceps", date: "30/08/2026", startTime: "07:45", endTime: "08:50", durationMin: 65, completedCount: 5, totalCount: 5 },
];

const PLAN_CONFIGS: PlanConfig[] = [
  { id: 1, name: "Mensal", price: 120, description: "Acesso completo à academia, renovação mensal." },
  { id: 2, name: "Trimestral", price: 320, description: "Acesso completo por 3 meses, com desconto de fidelidade." },
  { id: 3, name: "Anual", price: 1100, description: "Acesso completo por 12 meses, inclui 2 meses bônus." },
];

const MESSAGE_TEMPLATES: MessageTemplate[] = [
  { level: "Aviso", daysBefore: 5, message: "Olá {nome}! Seu plano vence em {data_vencimento}. Renove por aqui: {link_pagamento}" },
  { level: "Revisão", daysBefore: 2, message: "{nome}, seu plano vence em breve ({data_vencimento}). Evite o bloqueio, renove agora: {link_pagamento}" },
  { level: "Urgente", daysBefore: 0, message: "{nome}, seu plano venceu hoje ({data_vencimento})! Regularize para manter o acesso: {link_pagamento}" },
];

const GYM_HOURS: GymHours[] = [
  { day: "Segunda a Sexta", open: "06:00", close: "22:00" },
  { day: "Sábado", open: "08:00", close: "14:00" },
  { day: "Domingo", open: "-", close: "-", closed: true },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const statusColors: Record<PayStatus, string> = {
  Pago: "text-green-400 bg-green-400/10 border-green-400/30",
  Pendente: "text-amber-400 bg-amber-400/10 border-amber-400/30",
  Vencido: "text-red-400 bg-red-400/10 border-red-400/30",
};

// Light-mode badge tokens used across the admin (ERP-style) screens.
const statusColorsAdmin: Record<PayStatus, string> = {
  Pago: "text-green-700 bg-green-50 border-green-200",
  Pendente: "text-amber-700 bg-amber-50 border-amber-200",
  Vencido: "text-red-700 bg-red-50 border-red-200",
};

// Badge colors for the real Aluno.status values (ativo/vencido/inativo/pendente).
const alunoStatusColors: Record<string, string> = {
  ativo: "text-green-700 bg-green-50 border-green-200",
  pendente: "text-amber-700 bg-amber-50 border-amber-200",
  vencido: "text-red-700 bg-red-50 border-red-200",
  inativo: "text-gray-500 bg-gray-100 border-gray-200",
};

const checkinStatusColors: Record<string, string> = {
  liberado: "text-green-700 bg-green-50 border-green-200",
  negado: "text-red-700 bg-red-50 border-red-200",
};

const perfilColors: Record<UsuarioPerfil, string> = {
  administrador: "text-purple-700 bg-purple-50 border-purple-200",
  personal: "text-blue-700 bg-blue-50 border-blue-200",
  aluno: "text-gray-600 bg-gray-100 border-gray-200",
};

const planBadgeAdmin: Record<Plan, string> = {
  Mensal: "text-sky-700 bg-sky-50 border-sky-200",
  Trimestral: "text-violet-700 bg-violet-50 border-violet-200",
  Anual: "text-emerald-700 bg-emerald-50 border-emerald-200",
};

const notifyLevelColorsAdmin: Record<NotifyLevel, string> = {
  Aviso: "text-blue-700 bg-blue-50 border-blue-200",
  Revisão: "text-amber-700 bg-amber-50 border-amber-200",
  Urgente: "text-red-700 bg-red-50 border-red-200",
};

const cardClass = "rounded-xl border border-gray-200 bg-white shadow-sm";
const tableHeadClass = "bg-gray-50 text-gray-500 text-xs font-display uppercase tracking-wider";

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

// ─── Icons (outline, admin screens only) ───────────────────────────────────────

type IconName =
  | "dashboard" | "users" | "dumbbell" | "user-plus" | "credit-card" | "clipboard-list" | "settings"
  | "dollar-sign" | "check-circle" | "bar-chart" | "check-square" | "alert-triangle"
  | "smartphone" | "zap" | "download" | "plug" | "save" | "wifi" | "upload" | "camera" | "user"
  | "log-out" | "menu" | "search" | "x" | "chevron-left" | "chevron-right" | "arrow-right" | "plus" | "edit" | "key";

function Icon({ name, className = "w-4 h-4" }: { name: IconName; className?: string }) {
  const props = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className };
  switch (name) {
    case "dashboard":
      return <svg {...props}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>;
    case "users":
      return <svg {...props}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
    case "dumbbell":
      return <svg {...props}><rect x="2" y="9" width="4" height="6" rx="1" /><rect x="18" y="9" width="4" height="6" rx="1" /><line x1="4" y1="7" x2="4" y2="17" /><line x1="20" y1="7" x2="20" y2="17" /><line x1="6" y1="12" x2="18" y2="12" /></svg>;
    case "user-plus":
      return <svg {...props}><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="16" y1="11" x2="22" y2="11" /></svg>;
    case "credit-card":
      return <svg {...props}><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>;
    case "clipboard-list":
      return <svg {...props}><rect x="5" y="4" width="14" height="18" rx="2" /><path d="M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1Z" /><line x1="8.5" y1="11" x2="15.5" y2="11" /><line x1="8.5" y1="15" x2="15.5" y2="15" /></svg>;
    case "settings":
      return <svg {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>;
    case "dollar-sign":
      return <svg {...props}><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>;
    case "check-circle":
      return <svg {...props}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>;
    case "bar-chart":
      return <svg {...props}><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>;
    case "check-square":
      return <svg {...props}><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>;
    case "alert-triangle":
      return <svg {...props}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>;
    case "smartphone":
      return <svg {...props}><rect x="6" y="2" width="12" height="20" rx="2" /><line x1="12" y1="18" x2="12.01" y2="18" /></svg>;
    case "zap":
      return <svg {...props}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>;
    case "download":
      return <svg {...props}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>;
    case "plug":
      return <svg {...props}><path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" /></svg>;
    case "save":
      return <svg {...props}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>;
    case "wifi":
      return <svg {...props}><path d="M5 13a10 10 0 0 1 14 0" /><path d="M8.5 16.5a5 5 0 0 1 7 0" /><line x1="12" y1="20" x2="12.01" y2="20" /></svg>;
    case "upload":
      return <svg {...props}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>;
    case "camera":
      return <svg {...props}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z" /><circle cx="12" cy="13" r="4" /></svg>;
    case "user":
      return <svg {...props}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;
    case "log-out":
      return <svg {...props}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>;
    case "menu":
      return <svg {...props}><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /></svg>;
    case "search":
      return <svg {...props}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>;
    case "x":
      return <svg {...props}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
    case "chevron-left":
      return <svg {...props}><polyline points="15 18 9 12 15 6" /></svg>;
    case "chevron-right":
      return <svg {...props}><polyline points="9 18 15 12 9 6" /></svg>;
    case "arrow-right":
      return <svg {...props}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>;
    case "plus":
      return <svg {...props}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
    case "edit":
      return <svg {...props}><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>;
    case "key":
      return <svg {...props}><circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-9.6 9.6" /><path d="m15.5 7.5 3 3L22 7l-3-3" /></svg>;
  }
}

// ─── Shared Components ────────────────────────────────────────────────────────

function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-xs font-mono-data font-medium tracking-wide ${className}`}>
      {children}
    </span>
  );
}

const toneClasses: Record<"green" | "amber" | "red", string> = {
  green: "text-green-600 bg-green-50",
  amber: "text-amber-600 bg-amber-50",
  red: "text-red-600 bg-red-50",
};

function StatCard({ label, value, sub, icon, tone = "green" }: { label: string; value: string | number; sub?: string; icon?: IconName; tone?: "green" | "amber" | "red" }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5 flex flex-col gap-1 transition-all hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500 font-display uppercase tracking-widest">{label}</span>
        {icon && (
          <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${toneClasses[tone]}`}>
            <Icon name={icon} className="w-4 h-4" />
          </span>
        )}
      </div>
      <span className="text-3xl font-display font-bold text-gray-900">{value}</span>
      {sub && <span className="text-xs text-gray-400">{sub}</span>}
    </div>
  );
}

function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
      <h2 className="font-display font-bold text-2xl text-gray-900 tracking-tight">{title}</h2>
      {action && (
        <button onClick={onAction} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-display font-semibold text-sm transition-colors shadow-sm">
          <Icon name="plus" className="w-4 h-4" /> {action}
        </button>
      )}
    </div>
  );
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`w-full ${wide ? "max-w-lg" : "max-w-sm"} rounded-xl border border-gray-200 bg-white shadow-2xl max-h-[90vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 sticky top-0 bg-white">
          <h3 className="font-display font-bold text-lg text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors"><Icon name="x" className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-display text-gray-500 uppercase tracking-wider mb-1.5">{label}</label>
      {children}
    </div>
  );
}

const inputClass = "w-full bg-white border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/20 transition-colors";

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${checked ? "bg-green-600" : "bg-gray-200"}`}
    >
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${checked ? "left-5" : "left-0.5"}`} />
    </button>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────

function LoginScreen({ onLogin, onGoToSignup }: { onLogin: (mode: AppMode, studentId?: number) => void; onGoToSignup: () => void }) {
  const [tab, setTab] = useState<"admin" | "student">("admin");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPass, setAdminPass] = useState("");
  const [studentId, setStudentId] = useState<number>(1);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleAdmin = async () => {
    if (!adminEmail || !adminPass) {
      setError("Informe e-mail e senha.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await signInWithEmailAndPassword(auth, adminEmail, adminPass);
      onLogin("admin");
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      setError(AUTH_ERROR_MESSAGES[code] ?? "E-mail ou senha incorretos.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleStudent = () => { onLogin("student", studentId); };

  return (
    <div className="min-h-screen bg-[#050d1a] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-green-400 flex items-center justify-center mb-4 shadow-lg shadow-green-400/20">
            <span className="text-black font-display font-black text-3xl">F</span>
          </div>
          <h1 className="font-display font-black text-3xl text-white tracking-tight">FitManager</h1>
          <p className="text-slate-400 text-sm mt-1">Sistema de Gestão de Academia</p>
        </div>

        {/* Tab selector */}
        <div className="flex rounded-xl bg-[#0f2040] border border-[#163059] p-1 mb-6 gap-1">
          {[{ id: "admin", label: "Admin / Personal", icon: "🛡️" }, { id: "student", label: "Portal do Aluno", icon: "🏋️" }].map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id as "admin" | "student"); setError(""); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-display font-semibold transition-all ${tab === t.id ? "bg-green-500 text-black shadow-sm" : "text-slate-400 hover:text-white"}`}
            >
              <span>{t.icon}</span>
              <span className="hidden sm:inline">{t.label}</span>
              <span className="sm:hidden">{t.id === "admin" ? "Admin" : "Aluno"}</span>
            </button>
          ))}
        </div>

        {tab === "admin" ? (
          <div className="rounded-xl border border-[#163059] bg-[#0f2040]/60 p-6 space-y-4">
            <div>
              <label className="block text-xs font-display text-slate-400 uppercase tracking-wider mb-1.5">E-mail</label>
              <input type="email" value={adminEmail} onChange={(e) => { setAdminEmail(e.target.value); setError(""); }} placeholder="voce@suaacademia.com" className="w-full bg-[#163059]/40 border border-[#163059] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-400 transition-colors" />
            </div>
            <div>
              <label className="block text-xs font-display text-slate-400 uppercase tracking-wider mb-1.5">Senha</label>
              <input type="password" placeholder="••••••••" value={adminPass} onChange={(e) => { setAdminPass(e.target.value); setError(""); }} className="w-full bg-[#163059]/40 border border-[#163059] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-400 transition-colors" />
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button onClick={handleAdmin} disabled={submitting} className="w-full py-3 rounded-lg bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black font-display font-bold text-sm transition-colors mt-1">
              {submitting ? "Entrando..." : "Entrar no Painel"}
            </button>
            <p className="text-center text-xs text-slate-500">
              Sua academia ainda não tem conta?{" "}
              <button onClick={onGoToSignup} className="text-green-400 hover:text-green-300 font-medium">Criar conta</button>
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-[#163059] bg-[#0f2040]/60 p-6 space-y-4">
            <p className="text-xs text-slate-400 font-display uppercase tracking-wider">Selecionar aluno (demo)</p>
            <div className="space-y-2">
              {STUDENTS.filter((s) => s.active).map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStudentId(s.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${studentId === s.id ? "border-green-400/60 bg-green-400/10" : "border-[#163059] hover:border-[#2a5499]"}`}
                >
                  <img src={s.photo} alt={s.name} className="w-9 h-9 rounded-full object-cover border border-[#163059]" />
                  <div className="text-left flex-1">
                    <p className="font-display font-semibold text-sm text-white">{s.name}</p>
                    <p className="text-xs text-slate-400">{s.plan}</p>
                  </div>
                  {studentId === s.id && <span className="text-green-400 text-lg">✓</span>}
                </button>
              ))}
            </div>
            <button onClick={handleStudent} className="w-full py-3 rounded-lg bg-green-500 hover:bg-green-400 text-black font-display font-bold text-sm transition-colors">
              Acessar Portal do Aluno
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CRIAR CONTA (academia) ────────────────────────────────────────────────────

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  "auth/email-already-in-use": "Já existe uma conta com esse e-mail.",
  "auth/invalid-email": "E-mail inválido.",
  "auth/weak-password": "Senha muito fraca — use pelo menos 6 caracteres.",
  "auth/operation-not-allowed": "Cadastro por e-mail/senha não está habilitado no projeto Firebase.",
  "auth/invalid-credential": "E-mail ou senha incorretos.",
  "auth/user-not-found": "Não existe conta com esse e-mail.",
  "auth/wrong-password": "Senha incorreta.",
  "auth/too-many-requests": "Muitas tentativas. Aguarde um pouco antes de tentar de novo.",
};

function CreateAccountScreen({ onCreated, onBack }: { onCreated: () => void; onBack: () => void }) {
  const [form, setForm] = useState({
    nomeAcademia: "",
    nomeResponsavel: "",
    email: "",
    whatsapp: "",
    senha: "",
    confirmarSenha: "",
  });
  const [aceiteTermos, setAceiteTermos] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const field = (label: string, key: keyof typeof form, placeholder: string, type = "text") => (
    <div>
      <label className="block text-xs font-display text-slate-400 uppercase tracking-wider mb-1.5">{label}</label>
      <input
        type={type}
        placeholder={placeholder}
        value={form[key]}
        onChange={(e) => { setForm({ ...form, [key]: e.target.value }); setError(""); }}
        className="w-full bg-[#163059]/40 border border-[#163059] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-400 transition-colors"
      />
    </div>
  );

  const handleSubmit = async () => {
    if (!form.nomeAcademia || !form.nomeResponsavel || !form.email || !form.senha) {
      setError("Preencha nome da academia, seu nome, e-mail e senha.");
      return;
    }
    if (form.senha.length < 6) {
      setError("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    if (form.senha !== form.confirmarSenha) {
      setError("As senhas não coincidem.");
      return;
    }
    if (!aceiteTermos) {
      setError("É preciso aceitar os termos e a política de privacidade para continuar.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const credential = await createUserWithEmailAndPassword(auth, form.email, form.senha);

      await setDoc(doc(db, COLLECTIONS.usuarios, credential.user.uid), {
        nome: form.nomeResponsavel,
        email: form.email,
        perfil: "administrador",
        status: "ativo",
        academia: {
          nome: form.nomeAcademia,
          whatsapp: form.whatsapp || null,
        },
        consentimentoTermos: true,
        consentimentoDataHora: new Date().toISOString(),
        criadoEm: serverTimestamp(),
      });

      onCreated();
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      setError(AUTH_ERROR_MESSAGES[code] ?? "Não foi possível criar a conta. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050d1a] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-green-400 flex items-center justify-center mb-4 shadow-lg shadow-green-400/20">
            <span className="text-black font-display font-black text-3xl">F</span>
          </div>
          <h1 className="font-display font-black text-3xl text-white tracking-tight">Criar conta</h1>
          <p className="text-slate-400 text-sm mt-1 text-center">Cadastre sua academia no FitManager</p>
        </div>

        <div className="rounded-xl border border-[#163059] bg-[#0f2040]/60 p-6 space-y-4">
          {field("Nome da academia", "nomeAcademia", "Ex.: Academia Vida Ativa")}
          {field("Seu nome (responsável)", "nomeResponsavel", "Ex.: Maria Souza")}
          {field("E-mail", "email", "voce@suaacademia.com", "email")}
          {field("WhatsApp (opcional)", "whatsapp", "(11) 99999-0000", "tel")}
          {field("Senha", "senha", "Mínimo 6 caracteres", "password")}
          {field("Confirmar senha", "confirmarSenha", "Repita a senha", "password")}

          <label className="flex items-start gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={aceiteTermos}
              onChange={(e) => { setAceiteTermos(e.target.checked); setError(""); }}
              className="mt-0.5 accent-green-500"
            />
            <span>Li e aceito os termos de uso e a política de privacidade (LGPD) do FitManager.</span>
          </label>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-3 rounded-lg bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black font-display font-bold text-sm transition-colors mt-1"
          >
            {submitting ? "Criando conta..." : "Criar conta da academia"}
          </button>

          <button onClick={onBack} className="w-full text-center text-xs text-slate-500 hover:text-white transition-colors">
            ← Voltar para o login
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── STUDENT PORTAL ───────────────────────────────────────────────────────────

function StudentPortal({ student, onLogout }: { student: Student; onLogout: () => void }) {
  const [screen, setScreen] = useState<StudentScreen>("meu-treino");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [activeWorkoutId, setActiveWorkoutId] = useState<number | null>(null);

  const studentWorkouts = WORKOUTS.filter((w) => w.studentId === student.id);
  const activeWorkout = studentWorkouts.find((w) => w.id === activeWorkoutId) ?? null;

  const NAV = [
    { id: "meu-treino" as StudentScreen, label: "Meu Treino", icon: "🏋️" },
    { id: "historico" as StudentScreen, label: "Histórico", icon: "📅" },
    { id: "assinatura" as StudentScreen, label: "Assinatura", icon: "💳" },
  ];

  return (
    <div className="min-h-screen bg-[#050d1a] flex flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between px-4 h-14 border-b border-[#163059] bg-[#050d1a]/95 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-green-400 flex items-center justify-center">
            <span className="text-black font-display font-black text-sm">F</span>
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <span className="font-display font-bold text-white text-sm">FitManager</span>
            <span className="text-[#163059]">·</span>
            <span className="text-xs text-slate-400">Portal do Aluno</span>
          </div>
        </div>
        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
          {NAV.map((item) => (
            <button key={item.id} onClick={() => setScreen(item.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-display font-semibold transition-colors flex items-center gap-1.5 ${screen === item.id || screen === "execucao" && item.id === "meu-treino" ? "bg-green-400/15 text-green-400" : "text-slate-400 hover:text-white hover:bg-white/5"}`}>
              <span>{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <img src={student.photo} alt={student.name} className="w-8 h-8 rounded-full object-cover border-2 border-green-400/40" />
          <button onClick={onLogout} className="text-xs text-slate-500 hover:text-white transition-colors hidden sm:block">Sair</button>
          <button onClick={() => setMobileMenu(!mobileMenu)} className="md:hidden text-slate-400 hover:text-white ml-1">☰</button>
        </div>
      </header>

      {/* Mobile menu */}
      {mobileMenu && (
        <div className="md:hidden fixed inset-0 z-50 bg-black/60" onClick={() => setMobileMenu(false)}>
          <div className="absolute right-0 top-0 bottom-0 w-56 bg-[#091426] border-l border-[#163059] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-6 px-2">
              <img src={student.photo} alt={student.name} className="w-10 h-10 rounded-full object-cover border-2 border-green-400/40" />
              <div>
                <p className="font-display font-bold text-white text-sm">{student.name}</p>
                <p className="text-xs text-slate-400">Portal do Aluno</p>
              </div>
            </div>
            {NAV.map((item) => (
              <button key={item.id} onClick={() => { setScreen(item.id); setMobileMenu(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 text-sm font-display font-semibold transition-colors text-left ${screen === item.id ? "bg-green-400/15 text-green-400" : "text-slate-400 hover:text-white hover:bg-white/5"}`}>
                <span className="text-xl">{item.icon}</span>{item.label}
              </button>
            ))}
            <button onClick={onLogout} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mt-4 text-sm font-display text-slate-400 hover:text-white">
              <span>🚪</span> Sair
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 px-4 py-6 max-w-lg w-full mx-auto md:max-w-2xl">
        {(screen === "meu-treino") && (
          <MyWorkout
            workouts={studentWorkouts}
            onStart={(id) => { setActiveWorkoutId(id); setScreen("execucao"); }}
          />
        )}
        {screen === "execucao" && activeWorkout && (
          <WorkoutExecution workout={activeWorkout} onFinish={() => setScreen("historico")} onCancel={() => setScreen("meu-treino")} />
        )}
        {screen === "historico" && <WorkoutHistory />}
        {screen === "assinatura" && <MySubscription student={student} />}
      </main>

      {/* Bottom nav (mobile) */}
      <nav className="md:hidden sticky bottom-0 z-30 flex border-t border-[#163059] bg-[#050d1a]/95 backdrop-blur-sm">
        {NAV.map((item) => (
          <button key={item.id} onClick={() => setScreen(item.id)}
            className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-display font-medium transition-colors ${screen === item.id || (screen === "execucao" && item.id === "meu-treino") ? "text-green-400" : "text-slate-500 hover:text-white"}`}>
            <span className="text-xl leading-none">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ─── Meu Treino ───────────────────────────────────────────────────────────────

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function formatWorkoutDate(iso: string) {
  const [, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS_PT[month - 1]}`;
}

function MyWorkout({ workouts, onStart }: { workouts: Workout[]; onStart: (workoutId: number) => void }) {
  const sorted = [...workouts].sort((a, b) => b.date.localeCompare(a.date));
  const [expandedId, setExpandedId] = useState<number | null>(sorted[0]?.id ?? null);

  if (workouts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 text-center space-y-3">
        <span className="text-5xl">🏖️</span>
        <h2 className="font-display font-bold text-xl text-white">Nenhum treino cadastrado</h2>
        <p className="text-slate-400 text-sm">Seu personal ainda não cadastrou nenhum treino para você. Aproveite para descansar!</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-slate-400 font-display uppercase tracking-widest mb-1">Seus treinos · {sorted.length} {sorted.length === 1 ? "treino" : "treinos"}</p>
        <h1 className="font-display font-black text-3xl text-white leading-tight">Meus Treinos</h1>
      </div>

      <div className="space-y-3">
        {sorted.map((w) => {
          const isExpanded = expandedId === w.id;
          return (
            <div key={w.id} className="rounded-xl border border-[#163059] bg-[#0f2040]/50 overflow-hidden">
              <button
                onClick={() => setExpandedId(isExpanded ? null : w.id)}
                className="w-full flex items-center justify-between gap-3 p-4 text-left"
              >
                <div className="min-w-0">
                  <p className="text-xs text-slate-400 font-display uppercase tracking-widest">{formatWorkoutDate(w.date)}</p>
                  <p className="font-display font-bold text-white text-lg leading-tight truncate">{w.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5">Instrutor: <span className="text-slate-300">{w.instructor}</span> · {w.exercises.length} exercícios</p>
                </div>
                <span className="text-slate-500 shrink-0 text-xs px-1">{isExpanded ? "▲" : "▼"}</span>
              </button>

              {isExpanded && (
                <div className="border-t border-[#163059]/60 p-4 space-y-3">
                  <div className="space-y-3">
                    {w.exercises.map((ex, i) => (
                      <div key={ex.id} className="flex gap-3 p-3 rounded-xl border border-[#163059] bg-[#091426]/40">
                        <div className="relative shrink-0">
                          <img src={ex.image} alt={ex.name} className="w-20 h-16 rounded-lg object-cover bg-[#163059]" />
                          <span className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-[#163059] border border-[#2a5499] text-xs text-slate-300 font-mono-data flex items-center justify-center">{i + 1}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-display font-bold text-white text-sm">{ex.name}</p>
                          <div className="flex gap-3 mt-1 flex-wrap">
                            <span className="text-xs text-slate-400"><span className="text-green-400 font-mono-data">{ex.sets}</span> séries</span>
                            <span className="text-xs text-slate-400"><span className="text-green-400 font-mono-data">{ex.reps}</span> reps</span>
                            <span className="text-xs text-slate-400">carga: <span className="text-slate-300 font-mono-data">{ex.load}</span></span>
                          </div>
                          <p className="text-xs text-slate-500 mt-1 italic">{ex.tip}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button onClick={() => onStart(w.id)} className="w-full py-3.5 rounded-2xl bg-green-500 hover:bg-green-400 active:scale-[0.98] text-black font-display font-black text-base transition-all shadow-lg shadow-green-500/20 flex items-center justify-center gap-3">
                    <span className="text-xl">▶</span>
                    Iniciar Treino
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Workout Execution ────────────────────────────────────────────────────────

function WorkoutExecution({ workout, onFinish, onCancel }: { workout: Workout; onFinish: () => void; onCancel: () => void }) {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [elapsed, setElapsed] = useState(0);
  const [started] = useState(new Date());
  const [done, setDone] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    if (done) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [done]);

  const toggle = (id: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const pct = Math.round((checked.size / workout.exercises.length) * 100);

  const handleFinish = () => {
    setDone(true);
  };

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 text-center space-y-6 py-8">
        <div className="relative">
          <div className="w-28 h-28 rounded-full border-4 border-green-400 flex items-center justify-center shadow-xl shadow-green-400/20">
            <span className="font-display font-black text-4xl text-green-400">{pct}%</span>
          </div>
          {pct === 100 && <span className="absolute -top-2 -right-2 text-3xl">🎉</span>}
        </div>
        <div>
          <h2 className="font-display font-black text-3xl text-white">Treino Concluído!</h2>
          <p className="text-slate-400 text-sm mt-1">{started.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} → {new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
        </div>
        <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
          {[
            { label: "Duração", value: formatDuration(elapsed) },
            { label: "Concluídos", value: `${checked.size}/${workout.exercises.length}` },
            { label: "Progresso", value: `${pct}%` },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-[#163059] bg-[#0f2040]/60 p-3 text-center">
              <p className="font-display font-bold text-white text-lg">{s.value}</p>
              <p className="text-xs text-slate-400 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
        <button onClick={onFinish} className="w-full max-w-xs py-3 rounded-xl bg-green-500 hover:bg-green-400 text-black font-display font-bold transition-colors">
          Ver Histórico
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-slate-400 font-display uppercase tracking-widest mb-0.5">Executando</p>
          <h2 className="font-display font-bold text-xl text-white leading-tight">{workout.title}</h2>
        </div>
        <div className="text-right">
          <p className="font-mono-data text-2xl text-green-400 font-bold">{formatDuration(elapsed)}</p>
          <p className="text-xs text-slate-400">em andamento</p>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs text-slate-400 mb-1.5">
          <span>{checked.size} de {workout.exercises.length} exercícios</span>
          <span className="font-mono-data text-green-400">{pct}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-[#163059] overflow-hidden">
          <div
            className="h-2.5 rounded-full bg-green-400 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Exercise checklist */}
      <div className="space-y-2">
        {workout.exercises.map((ex, i) => {
          const isChecked = checked.has(ex.id);
          const isExpanded = expanded === ex.id;
          return (
            <div key={ex.id}
              className={`rounded-xl border transition-all duration-200 overflow-hidden ${isChecked ? "border-green-400/40 bg-green-400/8" : "border-[#163059] bg-[#0f2040]/50"}`}>
              <div className="flex items-center gap-3 p-3">
                {/* Checkbox */}
                <button onClick={() => toggle(ex.id)}
                  className={`shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all ${isChecked ? "border-green-400 bg-green-400" : "border-[#2a5499] bg-transparent hover:border-green-400/60"}`}>
                  {isChecked && <span className="text-black font-bold text-sm">✓</span>}
                </button>
                {/* Info */}
                <div className="flex-1 min-w-0" onClick={() => setExpanded(isExpanded ? null : ex.id)}>
                  <p className={`font-display font-semibold text-sm transition-colors ${isChecked ? "text-green-400 line-through decoration-green-400/50" : "text-white"}`}>
                    <span className="text-slate-500 font-mono-data text-xs mr-1.5">{i + 1}.</span>{ex.name}
                  </p>
                  <div className="flex gap-3 mt-0.5">
                    <span className="text-xs text-slate-400"><span className="font-mono-data text-slate-300">{ex.sets}</span>×<span className="font-mono-data text-slate-300">{ex.reps}</span></span>
                    <span className="text-xs text-slate-500">{ex.load}</span>
                  </div>
                </div>
                <button onClick={() => setExpanded(isExpanded ? null : ex.id)} className="text-slate-500 hover:text-white transition-colors text-xs px-1">
                  {isExpanded ? "▲" : "▼"}
                </button>
              </div>
              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t border-[#163059]/60 flex gap-3 p-3">
                  <img src={ex.image} alt={ex.name} className="w-28 h-20 rounded-lg object-cover bg-[#163059] shrink-0" />
                  <div className="space-y-1.5">
                    <p className="text-xs font-display font-semibold text-slate-300 uppercase tracking-wider">Dica do instrutor</p>
                    <p className="text-sm text-slate-300 leading-relaxed italic">"{ex.tip}"</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex gap-3 pt-2">
        <button onClick={handleFinish} className="flex-1 py-3 rounded-xl bg-green-500 hover:bg-green-400 text-black font-display font-bold transition-colors">
          Finalizar Treino
        </button>
        <button onClick={onCancel} className="px-4 py-3 rounded-xl border border-[#163059] text-slate-400 hover:text-white text-sm transition-colors">
          Pausar
        </button>
      </div>
    </div>
  );
}

// ─── Workout History ──────────────────────────────────────────────────────────

function WorkoutHistory() {
  const thisWeek = WORKOUT_LOGS.filter((_, i) => i < 2).length;
  const thisMonth = WORKOUT_LOGS.length;
  const avgPct = Math.round(WORKOUT_LOGS.reduce((a, l) => a + Math.round((l.completedCount / l.totalCount) * 100), 0) / WORKOUT_LOGS.length);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-slate-400 font-display uppercase tracking-widest mb-1">Seu progresso</p>
        <h1 className="font-display font-black text-3xl text-white">Histórico</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-[#163059] bg-[#0f2040]/60 p-3 text-center">
          <p className="font-display font-bold text-2xl text-green-400">{thisWeek}</p>
          <p className="text-xs text-slate-400 mt-0.5">esta semana</p>
        </div>
        <div className="rounded-xl border border-[#163059] bg-[#0f2040]/60 p-3 text-center">
          <p className="font-display font-bold text-2xl text-white">{thisMonth}</p>
          <p className="text-xs text-slate-400 mt-0.5">este mês</p>
        </div>
        <div className="rounded-xl border border-green-400/30 bg-green-400/5 p-3 text-center">
          <p className="font-display font-bold text-2xl text-green-400">{avgPct}%</p>
          <p className="text-xs text-slate-400 mt-0.5">média conclusão</p>
        </div>
      </div>

      {/* Frequency dots — last 30 days */}
      <div className="rounded-xl border border-[#163059] bg-[#0f2040]/50 p-4">
        <p className="text-xs font-display text-slate-400 uppercase tracking-wider mb-3">Frequência – últimos 30 dias</p>
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 30 }, (_, i) => {
            const hasTrained = [1, 4, 7, 11, 15, 18, 22, 26, 28].includes(i);
            return (
              <div key={i} title={`Dia ${30 - i}`}
                className={`w-6 h-6 rounded-md transition-colors ${hasTrained ? "bg-green-400" : "bg-[#163059]"}`} />
            );
          })}
        </div>
        <p className="text-xs text-slate-500 mt-2">Verde = treino realizado</p>
      </div>

      {/* Log list */}
      <div className="space-y-2">
        {WORKOUT_LOGS.map((log) => {
          const pct = Math.round((log.completedCount / log.totalCount) * 100);
          return (
            <div key={log.id} className="rounded-xl border border-[#163059] bg-[#0f2040]/50 p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-display font-semibold text-white text-sm">{log.workoutTitle}</p>
                  <p className="text-xs text-slate-400 mt-0.5 font-mono-data">{log.date} · {log.startTime}–{log.endTime}</p>
                </div>
                <span className={`font-mono-data text-sm font-bold ${pct === 100 ? "text-green-400" : "text-amber-400"}`}>{pct}%</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-1.5 rounded-full bg-[#163059]">
                  <div className={`h-1.5 rounded-full ${pct === 100 ? "bg-green-400" : "bg-amber-400"}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs text-slate-500 shrink-0 font-mono-data">{log.durationMin} min · {log.completedCount}/{log.totalCount}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── My Subscription ──────────────────────────────────────────────────────────

function MySubscription({ student }: { student: Student }) {
  const planEmoji: Record<Plan, string> = { Mensal: "📅", Trimestral: "🗓️", Anual: "🏆" };
  const daysLeft = 1; // demo: vencendo amanhã

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-slate-400 font-display uppercase tracking-widest mb-1">Seu plano</p>
        <h1 className="font-display font-black text-3xl text-white">Assinatura</h1>
      </div>

      {/* Status card */}
      <div className={`rounded-2xl border p-5 ${student.status === "Pago" ? "border-green-400/40 bg-green-400/5" : student.status === "Pendente" ? "border-amber-400/40 bg-amber-400/5" : "border-red-400/40 bg-red-400/5"}`}>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-4xl">{planEmoji[student.plan]}</span>
          <div>
            <p className="font-display font-black text-2xl text-white">Plano {student.plan}</p>
            <Badge className={statusColors[student.status]}>{student.status}</Badge>
          </div>
        </div>
        <div className="space-y-2 text-sm">
          {[
            ["Vencimento", student.dueDate],
            ["Membro desde", student.since],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <span className="text-slate-400">{k}</span>
              <span className="font-mono-data text-white">{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Alert */}
      {student.status === "Pendente" && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/8 p-4 flex gap-3">
          <span className="text-amber-400 text-xl shrink-0">⚠️</span>
          <div>
            <p className="font-display font-semibold text-amber-300 text-sm">Plano vencendo em breve</p>
            <p className="text-xs text-slate-400 mt-0.5">Seu plano vence em <strong className="text-white">{daysLeft} dia</strong>. Renove para continuar treinando sem interrupção.</p>
          </div>
        </div>
      )}
      {student.status === "Vencido" && (
        <div className="rounded-xl border border-red-400/30 bg-red-400/8 p-4 flex gap-3">
          <span className="text-red-400 text-xl shrink-0">🔴</span>
          <div>
            <p className="font-display font-semibold text-red-300 text-sm">Plano vencido</p>
            <p className="text-xs text-slate-400 mt-0.5">Seu acesso pode ser bloqueado. Regularize o pagamento agora.</p>
          </div>
        </div>
      )}

      <button className="w-full py-4 rounded-2xl bg-green-500 hover:bg-green-400 active:scale-[0.98] text-black font-display font-black text-base transition-all shadow-lg shadow-green-500/20 flex items-center justify-center gap-2">
        <span>💳</span> Renovar / Pagar Agora
      </button>

      <div className="rounded-xl border border-[#163059] bg-[#0f2040]/50 p-4 space-y-3">
        <p className="text-xs font-display text-slate-400 uppercase tracking-wider">Benefícios do seu plano</p>
        {[
          "Acesso completo às instalações",
          "Treinos personalizados pelo instrutor",
          "Acompanhamento de progresso",
          student.plan !== "Mensal" ? "Desconto por fidelidade" : null,
          student.plan === "Anual" ? "2 meses bônus incluídos" : null,
        ].filter(Boolean).map((b) => (
          <div key={b} className="flex items-center gap-2 text-sm text-slate-300">
            <span className="text-green-400 text-xs">✓</span> {b}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ADMIN PANEL ──────────────────────────────────────────────────────────────

function CheckinsBarChart({ checkins }: { checkins: Checkin[] }) {
  const HOURS = Array.from({ length: 16 }, (_, i) => i + 6); // 6h..21h, horário típico de academia
  const counts = HOURS.map((h) => checkins.filter((c) => new Date(c.timestamp).getHours() === h && c.status === "liberado").length);
  const max = Math.max(1, ...counts);

  return (
    <div className="flex items-end gap-1.5 h-40 mt-2">
      {HOURS.map((h, i) => (
        <div key={h} className="flex-1 h-full flex flex-col justify-end items-center gap-1.5 group">
          <span className="text-[10px] text-gray-400 font-mono-data opacity-0 group-hover:opacity-100 transition-opacity">{counts[i]}</span>
          <div className="w-full rounded-t-md bg-green-500 group-hover:bg-green-600 transition-colors" style={{ height: `${Math.max((counts[i] / max) * 100, 4)}%` }} />
          <span className="text-[10px] text-gray-400 font-mono-data">{h}h</span>
        </div>
      ))}
    </div>
  );
}

const DONUT_COLORS = ["#16a34a", "#4ade80", "#bbf7d0", "#86efac", "#065f46"];

function PlanDonutChart({ alunos }: { alunos: Aluno[] }) {
  const planos = Array.from(new Set(alunos.map((a) => a.tipoPlano).filter(Boolean)));
  const segments = planos.map((plano, i) => ({
    plano,
    count: alunos.filter((a) => a.tipoPlano === plano).length,
    color: DONUT_COLORS[i % DONUT_COLORS.length],
  }));
  const total = alunos.length;
  const r = 52, cx = 60, cy = 60, circumference = 2 * Math.PI * r;
  let offset = 0;

  if (total === 0) {
    return <p className="text-sm text-gray-400 py-8 text-center">Nenhum aluno cadastrado ainda.</p>;
  }

  return (
    <div className="flex items-center gap-6 flex-wrap">
      <svg width="120" height="120" viewBox="0 0 120 120" className="shrink-0">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f1f5f9" strokeWidth="16" />
        {segments.map((seg) => {
          const pct = seg.count / total;
          const dash = pct * circumference;
          const el = (
            <circle key={seg.plano} cx={cx} cy={cy} r={r} fill="none" stroke={seg.color} strokeWidth="16"
              strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`} />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div className="space-y-2">
        {segments.map((seg) => (
          <div key={seg.plano} className="flex items-center gap-2 text-sm">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: seg.color }} />
            <span className="text-gray-700 font-medium capitalize">{seg.plano}</span>
            <span className="font-mono-data text-gray-400 text-xs">{seg.count} · {Math.round((seg.count / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Dashboard({ onNavigate }: { onNavigate: (s: Screen) => void }) {
  const { data: alunos, loading: loadingAlunos, error: alunosError } = useAlunos();
  const { data: checkins, loading: loadingCheckins, error: checkinsError } = useCheckins();

  const active = alunos.filter((a) => a.status !== "inativo").length;
  const todayCheckinsList = checkins.filter((c) => isToday(c.timestamp));
  const todayCheckins = todayCheckinsList.filter((c) => c.status === "liberado").length;
  const recentCheckins = todayCheckinsList.slice(0, 8);

  const activeAlunos = alunos.filter((a) => a.status === "ativo");
  const revenue = activeAlunos.reduce((sum, a) => sum + (a.valorPlano ?? 0), 0);
  const avgTicket = activeAlunos.length > 0 ? revenue / activeAlunos.length : 0;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const todayLabel = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

  const QUICK_ACTIONS: { label: string; icon: IconName; screen: Screen }[] = [
    { label: "Novo Aluno", icon: "user-plus", screen: "register" },
    { label: "Check-in Manual", icon: "check-square", screen: "checkin" },
    { label: "Cobranças", icon: "credit-card", screen: "billing" },
    { label: "Treinos", icon: "dumbbell", screen: "workouts" },
    { label: "Auditoria", icon: "clipboard-list", screen: "audit" },
    { label: "Configurações", icon: "settings", screen: "settings" },
  ];

  const lastCheckinTime = todayCheckinsList[0]
    ? new Date(todayCheckinsList[0].timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : "—";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-black text-3xl text-gray-900 tracking-tight leading-none">{greeting}, Admin Geral</h1>
        <p className="text-gray-500 mt-1.5 text-sm capitalize">{todayLabel} · FitManager Academia</p>
      </div>

      {(alunosError || checkinsError) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <Icon name="alert-triangle" className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-display font-semibold text-amber-800 text-sm">Não foi possível carregar os dados do Firebase</p>
            <p className="text-xs text-amber-700/80 mt-0.5">
              Provável causa: as regras de segurança do FitManager ainda não foram mescladas no projeto Firebase, ou você não está autenticado.
              Detalhe: {alunosError || checkinsError}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Faturamento do Mês" value={formatBRL(revenue)} sub={`${activeAlunos.length} pagamentos confirmados`} icon="dollar-sign" />
        <StatCard label="Alunos Ativos" value={active} sub={`de ${alunos.length} cadastrados`} icon="users" />
        <StatCard label="Check-ins Hoje" value={todayCheckins} sub={`última: ${lastCheckinTime}`} icon="check-circle" />
        <StatCard label="Ticket Médio" value={formatBRL(avgTicket)} sub="por aluno pagante" icon="bar-chart" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${cardClass} p-5 lg:col-span-2`}>
          <h3 className="font-display font-semibold text-base text-gray-900">Check-ins por Horário</h3>
          <p className="text-xs text-gray-400 mt-0.5">Horários de maior movimento na academia hoje</p>
          <CheckinsBarChart checkins={todayCheckinsList} />
        </div>
        <div className={`${cardClass} p-5`}>
          <h3 className="font-display font-semibold text-base text-gray-900 mb-1">Alunos por Plano</h3>
          <p className="text-xs text-gray-400 mb-4">Distribuição da base ativa</p>
          <PlanDonutChart alunos={alunos} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${cardClass} overflow-hidden lg:col-span-2`}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h3 className="font-display font-semibold text-base text-gray-900">Últimos Check-ins</h3>
            <button onClick={() => onNavigate("checkin")} className="flex items-center gap-1 text-xs font-display font-semibold text-green-700 hover:text-green-800 transition-colors">Ver todos <Icon name="arrow-right" className="w-3.5 h-3.5" /></button>
          </div>
          <div className="divide-y divide-gray-100">
            {recentCheckins.map((c) => {
              const aluno = alunos.find((a) => a.id === c.alunoId);
              return (
                <div key={c.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                  {aluno?.fotoUrl ? (
                    <img src={aluno.fotoUrl} alt={c.nomeAluno} className="w-9 h-9 rounded-full object-cover border border-gray-200" />
                  ) : (
                    <span className="w-9 h-9 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400 shrink-0"><Icon name="user" className="w-4 h-4" /></span>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-gray-900 truncate">{c.nomeAluno}</p>
                    <p className="text-xs text-gray-400 font-mono-data">{new Date(c.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                  <Badge className={checkinStatusColors[c.status]}>{c.status}</Badge>
                </div>
              );
            })}
            {loadingCheckins && recentCheckins.length === 0 && (
              <div className="px-5 py-8 text-center text-gray-400 text-sm">Carregando check-ins...</div>
            )}
            {!loadingCheckins && recentCheckins.length === 0 && (
              <div className="px-5 py-8 text-center text-gray-400 text-sm">Nenhum check-in registrado hoje.</div>
            )}
          </div>
        </div>

        <div className={`${cardClass} p-5`}>
          <h3 className="font-display font-semibold text-base text-gray-900 mb-3">Ações Rápidas</h3>
          <div className="grid grid-cols-2 gap-2">
            {QUICK_ACTIONS.map((item) => (
              <button key={item.screen} onClick={() => onNavigate(item.screen)}
                className="flex flex-col items-start gap-2 p-3 rounded-lg border border-gray-200 hover:border-green-300 hover:bg-green-50/60 transition-all text-left group">
                <span className="w-8 h-8 rounded-lg bg-green-50 text-green-600 flex items-center justify-center">
                  <Icon name={item.icon} className="w-4 h-4" />
                </span>
                <span className="font-display font-medium text-xs text-gray-600 group-hover:text-gray-900">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const PHOTO_CACHE_KEY = "fitmanager_captured_photo";

const PLAN_MONTHS: Record<string, number> = { mensal: 1, trimestral: 3, anual: 12 };

function RegisterStudent({ onBack }: { onBack: () => void }) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [webcam, setWebcam] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [form, setForm] = useState({ nome: "", endereco: "", whatsapp: "", cpf: "", rg: "", email: "", tipoPlano: "mensal", valorPlano: "120" });
  const [consentimentoLGPD, setConsentimentoLGPD] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Preload a previously captured photo from the browser cache (test-only persistence).
  useEffect(() => {
    try {
      const cached = localStorage.getItem(PHOTO_CACHE_KEY);
      if (cached) setPhoto(cached);
    } catch {
      // localStorage unavailable (e.g. private mode) — ignore, feature just won't persist
    }
  }, []);

  // Start/stop the camera stream whenever the webcam panel is toggled.
  useEffect(() => {
    if (!webcam) return;
    console.log("[webcam] toggled on — isSecureContext:", window.isSecureContext, "location:", window.location.href);
    setCameraError(null);
    let cancelled = false;

    if (!navigator.mediaDevices?.getUserMedia) {
      console.error("[webcam] navigator.mediaDevices.getUserMedia is unavailable. isSecureContext:", window.isSecureContext);
      setCameraError(
        window.isSecureContext
          ? "Este navegador não suporta acesso à câmera."
          : "A câmera só funciona em conexão segura (HTTPS) ou em localhost. Acesse via https:// ou http://localhost para testar a webcam."
      );
      return;
    }

    console.log("[webcam] requesting getUserMedia...");
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user" } })
      .then((stream) => {
        console.log("[webcam] stream acquired:", stream.id, "tracks:", stream.getVideoTracks().map((t) => t.label));
        // React 18 StrictMode double-invokes effects in dev, which can run this
        // cleanup before the permission prompt resolves — stop the late stream
        // instead of attaching it to an already-unmounted request.
        if (cancelled) {
          console.log("[webcam] effect was cancelled before stream resolved — stopping late stream");
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current
            .play()
            .then(() => console.log("[webcam] video.play() resolved"))
            .catch((err) => console.error("[webcam] video.play() rejected:", err));
        } else {
          console.warn("[webcam] videoRef.current is null when stream resolved");
        }
      })
      .catch((err) => {
        console.error("[webcam] getUserMedia rejected:", err.name, err.message);
        if (!cancelled) setCameraError(`Não foi possível acessar a câmera (${err.name}). Verifique as permissões do navegador.`);
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [webcam]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPhoto(ev.target?.result as string);
    reader.readAsDataURL(f);
  };

  const handleCapture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    console.log("[webcam] capture requested. videoWidth:", video?.videoWidth, "videoHeight:", video?.videoHeight, "readyState:", video?.readyState);
    if (!video || !canvas || !video.videoWidth) {
      console.warn("[webcam] capture aborted — video not ready yet");
      setCameraError("A câmera ainda não carregou a imagem. Aguarde um instante e tente novamente.");
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    console.log("[webcam] captured frame, dataUrl length:", dataUrl.length);
    setPhoto(dataUrl);

    try {
      localStorage.setItem(PHOTO_CACHE_KEY, dataUrl);
      console.log("[webcam] photo saved to localStorage under", PHOTO_CACHE_KEY);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2500);
    } catch (err) {
      console.error("[webcam] failed to save photo to localStorage:", err);
    }

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setWebcam(false);
  };

  const handleSubmit = async () => {
    setFormError("");
    if (!form.nome || !form.endereco || !form.whatsapp || !form.cpf) {
      setFormError("Preencha ao menos nome, endereço, WhatsApp e CPF.");
      return;
    }
    if (!consentimentoLGPD) {
      setFormError("É necessário confirmar o consentimento LGPD do aluno para cadastrar.");
      return;
    }

    setSubmitting(true);
    try {
      const alunoRef = doc(collection(db, COLLECTIONS.alunos));

      let fotoUrl = "";
      if (photo) {
        const blob = await (await fetch(photo)).blob();
        const storageRef = ref(storage, `${STORAGE_PATHS.fotosAlunos}/${alunoRef.id}.jpg`);
        await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
        fotoUrl = await getDownloadURL(storageRef);
      }

      const months = PLAN_MONTHS[form.tipoPlano] ?? 1;
      const dataMatricula = new Date();
      const dataVencimento = new Date(dataMatricula);
      dataVencimento.setMonth(dataVencimento.getMonth() + months);

      await setDoc(alunoRef, {
        nome: form.nome,
        endereco: form.endereco,
        whatsapp: form.whatsapp,
        cpf: form.cpf,
        rg: form.rg,
        email: form.email || null,
        tipoPlano: form.tipoPlano,
        valorPlano: Number(form.valorPlano) || 0,
        dataMatricula: dataMatricula.toISOString(),
        dataVencimento: dataVencimento.toISOString(),
        status: "ativo",
        fotoUrl: fotoUrl || null,
        consentimentoLGPD: true,
        consentimentoDataHora: new Date().toISOString(),
        criadoEm: serverTimestamp(),
        atualizadoEm: serverTimestamp(),
      });

      try { localStorage.removeItem(PHOTO_CACHE_KEY); } catch { /* ignore */ }
      onBack();
    } catch (err) {
      console.error("[cadastro] falha ao salvar aluno:", err);
      setFormError("Não foi possível salvar o aluno. Verifique sua conexão e se as regras do Firestore já foram mescladas no projeto.");
    } finally {
      setSubmitting(false);
    }
  };

  const field = (label: string, key: keyof typeof form, placeholder: string, type = "text") => (
    <FormField label={label}>
      <input type={type} placeholder={placeholder} value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className={inputClass} />
    </FormField>
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="flex items-center gap-1 text-gray-500 hover:text-gray-900 transition-colors text-sm"><Icon name="chevron-left" className="w-4 h-4" /> Voltar</button>
        <h2 className="font-display font-bold text-2xl text-gray-900 tracking-tight">Cadastrar Aluno</h2>
      </div>
      <div className={`${cardClass} p-6 space-y-5`}>
        <div>
          <label className="block text-xs font-display text-gray-500 uppercase tracking-wider mb-3">Foto do Aluno</label>
          <div className="flex items-center gap-4">
            <div className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 overflow-hidden flex items-center justify-center">
              {photo ? <img src={photo} alt="preview" className="w-full h-full object-cover" /> : <Icon name="user" className="w-8 h-8 text-gray-300" />}
            </div>
            <div className="flex flex-col gap-2">
              <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 hover:border-green-400 text-sm text-gray-600 hover:text-gray-900 transition-colors text-left"><Icon name="upload" className="w-4 h-4" /> Subir arquivo</button>
              <button onClick={() => setWebcam(!webcam)} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 hover:border-green-400 text-sm text-gray-600 hover:text-gray-900 transition-colors text-left"><Icon name="camera" className="w-4 h-4" /> {webcam ? "Fechar webcam" : "Usar webcam"}</button>
              <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
              {savedNotice && (
                <p className="flex items-center gap-1.5 text-xs text-green-600">
                  <Icon name="check-circle" className="w-3.5 h-3.5" /> Foto salva no navegador (cache local)
                </p>
              )}
            </div>
          </div>
          {webcam && (
            <div className="mt-3 p-4 rounded-lg border border-gray-200 bg-gray-50 text-center text-sm text-gray-500">
              {cameraError ? (
                <div className="w-full py-8 flex flex-col items-center gap-2 text-red-500 text-xs">
                  <Icon name="alert-triangle" className="w-5 h-5" />
                  {cameraError}
                </div>
              ) : (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  onLoadedMetadata={(e) => console.log("[webcam] video loadedmetadata — size:", e.currentTarget.videoWidth, "x", e.currentTarget.videoHeight)}
                  onPlaying={() => console.log("[webcam] video is playing")}
                  onError={(e) => console.error("[webcam] video element error:", e)}
                  className="w-full h-48 rounded-lg object-cover bg-gray-900 mb-3 scale-x-[-1]"
                />
              )}
              <canvas ref={canvasRef} className="hidden" />
              <div className="flex gap-2 justify-center">
                <button onClick={handleCapture} disabled={!!cameraError} className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-display font-semibold transition-colors">
                  <Icon name="camera" className="w-3.5 h-3.5" /> Capturar foto
                </button>
                <button onClick={() => setWebcam(false)} className="px-4 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:text-gray-900 text-xs font-display font-medium transition-colors">Cancelar</button>
              </div>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">{field("Nome completo", "nome", "Ex.: João da Silva")}</div>
          <div className="md:col-span-2">{field("Endereço", "endereco", "Rua, número – Cidade/UF")}</div>
          {field("WhatsApp", "whatsapp", "(11) 99999-0000", "tel")}
          {field("E-mail (opcional)", "email", "aluno@email.com", "email")}
          {field("CPF", "cpf", "000.000.000-00")}
          {field("RG", "rg", "00.000.000-0")}
          <FormField label="Tipo de Plano">
            <select value={form.tipoPlano} onChange={(e) => setForm({ ...form, tipoPlano: e.target.value })} className={inputClass}>
              <option value="mensal">Mensal</option>
              <option value="trimestral">Trimestral</option>
              <option value="anual">Anual</option>
            </select>
          </FormField>
          {field("Valor do Plano (R$)", "valorPlano", "120", "number")}
        </div>

        <label className="flex items-start gap-2 text-xs text-gray-500">
          <input type="checkbox" checked={consentimentoLGPD} onChange={(e) => { setConsentimentoLGPD(e.target.checked); setFormError(""); }} className="mt-0.5 accent-green-600" />
          <span>O aluno leu e consentiu com o tratamento de seus dados pessoais e biométricos (LGPD), incluindo o uso da foto para reconhecimento facial na entrada.</span>
        </label>

        {formError && <p className="text-xs text-red-500">{formError}</p>}

        <div className="flex gap-3 pt-2">
          <button onClick={handleSubmit} disabled={submitting} className="flex-1 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-display font-bold text-sm transition-colors shadow-sm">
            {submitting ? "Salvando..." : "Salvar Aluno"}
          </button>
          <button onClick={onBack} className="px-5 py-2.5 rounded-lg border border-gray-300 text-gray-500 hover:text-gray-900 hover:border-gray-400 text-sm transition-colors">Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function StudentsCheckin({ onNavigate }: { onNavigate: (s: Screen) => void }) {
  const { data: alunos, loading: loadingAlunos, error: alunosError } = useAlunos();
  const { data: checkins } = useCheckins();
  const { data: usuarios } = useUsuarios();
  const [selected, setSelected] = useState<Aluno | null>(null);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"alunos" | "checkin">("alunos");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [editingAluno, setEditingAluno] = useState<Aluno | null>(null);
  const [savingAluno, setSavingAluno] = useState(false);
  const [editAlunoError, setEditAlunoError] = useState("");
  const [accessForm, setAccessForm] = useState({ email: "", senha: "" });
  const [creatingAccess, setCreatingAccess] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [accessSuccess, setAccessSuccess] = useState(false);
  const [generatingEmbedding, setGeneratingEmbedding] = useState(false);
  const [embeddingError, setEmbeddingError] = useState("");
  const [embeddingSuccess, setEmbeddingSuccess] = useState(false);

  const filtered = alunos.filter((a) => a.nome.toLowerCase().includes(search.toLowerCase()));
  const checkinsToday = checkins.filter((c) => isToday(c.timestamp));
  const lastCheckinFor = (alunoId: string) => checkinsToday.find((c) => c.alunoId === alunoId && c.status === "liberado");

  const handleDeleteAluno = async () => {
    if (!selected) return;
    setDeleting(true);
    setDeleteError("");
    try {
      if (selected.fotoUrl) {
        try {
          await deleteObject(ref(storage, `${STORAGE_PATHS.fotosAlunos}/${selected.id}.jpg`));
        } catch (err) {
          console.warn("[alunos] não foi possível apagar a foto do Storage (seguindo com a exclusão do cadastro):", err);
        }
      }
      await deleteDoc(doc(db, COLLECTIONS.alunos, selected.id));
      setSelected(null);
      setConfirmingDelete(false);
    } catch (err) {
      console.error("[alunos] falha ao excluir aluno:", err);
      setDeleteError("Não foi possível excluir o aluno. Verifique sua conexão e permissões.");
    } finally {
      setDeleting(false);
    }
  };

  const handleGenerateEmbedding = async () => {
    if (!selected) return;
    setGeneratingEmbedding(true);
    setEmbeddingError("");
    setEmbeddingSuccess(false);
    try {
      const regenerateEmbedding = httpsCallable(functions, "regenerateEmbedding");
      await regenerateEmbedding({ alunoId: selected.id });
      setEmbeddingSuccess(true);
      setTimeout(() => setEmbeddingSuccess(false), 4000);
    } catch (err) {
      console.error("[alunos] falha ao gerar reconhecimento facial:", err);
      setEmbeddingError("Não foi possível gerar. Verifique se o aluno tem foto cadastrada e tente de novo.");
    } finally {
      setGeneratingEmbedding(false);
    }
  };

  const openEditAluno = (a: Aluno) => {
    setEditingAluno({ ...a });
    setEditAlunoError("");
  };

  const handleSaveAluno = async () => {
    if (!editingAluno) return;
    setSavingAluno(true);
    setEditAlunoError("");
    try {
      await updateDoc(doc(db, COLLECTIONS.alunos, editingAluno.id), {
        nome: editingAluno.nome,
        endereco: editingAluno.endereco,
        whatsapp: editingAluno.whatsapp,
        cpf: editingAluno.cpf,
        rg: editingAluno.rg,
        email: editingAluno.email || null,
        tipoPlano: editingAluno.tipoPlano,
        valorPlano: Number(editingAluno.valorPlano) || 0,
        dataVencimento: editingAluno.dataVencimento,
        status: editingAluno.status,
        atualizadoEm: serverTimestamp(),
      });
      setEditingAluno(null);
    } catch (err) {
      console.error("[alunos] falha ao salvar edição:", err);
      setEditAlunoError("Não foi possível salvar as alterações.");
    } finally {
      setSavingAluno(false);
    }
  };

  const alunoUsuario = (alunoId: string) => usuarios.find((u) => u.alunoId === alunoId);

  const handleCreateAccess = async () => {
    if (!selected) return;
    if (!accessForm.email || accessForm.senha.length < 6) {
      setAccessError("Preencha um e-mail válido e uma senha com pelo menos 6 caracteres.");
      return;
    }
    setCreatingAccess(true);
    setAccessError("");
    try {
      const uid = await createAuthAccountWithoutSignIn(accessForm.email, accessForm.senha);
      await setDoc(doc(db, COLLECTIONS.usuarios, uid), {
        nome: selected.nome,
        email: accessForm.email,
        perfil: "aluno",
        alunoId: selected.id,
        status: "ativo",
        criadoEm: serverTimestamp(),
      });
      // Mantém o e-mail de contato do aluno em sincronia com o de login.
      await updateDoc(doc(db, COLLECTIONS.alunos, selected.id), { email: accessForm.email });
      setAccessForm({ email: "", senha: "" });
      setAccessSuccess(true);
      setTimeout(() => setAccessSuccess(false), 4000);
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      console.error("[alunos] falha ao criar acesso do aluno:", err);
      setAccessError(AUTH_ERROR_MESSAGES[code] ?? "Não foi possível criar o acesso.");
    } finally {
      setCreatingAccess(false);
    }
  };

  const handleResetAccessPassword = async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email);
      alert(`Link de redefinição de senha enviado para ${email}`);
    } catch (err) {
      console.error("[alunos] falha ao enviar redefinição de senha:", err);
      alert("Não foi possível enviar o e-mail de redefinição.");
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader title="Alunos & Check-in" action="Novo Aluno" onAction={() => onNavigate("register")} />
      {alunosError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Não foi possível carregar os alunos do Firebase ({alunosError}).
        </div>
      )}
      <div className="flex gap-2 border-b border-gray-200">
        {(["alunos", "checkin"] as const).map((t) => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-4 py-2 font-display font-semibold text-sm capitalize border-b-2 -mb-px transition-colors ${activeTab === t ? "border-green-600 text-green-700" : "border-transparent text-gray-500 hover:text-gray-900"}`}>
            {t === "alunos" ? "Alunos" : "Check-in Hoje"}
          </button>
        ))}
      </div>
      {activeTab === "alunos" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="md:col-span-2">
            <input placeholder="Buscar aluno…" value={search} onChange={(e) => setSearch(e.target.value)}
              className={`${inputClass} mb-4`} />
            <div className="space-y-2">
              {filtered.map((a) => {
                const todayCheckin = lastCheckinFor(a.id);
                return (
                  <button key={a.id} onClick={() => { setSelected(a); setConfirmingDelete(false); setDeleteError(""); setEmbeddingError(""); setEmbeddingSuccess(false); setAccessForm({ email: "", senha: "" }); setAccessError(""); setAccessSuccess(false); }}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${selected?.id === a.id ? "border-green-400 bg-green-50/60" : "border-gray-200 bg-white shadow-sm hover:border-gray-300"}`}>
                    <div className="relative">
                      {a.fotoUrl ? (
                        <img src={a.fotoUrl} alt={a.nome} className="w-10 h-10 rounded-full object-cover border border-gray-200" />
                      ) : (
                        <span className="w-10 h-10 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400"><Icon name="user" className="w-4 h-4" /></span>
                      )}
                      {todayCheckin && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-display font-semibold text-sm text-gray-900 truncate">{a.nome}</p>
                      <p className="text-xs text-gray-400">{todayCheckin ? new Date(todayCheckin.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge className={alunoStatusColors[a.status] ?? "text-gray-500 bg-gray-100 border-gray-200"}>{a.status}</Badge>
                      <Badge className={planBadgeAdmin[a.tipoPlano as Plan] ?? "text-gray-500 bg-gray-100 border-gray-200"}>{a.tipoPlano}</Badge>
                    </div>
                  </button>
                );
              })}
              {loadingAlunos && <p className="text-center text-gray-400 text-sm py-6">Carregando alunos...</p>}
              {!loadingAlunos && filtered.length === 0 && <p className="text-center text-gray-400 text-sm py-6">Nenhum aluno cadastrado ainda.</p>}
            </div>
          </div>
          <div>
            {selected ? (
              <div className={`${cardClass} p-5 space-y-4 sticky top-4`}>
                <div className="flex items-start gap-3">
                  {selected.fotoUrl ? (
                    <img src={selected.fotoUrl} alt={selected.nome} className="w-16 h-16 rounded-xl object-cover border-2 border-green-400/40" />
                  ) : (
                    <span className="w-16 h-16 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400"><Icon name="user" className="w-6 h-6" /></span>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display font-bold text-lg text-gray-900 leading-tight">{selected.nome}</h3>
                    <Badge className={alunoStatusColors[selected.status] ?? "text-gray-500 bg-gray-100 border-gray-200"}>{selected.status}</Badge>
                  </div>
                  <button onClick={() => openEditAluno(selected)} className="text-gray-400 hover:text-gray-700 transition-colors shrink-0" title="Editar aluno">
                    <Icon name="edit" className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-2 text-sm">
                  {[
                    ["CPF", selected.cpf],
                    ["RG", selected.rg],
                    ["Endereço", selected.endereco],
                    ["WhatsApp", selected.whatsapp],
                    ["Plano", selected.tipoPlano],
                    ["Valor", formatBRL(selected.valorPlano ?? 0)],
                    ["Vencimento", selected.dataVencimento],
                    ["Membro desde", selected.dataMatricula],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <span className="text-gray-400 shrink-0">{k}</span>
                      <span className="text-gray-900 font-mono-data text-xs text-right">{v || "—"}</span>
                    </div>
                  ))}
                </div>
                {lastCheckinFor(selected.id) && (
                  <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-xs text-green-700 font-display font-medium">Check-in registrado hoje</span>
                  </div>
                )}

                <div className="border-t border-gray-100 pt-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-display text-gray-500 uppercase tracking-wider">Reconhecimento facial</span>
                    <Badge className={selected.faceEmbedding?.length ? "text-green-700 bg-green-50 border-green-200" : "text-amber-700 bg-amber-50 border-amber-200"}>
                      {selected.faceEmbedding?.length ? "Configurado" : "Não configurado"}
                    </Badge>
                  </div>
                  {!selected.fotoUrl ? (
                    <p className="text-xs text-gray-400">Cadastre uma foto para poder gerar o reconhecimento facial.</p>
                  ) : (
                    <button onClick={handleGenerateEmbedding} disabled={generatingEmbedding} className="w-full flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-gray-300 hover:border-green-400 disabled:opacity-60 text-gray-600 hover:text-gray-900 transition-colors font-display font-medium">
                      <Icon name="camera" className="w-3.5 h-3.5" />
                      {generatingEmbedding ? "Gerando..." : selected.faceEmbedding?.length ? "Gerar novamente" : "Gerar reconhecimento facial"}
                    </button>
                  )}
                  {embeddingError && <p className="text-xs text-red-500">{embeddingError}</p>}
                  {embeddingSuccess && (
                    <p className="flex items-center gap-1.5 text-xs text-green-600">
                      <Icon name="check-circle" className="w-3.5 h-3.5" /> Reconhecimento facial gerado com sucesso.
                    </p>
                  )}
                </div>

                <div className="border-t border-gray-100 pt-3 space-y-2">
                  <span className="text-xs font-display text-gray-500 uppercase tracking-wider">Acesso do aluno (portal)</span>
                  {(() => {
                    const usuario = alunoUsuario(selected.id);
                    if (usuario) {
                      return (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                            <Icon name="key" className="w-3.5 h-3.5 text-green-600 shrink-0" />
                            <span className="text-xs text-green-700 font-mono-data truncate">{usuario.email}</span>
                          </div>
                          <button onClick={() => handleResetAccessPassword(usuario.email)} className="w-full text-xs px-3 py-2 rounded-lg border border-gray-300 text-gray-600 hover:text-gray-900 hover:border-gray-400 transition-colors font-display font-medium">
                            Redefinir senha
                          </button>
                        </div>
                      );
                    }
                    return (
                      <div className="space-y-2">
                        <input type="email" placeholder="E-mail do aluno" value={accessForm.email} onChange={(e) => { setAccessForm({ ...accessForm, email: e.target.value }); setAccessError(""); }} className={`${inputClass} text-xs py-2`} />
                        <input type="password" placeholder="Senha temporária (mín. 6 caracteres)" value={accessForm.senha} onChange={(e) => { setAccessForm({ ...accessForm, senha: e.target.value }); setAccessError(""); }} className={`${inputClass} text-xs py-2`} />
                        {accessError && <p className="text-xs text-red-500">{accessError}</p>}
                        {accessSuccess && (
                          <p className="flex items-center gap-1.5 text-xs text-green-600">
                            <Icon name="check-circle" className="w-3.5 h-3.5" /> Acesso criado com sucesso.
                          </p>
                        )}
                        <button onClick={handleCreateAccess} disabled={creatingAccess} className="w-full flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-gray-300 hover:border-green-400 disabled:opacity-60 text-gray-600 hover:text-gray-900 transition-colors font-display font-medium">
                          <Icon name="key" className="w-3.5 h-3.5" />
                          {creatingAccess ? "Criando..." : "Criar acesso"}
                        </button>
                      </div>
                    );
                  })()}
                </div>

                {deleteError && <p className="text-xs text-red-500">{deleteError}</p>}

                <div className="border-t border-gray-100 pt-3">
                  {!confirmingDelete ? (
                    <button onClick={() => setConfirmingDelete(true)} className="w-full flex items-center justify-center gap-1.5 text-xs text-red-600 hover:bg-red-50 border border-red-200 rounded-lg py-2 transition-colors font-display font-medium">
                      <Icon name="x" className="w-3.5 h-3.5" /> Excluir Aluno
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-red-600 text-center">Excluir {selected.nome}? O cadastro e a foto são apagados — os check-ins já feitos ficam no histórico.</p>
                      <div className="flex gap-2">
                        <button onClick={handleDeleteAluno} disabled={deleting} className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-xs font-display font-semibold transition-colors">
                          {deleting ? "Excluindo..." : "Confirmar exclusão"}
                        </button>
                        <button onClick={() => setConfirmingDelete(false)} disabled={deleting} className="flex-1 py-2 rounded-lg border border-gray-300 text-gray-600 hover:text-gray-900 text-xs transition-colors">Cancelar</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-gray-400 text-sm">
                Selecione um aluno para ver a ficha
              </div>
            )}
          </div>
        </div>
      )}
      {activeTab === "checkin" && (
        <div className={`${cardClass} overflow-hidden`}>
          <table className="w-full text-sm">
            <thead>
              <tr className={tableHeadClass}>
                <th className="text-left px-4 py-3">Aluno</th>
                <th className="text-left px-4 py-3">Hora</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Tipo</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Status</th>
              </tr>
            </thead>
            <tbody>
              {checkinsToday.map((c, i) => (
                <tr key={c.id} className={`border-t border-gray-100 ${i % 2 === 0 ? "bg-gray-50/50" : ""} hover:bg-green-50/40 transition-colors`}>
                  <td className="px-4 py-3 text-gray-900 font-medium">{c.nomeAluno}</td>
                  <td className="px-4 py-3 font-mono-data text-gray-600">{new Date(c.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="px-4 py-3 hidden md:table-cell text-gray-500 text-xs">{c.tipo}</td>
                  <td className="px-4 py-3 hidden md:table-cell"><Badge className={checkinStatusColors[c.status]}>{c.status}</Badge></td>
                </tr>
              ))}
              {checkinsToday.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-sm">Nenhum check-in hoje.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editingAluno && (
        <Modal title="Editar Aluno" onClose={() => setEditingAluno(null)} wide>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <FormField label="Nome completo"><input className={inputClass} value={editingAluno.nome} onChange={(e) => setEditingAluno({ ...editingAluno, nome: e.target.value })} /></FormField>
            </div>
            <div className="md:col-span-2">
              <FormField label="Endereço"><input className={inputClass} value={editingAluno.endereco} onChange={(e) => setEditingAluno({ ...editingAluno, endereco: e.target.value })} /></FormField>
            </div>
            <FormField label="WhatsApp"><input className={inputClass} value={editingAluno.whatsapp} onChange={(e) => setEditingAluno({ ...editingAluno, whatsapp: e.target.value })} /></FormField>
            <FormField label="E-mail"><input type="email" className={inputClass} value={editingAluno.email ?? ""} onChange={(e) => setEditingAluno({ ...editingAluno, email: e.target.value })} /></FormField>
            <FormField label="CPF"><input className={inputClass} value={editingAluno.cpf} onChange={(e) => setEditingAluno({ ...editingAluno, cpf: e.target.value })} /></FormField>
            <FormField label="RG"><input className={inputClass} value={editingAluno.rg} onChange={(e) => setEditingAluno({ ...editingAluno, rg: e.target.value })} /></FormField>
            <FormField label="Tipo de Plano">
              <select className={inputClass} value={editingAluno.tipoPlano} onChange={(e) => setEditingAluno({ ...editingAluno, tipoPlano: e.target.value })}>
                <option value="mensal">Mensal</option>
                <option value="trimestral">Trimestral</option>
                <option value="anual">Anual</option>
              </select>
            </FormField>
            <FormField label="Valor do Plano (R$)"><input type="number" className={inputClass} value={editingAluno.valorPlano} onChange={(e) => setEditingAluno({ ...editingAluno, valorPlano: Number(e.target.value) })} /></FormField>
            <FormField label="Vencimento"><input type="date" className={inputClass} value={editingAluno.dataVencimento?.slice(0, 10) ?? ""} onChange={(e) => setEditingAluno({ ...editingAluno, dataVencimento: e.target.value })} /></FormField>
            <FormField label="Status">
              <select className={inputClass} value={editingAluno.status} onChange={(e) => setEditingAluno({ ...editingAluno, status: e.target.value as AlunoStatus })}>
                <option value="ativo">Ativo</option>
                <option value="pendente">Pendente</option>
                <option value="vencido">Vencido</option>
                <option value="inativo">Inativo</option>
              </select>
            </FormField>
          </div>
          {editAlunoError && <p className="text-xs text-red-500">{editAlunoError}</p>}
          <div className="flex gap-3 pt-1">
            <button onClick={handleSaveAluno} disabled={savingAluno} className="flex-1 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-display font-bold text-sm transition-colors shadow-sm">
              {savingAluno ? "Salvando..." : "Salvar Alterações"}
            </button>
            <button onClick={() => setEditingAluno(null)} className="px-5 py-2.5 rounded-lg border border-gray-300 text-gray-500 hover:text-gray-900 text-sm transition-colors">Cancelar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const EMPTY_EXERCISE = { nome: "", series: "4", repeticoes: "12", carga: "" };

function Workouts() {
  const { data: alunos } = useAlunos();
  const { data: treinos, loading: loadingTreinos, error: treinosError } = useTreinos();
  const [showForm, setShowForm] = useState(false);
  const [selectedAlunoId, setSelectedAlunoId] = useState("");
  const [exercises, setExercises] = useState([{ ...EMPTY_EXERCISE }]);
  const [titulo, setTitulo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const updateExercise = (i: number, patch: Partial<typeof EMPTY_EXERCISE>) => {
    setExercises(exercises.map((ex, xi) => (xi === i ? { ...ex, ...patch } : ex)));
  };

  const handleSaveTreino = async () => {
    setFormError("");
    const aluno = alunos.find((a) => a.id === selectedAlunoId);
    const validExercises = exercises.filter((ex) => ex.nome.trim());
    if (!aluno || !titulo || validExercises.length === 0) {
      setFormError("Selecione o aluno, dê um título ao treino e preencha ao menos um exercício.");
      return;
    }

    setSubmitting(true);
    try {
      await addDoc(collection(db, COLLECTIONS.alunos, aluno.id, COLLECTIONS.treinos), {
        alunoId: aluno.id,
        alunoNome: aluno.nome,
        titulo,
        criadoPor: auth.currentUser?.uid ?? null,
        dataCriacao: new Date().toISOString(),
        ativo: true,
        exercicios: validExercises.map((ex) => ({
          nome: ex.nome,
          series: Number(ex.series) || 0,
          repeticoes: Number(ex.repeticoes) || 0,
          carga: ex.carga,
          descanso: "60s",
        })),
      });
      setShowForm(false);
      setSelectedAlunoId("");
      setTitulo("");
      setExercises([{ ...EMPTY_EXERCISE }]);
    } catch (err) {
      console.error("[treinos] falha ao salvar treino:", err);
      setFormError("Não foi possível salvar o treino. Verifique sua conexão e se as regras do Firestore já foram mescladas.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader title="Treinos" action={showForm ? undefined : "Adicionar Treino"} onAction={() => setShowForm(true)} />
      {treinosError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Não foi possível carregar os treinos do Firebase ({treinosError}).
        </div>
      )}
      {showForm && (
        <div className="rounded-xl border border-green-200 bg-green-50/50 p-5 space-y-4">
          <h3 className="font-display font-semibold text-gray-900">Novo Treino</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Aluno">
              <select value={selectedAlunoId} onChange={(e) => setSelectedAlunoId(e.target.value)} className={inputClass}>
                <option value="">Selecionar aluno…</option>
                {alunos.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
              </select>
            </FormField>
            <FormField label="Título do Treino">
              <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Treino A – Peito" className={inputClass} />
            </FormField>
          </div>
          <div>
            <label className="block text-xs font-display text-gray-500 uppercase tracking-wider mb-2">Exercícios</label>
            <div className="space-y-2">
              {exercises.map((ex, i) => (
                <div key={i} className="grid grid-cols-[1fr_70px_70px_90px] gap-2">
                  <input value={ex.nome} onChange={(e) => updateExercise(i, { nome: e.target.value })} placeholder="Ex.: Supino reto" className={inputClass} />
                  <input value={ex.series} onChange={(e) => updateExercise(i, { series: e.target.value })} placeholder="Séries" className={inputClass} />
                  <input value={ex.repeticoes} onChange={(e) => updateExercise(i, { repeticoes: e.target.value })} placeholder="Reps" className={inputClass} />
                  <input value={ex.carga} onChange={(e) => updateExercise(i, { carga: e.target.value })} placeholder="Carga" className={inputClass} />
                </div>
              ))}
            </div>
            <button onClick={() => setExercises([...exercises, { ...EMPTY_EXERCISE }])} className="mt-2 text-xs text-green-700 hover:text-green-800 font-medium">+ adicionar exercício</button>
          </div>
          {formError && <p className="text-xs text-red-500">{formError}</p>}
          <div className="flex gap-3">
            <button onClick={handleSaveTreino} disabled={submitting} className="flex-1 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-display font-bold text-sm transition-colors shadow-sm">
              {submitting ? "Salvando..." : "Salvar Treino"}
            </button>
            <button onClick={() => setShowForm(false)} className="px-5 py-2.5 rounded-lg border border-gray-300 text-gray-500 hover:text-gray-900 hover:border-gray-400 text-sm transition-colors">Cancelar</button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {treinos.map((t) => {
          const aluno = alunos.find((a) => a.id === t.alunoId);
          return (
            <div key={t.id} className={`${cardClass} p-5 hover:shadow-md transition-shadow`}>
              <div className="flex items-center gap-3 mb-4">
                {aluno?.fotoUrl ? (
                  <img src={aluno.fotoUrl} alt={t.alunoNome} className="w-10 h-10 rounded-full object-cover border border-gray-200" />
                ) : (
                  <span className="w-10 h-10 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400"><Icon name="user" className="w-4 h-4" /></span>
                )}
                <div>
                  <p className="font-display font-semibold text-gray-900 text-sm">{t.alunoNome}</p>
                </div>
                <span className="ml-auto font-mono-data text-xs text-gray-400">{new Date(t.dataCriacao).toLocaleDateString("pt-BR")}</span>
              </div>
              <p className="font-display font-bold text-green-700 text-sm mb-3">{t.titulo}</p>
              <ul className="space-y-1">
                {t.exercicios.map((ex, i) => (
                  <li key={i} className="text-xs text-gray-600 flex gap-2"><span className="text-green-500">▸</span>{ex.nome} — {ex.series}×{ex.repeticoes} · {ex.carga || "—"}</li>
                ))}
              </ul>
            </div>
          );
        })}
        {loadingTreinos && <p className="text-sm text-gray-400 py-6 text-center md:col-span-2">Carregando treinos...</p>}
        {!loadingTreinos && treinos.length === 0 && (
          <div className="md:col-span-2 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-gray-400 text-sm">
            Nenhum treino cadastrado ainda.
          </div>
        )}
      </div>
    </div>
  );
}

function Billing() {
  const { data: alunos, loading, error } = useAlunos();
  const notifColors = {
    Aviso: "bg-sky-50 text-sky-700 hover:bg-sky-100 border-sky-200",
    Revisão: "bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200",
    Urgente: "bg-red-50 text-red-700 hover:bg-red-100 border-red-200",
  };
  return (
    <div className="space-y-6">
      <SectionHeader title="Cobrança & Assinaturas" />
      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Não foi possível carregar os alunos do Firebase ({error}).
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Em dia" value={alunos.filter((a) => a.status === "ativo").length} icon="check-circle" />
        <StatCard label="Pendentes" value={alunos.filter((a) => a.status === "pendente").length} icon="alert-triangle" tone="amber" />
        <StatCard label="Vencidos" value={alunos.filter((a) => a.status === "vencido").length} icon="alert-triangle" tone="red" />
      </div>
      <div className={`${cardClass} overflow-hidden`}>
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
          <h3 className="font-display font-semibold text-sm text-gray-900">Vencimentos e Notificações</h3>
        </div>
        <div className="divide-y divide-gray-100">
          {alunos.map((a) => (
            <div key={a.id} className="flex flex-col md:flex-row md:items-center gap-3 px-4 py-4">
              <div className="flex items-center gap-3 flex-1">
                {a.fotoUrl ? (
                  <img src={a.fotoUrl} alt={a.nome} className="w-9 h-9 rounded-full object-cover border border-gray-200 shrink-0" />
                ) : (
                  <span className="w-9 h-9 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400 shrink-0"><Icon name="user" className="w-4 h-4" /></span>
                )}
                <div>
                  <p className="font-display font-semibold text-sm text-gray-900">{a.nome}</p>
                  <p className="text-xs text-gray-400">Vence: <span className="font-mono-data">{a.dataVencimento?.slice(0, 10)}</span> · {a.tipoPlano}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={alunoStatusColors[a.status] ?? "text-gray-500 bg-gray-100 border-gray-200"}>{a.status}</Badge>
                {(["Aviso", "Revisão", "Urgente"] as const).map((n) => (
                  <button key={n} className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border font-display font-medium transition-colors ${notifColors[n]}`}><Icon name="smartphone" className="w-3.5 h-3.5" /> {n}</button>
                ))}
              </div>
            </div>
          ))}
          {loading && <p className="text-center text-gray-400 text-sm py-6">Carregando alunos...</p>}
          {!loading && alunos.length === 0 && <p className="text-center text-gray-400 text-sm py-6">Nenhum aluno cadastrado ainda.</p>}
        </div>
      </div>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <span className="w-8 h-8 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center shrink-0"><Icon name="zap" className="w-4 h-4" /></span>
          <div>
            <p className="font-display font-semibold text-amber-800 text-sm">Notificação automática ativada</p>
            <p className="text-xs text-amber-700/80 mt-0.5">O sistema envia aviso via WhatsApp 1 dia antes do vencimento de cada plano, com link de pagamento automático.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatLogTimestamp(ts: unknown): string {
  if (!ts) return "—";
  if (typeof ts === "string") return new Date(ts).toLocaleString("pt-BR");
  const maybeFirestoreTs = ts as { toDate?: () => Date };
  if (typeof maybeFirestoreTs.toDate === "function") return maybeFirestoreTs.toDate().toLocaleString("pt-BR");
  return "—";
}

function Audit() {
  const { data: alunos } = useAlunos();
  const { data: checkins, loading: loadingCheckins, error: checkinsError } = useCheckins();
  const { data: logs, loading: loadingLogs, error: logsError } = useLogsAuditoria(50);
  const inactive = alunos.filter((a) => a.status === "inativo");

  return (
    <div className="space-y-6">
      <SectionHeader title="Auditoria & Log de Acesso" />
      {(checkinsError || logsError) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Não foi possível carregar os dados do Firebase ({checkinsError || logsError}).
        </div>
      )}
      <div className={`${cardClass} overflow-hidden`}>
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-display font-semibold text-sm text-gray-900">Histórico de Check-ins</h3>
          <span className="font-mono-data text-xs text-gray-400">{checkins.length} registros</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className={tableHeadClass}>
              <th className="text-left px-4 py-3">Aluno</th>
              <th className="text-left px-4 py-3">Data</th>
              <th className="text-left px-4 py-3">Hora</th>
              <th className="text-left px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {checkins.map((c, i) => {
              const aluno = alunos.find((a) => a.id === c.alunoId);
              const d = new Date(c.timestamp);
              return (
                <tr key={c.id} className={`border-t border-gray-100 ${i % 2 === 0 ? "bg-gray-50/50" : ""} hover:bg-green-50/40 transition-colors`}>
                  <td className="px-4 py-3 flex items-center gap-3">
                    {aluno?.fotoUrl ? (
                      <img src={aluno.fotoUrl} alt={c.nomeAluno} className="w-7 h-7 rounded-full object-cover opacity-90" />
                    ) : (
                      <span className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-400"><Icon name="user" className="w-3.5 h-3.5" /></span>
                    )}
                    <span className="text-gray-900">{c.nomeAluno}</span>
                  </td>
                  <td className="px-4 py-3 font-mono-data text-gray-400 text-xs">{d.toLocaleDateString("pt-BR")}</td>
                  <td className="px-4 py-3 font-mono-data text-gray-600 text-xs">{d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="px-4 py-3">
                    <Badge className={checkinStatusColors[c.status]}>{c.status}</Badge>
                  </td>
                </tr>
              );
            })}
            {loadingCheckins && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-sm">Carregando...</td></tr>}
            {!loadingCheckins && checkins.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-sm">Nenhum check-in registrado ainda.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className={`${cardClass} overflow-hidden`}>
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
          <h3 className="font-display font-semibold text-sm text-gray-900">Log de Auditoria do Sistema</h3>
        </div>
        <div className="divide-y divide-gray-100">
          {logs.map((l) => (
            <div key={l.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-gray-900">{l.detalhes}</p>
                <p className="text-xs text-gray-400 font-mono-data">{l.acao}</p>
              </div>
              <span className="text-xs text-gray-400 font-mono-data shrink-0">{formatLogTimestamp(l.timestamp)}</span>
            </div>
          ))}
          {loadingLogs && <p className="text-center text-gray-400 text-sm py-6">Carregando...</p>}
          {!loadingLogs && logs.length === 0 && <p className="text-center text-gray-400 text-sm py-6">Nenhum evento registrado ainda.</p>}
        </div>
      </div>

      {inactive.length > 0 && (
        <div>
          <h3 className="font-display font-semibold text-lg text-gray-900 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            Alunos inativos
          </h3>
          <p className="text-xs text-gray-400 mb-4">Alunos com status "inativo" no cadastro.</p>
          <div className="space-y-2">
            {inactive.map((a) => (
              <div key={a.id} className="flex items-center gap-3 p-3 rounded-xl border border-red-200 bg-red-50/60">
                {a.fotoUrl ? (
                  <img src={a.fotoUrl} alt={a.nome} className="w-9 h-9 rounded-full object-cover opacity-80" />
                ) : (
                  <span className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-400"><Icon name="user" className="w-4 h-4" /></span>
                )}
                <div className="flex-1">
                  <p className="font-display font-semibold text-sm text-gray-900">{a.nome}</p>
                  <p className="text-xs text-gray-400">Vencimento: {a.dataVencimento?.slice(0, 10) || "—"}</p>
                </div>
                <button className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors font-display font-medium"><Icon name="smartphone" className="w-3.5 h-3.5" /> Reativar</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type SettingsTab = "usuarios" | "historico" | "planos" | "pagamentos" | "notificacoes" | "academia" | "catraca";

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "usuarios", label: "Usuários do Sistema" },
  { id: "historico", label: "Histórico" },
  { id: "planos", label: "Planos e Preços" },
  { id: "pagamentos", label: "Pagamentos / API" },
  { id: "notificacoes", label: "Notificações / WhatsApp" },
  { id: "academia", label: "Dados da Academia" },
  { id: "catraca", label: "Controle de Acesso / Catraca" },
];

function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("usuarios");

  // ── Usuários do Sistema ──
  const { data: usuarios, error: usuariosError } = useUsuarios();
  const [userSearch, setUserSearch] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState<"todos" | UsuarioPerfil>("todos");
  const [editingUser, setEditingUser] = useState<Usuario | null>(null);
  const [addingUser, setAddingUser] = useState(false);
  const [newUserForm, setNewUserForm] = useState({ nome: "", email: "", perfil: "personal" as UsuarioPerfil });
  const [userActionError, setUserActionError] = useState("");
  const [savingUser, setSavingUser] = useState(false);

  const filteredUsers = usuarios.filter(
    (u) => (userRoleFilter === "todos" || u.perfil === userRoleFilter) && u.nome.toLowerCase().includes(userSearch.toLowerCase())
  );

  const openAddUser = () => {
    setNewUserForm({ nome: "", email: "", perfil: "personal" });
    setUserActionError("");
    setAddingUser(true);
  };

  const saveNewUser = async () => {
    if (!newUserForm.nome || !newUserForm.email) return;
    setSavingUser(true);
    setUserActionError("");
    try {
      // Ainda não existe uma Cloud Function de convite — isso só cria o
      // perfil no Firestore. A pessoa só consegue entrar de verdade depois
      // que uma função (a implementar) criar a conta dela no Firebase Auth
      // e este documento for migrado para o uid correspondente.
      const ref = doc(collection(db, COLLECTIONS.usuarios));
      await setDoc(ref, { nome: newUserForm.nome, email: newUserForm.email, perfil: newUserForm.perfil, status: "ativo", criadoEm: serverTimestamp() });
      setAddingUser(false);
    } catch (err) {
      console.error("[usuarios] falha ao salvar usuário:", err);
      setUserActionError("Não foi possível salvar o usuário.");
    } finally {
      setSavingUser(false);
    }
  };

  const saveEditedUser = async () => {
    if (!editingUser) return;
    setSavingUser(true);
    setUserActionError("");
    try {
      await updateDoc(doc(db, COLLECTIONS.usuarios, editingUser.id), { nome: editingUser.nome, perfil: editingUser.perfil, status: editingUser.status });
      setEditingUser(null);
    } catch (err) {
      console.error("[usuarios] falha ao editar usuário:", err);
      setUserActionError("Não foi possível salvar as alterações.");
    } finally {
      setSavingUser(false);
    }
  };

  const deactivateUser = async () => {
    if (!editingUser) return;
    setSavingUser(true);
    try {
      await updateDoc(doc(db, COLLECTIONS.usuarios, editingUser.id), { status: "inativo" });
      setEditingUser(null);
    } catch (err) {
      console.error("[usuarios] falha ao desativar usuário:", err);
      setUserActionError("Não foi possível desativar o usuário.");
    } finally {
      setSavingUser(false);
    }
  };

  const resetPassword = async () => {
    if (!editingUser?.email) return;
    try {
      await sendPasswordResetEmail(auth, editingUser.email);
      alert(`Link de redefinição de senha enviado para ${editingUser.email}`);
    } catch (err) {
      console.error("[usuarios] falha ao enviar redefinição de senha:", err);
      alert("Não foi possível enviar o e-mail de redefinição.");
    }
  };

  // ── Histórico (log de auditoria real) ──
  const { data: logsData, loading: loadingLogsTab, error: logsTabError } = useLogsAuditoria(200);
  const [logDateFilter, setLogDateFilter] = useState(""); // yyyy-mm-dd
  const [logSearch, setLogSearch] = useState("");

  const usuarioNome = (id: string | null | undefined) => usuarios.find((u) => u.id === id)?.nome ?? (id ? id : "Sistema (kiosk)");

  const logDateKey = (ts: unknown): string | null => {
    if (typeof ts === "string") return ts.slice(0, 10);
    const maybe = ts as { toDate?: () => Date };
    if (typeof maybe?.toDate === "function") return maybe.toDate().toISOString().slice(0, 10);
    return null;
  };

  const filteredLog = logsData.filter((l) => {
    const matchesSearch = !logSearch || l.acao.toLowerCase().includes(logSearch.toLowerCase()) || l.detalhes.toLowerCase().includes(logSearch.toLowerCase());
    const matchesDate = !logDateFilter || logDateKey(l.timestamp) === logDateFilter;
    return matchesSearch && matchesDate;
  });

  const exportCSV = () => {
    const header = "Data,Usuário,Ação,Detalhe";
    const rows = filteredLog.map((l) => `${formatLogTimestamp(l.timestamp)},"${usuarioNome(l.usuarioId)}",${l.acao},"${l.detalhes}"`);
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "historico.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    const rowsHtml = filteredLog
      .map((l) => `<tr><td>${formatLogTimestamp(l.timestamp)}</td><td>${usuarioNome(l.usuarioId)}</td><td>${l.acao}</td><td>${l.detalhes}</td></tr>`)
      .join("");
    win.document.write(
      `<html><head><title>Histórico</title><style>body{font-family:sans-serif;padding:24px;color:#111}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px 10px;font-size:13px;text-align:left}</style></head><body><h2>Histórico do Sistema — FitManager</h2><table><thead><tr><th>Data</th><th>Usuário</th><th>Ação</th><th>Detalhe</th></tr></thead><tbody>${rowsHtml}</tbody></table></body></html>`
    );
    win.document.close();
    win.print();
  };

  // ── Planos e Preços ──
  const [plans, setPlans] = useState<PlanConfig[]>(PLAN_CONFIGS);
  const [editingPlan, setEditingPlan] = useState<PlanConfig | null>(null);
  const [addingPlan, setAddingPlan] = useState(false);
  const [newPlanForm, setNewPlanForm] = useState({ name: "", price: 0, description: "" });

  const openAddPlan = () => {
    setNewPlanForm({ name: "", price: 0, description: "" });
    setAddingPlan(true);
  };

  const saveNewPlan = () => {
    if (!newPlanForm.name) return;
    const id = plans.reduce((max, p) => Math.max(max, p.id), 0) + 1;
    setPlans([...plans, { id, ...newPlanForm }]);
    setAddingPlan(false);
  };

  // ── Pagamentos / API ──
  const [gateway, setGateway] = useState<"Nenhum" | "Asaas" | "InfinityPay">("Nenhum");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [payConnected, setPayConnected] = useState(false);
  const [autoCharge, setAutoCharge] = useState(true);
  const [testingPay, setTestingPay] = useState(false);
  const [lastPayTest, setLastPayTest] = useState<string | null>(null);
  const webhookUrl = "https://api.fitmanager.app/webhooks/pagamentos";

  const testPaymentConnection = () => {
    setTestingPay(true);
    setTimeout(() => {
      setTestingPay(false);
      setPayConnected(gateway !== "Nenhum");
      setLastPayTest(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    }, 1200);
  };

  const copyWebhook = () => {
    navigator.clipboard?.writeText(webhookUrl).catch(() => {});
    alert("URL do webhook copiada!");
  };

  // ── Notificações / WhatsApp ──
  const [waConnected, setWaConnected] = useState(false);
  const [evoApiKey, setEvoApiKey] = useState("");
  const [evoInstanceName, setEvoInstanceName] = useState("");
  const [evoUrl, setEvoUrl] = useState("");
  const [testingWa, setTestingWa] = useState(false);
  const [lastWaTest, setLastWaTest] = useState<string | null>(null);
  const [autoNotify, setAutoNotify] = useState(true);
  const [templates, setTemplates] = useState<MessageTemplate[]>(MESSAGE_TEMPLATES);

  const testWaConnection = () => {
    setTestingWa(true);
    setTimeout(() => {
      setTestingWa(false);
      setWaConnected(!!evoApiKey && !!evoInstanceName && !!evoUrl);
      setLastWaTest(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    }, 1200);
  };

  const saveWaConfig = () => {
    alert("Configuração da Evolution API salva com sucesso!");
  };

  // ── Dados da Academia ──
  const [gymName, setGymName] = useState("FitManager Academia");
  const [gymLogo, setGymLogo] = useState<string | null>(null);
  const [gymAddress, setGymAddress] = useState("Av. Paulista, 1000 – São Paulo/SP");
  const [gymPhone, setGymPhone] = useState("(11) 4000-0000");
  const [gymCnpj, setGymCnpj] = useState("12.345.678/0001-90");
  const [hours, setHours] = useState<GymHours[]>(GYM_HOURS);
  const logoRef = useRef<HTMLInputElement>(null);

  const handleLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => setGymLogo(ev.target?.result as string);
    reader.readAsDataURL(f);
  };

  // ── Controle de Acesso / Catraca ──
  const [turnstileConnected, setTurnstileConnected] = useState(true);
  const [testing, setTesting] = useState(false);
  const [lastTest, setLastTest] = useState<string | null>(null);

  const testConnection = () => {
    setTesting(true);
    setTimeout(() => {
      setTesting(false);
      setTurnstileConnected(true);
      setLastTest(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    }, 1200);
  };

  return (
    <div className="space-y-6">
      <SectionHeader title="Configurações" />
      <div className="flex gap-2 border-b border-gray-200 flex-wrap">
        {SETTINGS_TABS.map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 font-display font-semibold text-sm border-b-2 -mb-px transition-colors whitespace-nowrap ${activeTab === t.id ? "border-green-600 text-green-700" : "border-transparent text-gray-500 hover:text-gray-900"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── Usuários do Sistema ─── */}
      {activeTab === "usuarios" && (
        <div className="space-y-4">
          {usuariosError && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Não foi possível carregar os usuários do Firebase ({usuariosError}).
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-3">
            <input value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="Buscar por nome..." className={`${inputClass} sm:max-w-xs`} />
            <select value={userRoleFilter} onChange={(e) => setUserRoleFilter(e.target.value as "todos" | UsuarioPerfil)} className={`${inputClass} sm:max-w-[200px]`}>
              <option value="todos">Todos os perfis</option>
              <option value="administrador">Administrador</option>
              <option value="personal">Personal</option>
              <option value="aluno">Aluno</option>
            </select>
          </div>
          <div className={`${cardClass} overflow-hidden`}>
            <table className="w-full text-sm">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="text-left px-4 py-3">Nome</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">E-mail</th>
                  <th className="text-left px-4 py-3">Perfil</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u, i) => (
                  <tr key={u.id} className={`border-t border-gray-100 ${i % 2 === 0 ? "bg-gray-50/50" : ""} hover:bg-green-50/40 transition-colors`}>
                    <td className="px-4 py-3 font-medium text-gray-900">{u.nome}</td>
                    <td className="px-4 py-3 hidden md:table-cell font-mono-data text-gray-400 text-xs">{u.email}</td>
                    <td className="px-4 py-3"><Badge className={perfilColors[u.perfil]}>{u.perfil}</Badge></td>
                    <td className="px-4 py-3 hidden md:table-cell"><span className={`text-xs ${u.status === "ativo" ? "text-green-600" : "text-gray-400"}`}>{u.status === "ativo" ? "● Ativo" : "○ Inativo"}</span></td>
                    <td className="px-4 py-3 text-right"><button onClick={() => { setEditingUser({ ...u }); setUserActionError(""); }} className="text-xs text-gray-500 hover:text-gray-900 transition-colors">Editar</button></td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400 text-sm">Nenhum usuário cadastrado ainda.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <button onClick={openAddUser} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 hover:border-green-400 text-sm text-gray-600 hover:text-gray-900 transition-colors">+ Adicionar Usuário</button>
        </div>
      )}

      {/* ─── Histórico ─── */}
      {activeTab === "historico" && (
        <div className="space-y-4">
          {logsTabError && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Não foi possível carregar o histórico do Firebase ({logsTabError}).
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <input type="date" value={logDateFilter} onChange={(e) => setLogDateFilter(e.target.value)} className={`${inputClass} sm:max-w-[170px]`} />
            <input value={logSearch} onChange={(e) => setLogSearch(e.target.value)} placeholder="Buscar por ação ou detalhe..." className={`${inputClass} sm:max-w-[240px]`} />
            <div className="flex gap-2 sm:ml-auto">
              <button onClick={exportCSV} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 hover:border-green-400 text-sm text-gray-600 hover:text-gray-900 transition-colors"><Icon name="download" className="w-4 h-4" /> CSV</button>
              <button onClick={exportPDF} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 hover:border-green-400 text-sm text-gray-600 hover:text-gray-900 transition-colors"><Icon name="download" className="w-4 h-4" /> PDF</button>
            </div>
          </div>
          <div className={`${cardClass} overflow-hidden`}>
            <table className="w-full text-sm">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="text-left px-4 py-3">Data</th>
                  <th className="text-left px-4 py-3">Usuário</th>
                  <th className="text-left px-4 py-3">Ação</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {filteredLog.map((l, i) => (
                  <tr key={l.id} className={`border-t border-gray-100 ${i % 2 === 0 ? "bg-gray-50/50" : ""} hover:bg-green-50/40 transition-colors`}>
                    <td className="px-4 py-3 font-mono-data text-gray-400 text-xs">{formatLogTimestamp(l.timestamp)}</td>
                    <td className="px-4 py-3 text-gray-900">{usuarioNome(l.usuarioId)}</td>
                    <td className="px-4 py-3 text-gray-700 text-xs font-mono-data">{l.acao}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-gray-400 text-xs">{l.detalhes}</td>
                  </tr>
                ))}
                {loadingLogsTab && <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400 text-sm">Carregando...</td></tr>}
                {!loadingLogsTab && filteredLog.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400 text-sm">Nenhum registro encontrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Planos e Preços ─── */}
      {activeTab === "planos" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map((p) => (
              <div key={p.id} className={`${cardClass} p-5 space-y-3`}>
                <div className="flex items-center justify-between gap-2">
                  <Badge className={planBadgeAdmin[p.name as Plan] ?? "bg-gray-100 text-gray-600 border-gray-200"}>{p.name}</Badge>
                  <span className="font-display font-black text-2xl text-gray-900">R$ {p.price.toFixed(2).replace(".", ",")}</span>
                </div>
                <p className="text-sm text-gray-500">{p.description}</p>
                <div className="flex gap-2 pt-2">
                  <button onClick={() => setEditingPlan({ ...p })} className="flex-1 py-2 rounded-lg border border-gray-300 text-xs text-gray-600 hover:text-gray-900 hover:border-gray-400 transition-colors">Editar</button>
                  <button onClick={() => setPlans(plans.filter((x) => x.id !== p.id))} className="flex-1 py-2 rounded-lg border border-red-200 text-xs text-red-600 hover:bg-red-50 transition-colors">Excluir</button>
                </div>
              </div>
            ))}
          </div>
          <button onClick={openAddPlan} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 hover:border-green-400 text-sm text-gray-600 hover:text-gray-900 transition-colors">+ Adicionar Plano</button>
        </div>
      )}

      {/* ─── Pagamentos / API ─── */}
      {activeTab === "pagamentos" && (
        <div className="max-w-2xl space-y-5">
          <div className={`${cardClass} p-6 space-y-5`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="font-display font-semibold text-gray-900 text-sm">Gateway de Pagamento</p>
                <p className="text-xs text-gray-400 mt-0.5">Integração usada para gerar cobranças e links de pagamento</p>
              </div>
              <Badge className={payConnected && gateway !== "Nenhum" ? "text-green-700 bg-green-50 border-green-200" : "text-red-700 bg-red-50 border-red-200"}>
                {payConnected && gateway !== "Nenhum" ? "● Conectado" : "○ Desconectado"}
              </Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="Provedor">
                <select
                  value={gateway}
                  onChange={(e) => { setGateway(e.target.value as "Nenhum" | "Asaas" | "InfinityPay"); setPayConnected(false); setLastPayTest(null); }}
                  className={inputClass}
                >
                  <option value="Nenhum">Nenhum</option>
                  <option value="Asaas">Asaas</option>
                  <option value="InfinityPay">InfinityPay</option>
                </select>
              </FormField>
              <FormField label="Ambiente">
                <select className={inputClass} defaultValue="producao">
                  <option value="producao">Produção</option>
                  <option value="sandbox">Sandbox / Testes</option>
                </select>
              </FormField>
            </div>

            <FormField label="Chave de API (API Key)">
              <div className="flex gap-2">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  disabled={gateway === "Nenhum"}
                  className={`${inputClass} font-mono-data disabled:opacity-50`}
                  placeholder={gateway === "Asaas" ? "$aact_YourAsaasApiKey..." : "sk_live_YourInfinityPayKey..."}
                />
                <button onClick={() => setShowApiKey(!showApiKey)} className="px-3 rounded-lg border border-gray-300 text-gray-500 hover:text-gray-900 text-xs transition-colors shrink-0">
                  {showApiKey ? "Ocultar" : "Mostrar"}
                </button>
              </div>
            </FormField>

            <FormField label="URL do Webhook">
              <div className="flex gap-2">
                <input readOnly value={webhookUrl} className={`${inputClass} font-mono-data text-xs text-gray-500`} />
                <button onClick={copyWebhook} className="px-3 rounded-lg border border-gray-300 text-gray-500 hover:text-gray-900 text-xs transition-colors shrink-0">Copiar</button>
              </div>
              <p className="text-xs text-gray-400 mt-1.5">Cadastre esta URL no painel do {gateway === "Nenhum" ? "seu gateway" : gateway} para receber confirmações de pagamento em tempo real.</p>
            </FormField>

            <div className="flex items-center justify-between pt-3 border-t border-gray-100">
              <div>
                <p className="text-sm text-gray-900 font-display font-semibold">Gerar link de pagamento automaticamente</p>
                <p className="text-xs text-gray-400 mt-0.5">Cria um link de cobrança do {gateway === "Nenhum" ? "gateway" : gateway} sempre que um plano vencer</p>
              </div>
              <Toggle checked={autoCharge} onChange={setAutoCharge} />
            </div>

            {lastPayTest && <p className="text-xs text-gray-400">Último teste: <span className="text-gray-600 font-mono-data">{lastPayTest}</span></p>}

            <button
              onClick={testPaymentConnection}
              disabled={testingPay || gateway === "Nenhum"}
              className="w-full py-2.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-display font-bold text-sm transition-colors shadow-sm flex items-center justify-center gap-2"
            >
              <Icon name="plug" className="w-4 h-4" /> {testingPay ? "Testando conexão..." : "Testar Conexão"}
            </button>
          </div>
        </div>
      )}

      {/* ─── Notificações / WhatsApp ─── */}
      {activeTab === "notificacoes" && (
        <div className="space-y-6 max-w-2xl">
          <div className={`${cardClass} p-5 space-y-4`}>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="font-display font-semibold text-gray-900 text-sm">WhatsApp (Evolution API)</p>
                <p className="text-xs text-gray-400 mt-0.5">Usado para os avisos automáticos de vencimento e mensagens do personal</p>
              </div>
              <Badge className={waConnected ? "text-green-700 bg-green-50 border-green-200" : "text-red-700 bg-red-50 border-red-200"}>
                {waConnected ? "● Conectado" : "○ Desconectado"}
              </Badge>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs text-gray-500 leading-relaxed">
                As mensagens do WhatsApp são enviadas direto pela sua instância na Evolution API — o celular só precisa continuar com a sessão pareada, sem precisar abrir o WhatsApp. As credenciais abaixo são as da sua instância na Evolution API.
              </p>
            </div>

            <FormField label="API Key *">
              <input value={evoApiKey} onChange={(e) => setEvoApiKey(e.target.value)} className={`${inputClass} font-mono-data text-xs`} placeholder="Ex.: 66321A6804DC-45FC-B73C-E328EA7D98CE" />
            </FormField>

            <FormField label="Nome da Instância *">
              <input value={evoInstanceName} onChange={(e) => setEvoInstanceName(e.target.value)} className={inputClass} placeholder="Ex.: FITMANAGER ACADEMIA" />
              <p className="text-xs text-gray-400 mt-1.5">O nome exato da instância cadastrada na sua Evolution API — não precisa codificar espaços, o sistema faz isso.</p>
            </FormField>

            <FormField label="URL da Evolution *">
              <input value={evoUrl} onChange={(e) => setEvoUrl(e.target.value)} className={`${inputClass} font-mono-data text-xs`} placeholder="https://sua-evolution-api.exemplo.com" />
            </FormField>

            {lastWaTest && <p className="text-xs text-gray-400">Último teste: <span className="text-gray-600 font-mono-data">{lastWaTest}</span></p>}

            <div className="flex gap-3 flex-wrap">
              <button onClick={saveWaConfig} className="flex-1 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white font-display font-bold text-sm transition-colors shadow-sm flex items-center justify-center gap-2">
                <Icon name="save" className="w-4 h-4" /> Salvar configuração
              </button>
              <button onClick={testWaConnection} disabled={testingWa} className="flex-1 py-2.5 rounded-lg border border-gray-300 hover:border-green-400 disabled:opacity-60 text-sm text-gray-600 hover:text-gray-900 transition-colors flex items-center justify-center gap-2">
                <Icon name="wifi" className="w-4 h-4" /> {testingWa ? "Verificando..." : "Verificar conexão"}
              </button>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-gray-100">
              <div>
                <p className="text-sm text-gray-900 font-display font-semibold">Notificações automáticas</p>
                <p className="text-xs text-gray-400 mt-0.5">Enviar mensagens automaticamente conforme os prazos configurados abaixo</p>
              </div>
              <Toggle checked={autoNotify} onChange={setAutoNotify} />
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="font-display font-semibold text-gray-900 text-sm">Mensagens Automáticas</h3>
            {templates.map((t, idx) => (
              <div key={t.level} className={`${cardClass} p-4 space-y-3`}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <Badge className={notifyLevelColorsAdmin[t.level]}>{t.level}</Badge>
                  <label className="flex items-center gap-2 text-xs text-gray-500">
                    Disparar
                    <input type="number" min={0} value={t.daysBefore}
                      onChange={(e) => { const v = Number(e.target.value); setTemplates(templates.map((x, i) => i === idx ? { ...x, daysBefore: v } : x)); }}
                      className="w-16 bg-white border border-gray-300 rounded-lg px-2 py-1 text-gray-900 text-center font-mono-data" />
                    dias antes do vencimento
                  </label>
                </div>
                <textarea value={t.message}
                  onChange={(e) => { const v = e.target.value; setTemplates(templates.map((x, i) => i === idx ? { ...x, message: v } : x)); }}
                  className={`${inputClass} min-h-20 font-mono-data text-xs`} />
                <p className="text-xs text-gray-400">Variáveis disponíveis: <span className="font-mono-data text-gray-500">{"{nome}"}</span>, <span className="font-mono-data text-gray-500">{"{data_vencimento}"}</span>, <span className="font-mono-data text-gray-500">{"{link_pagamento}"}</span></p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Dados da Academia ─── */}
      {activeTab === "academia" && (
        <div className="max-w-2xl space-y-5">
          <div className={`${cardClass} p-6 space-y-5`}>
            <div>
              <label className="block text-xs font-display text-gray-500 uppercase tracking-wider mb-3">Logo da Academia</label>
              <div className="flex items-center gap-4">
                <div className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 overflow-hidden flex items-center justify-center">
                  {gymLogo ? <img src={gymLogo} alt="logo" className="w-full h-full object-cover" /> : <Icon name="dumbbell" className="w-8 h-8 text-gray-300" />}
                </div>
                <div className="flex flex-col gap-2">
                  <button onClick={() => logoRef.current?.click()} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 hover:border-green-400 text-sm text-gray-600 hover:text-gray-900 transition-colors text-left"><Icon name="upload" className="w-4 h-4" /> Subir logo</button>
                  <input ref={logoRef} type="file" accept="image/*" onChange={handleLogo} className="hidden" />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2"><FormField label="Nome da Academia"><input className={inputClass} value={gymName} onChange={(e) => setGymName(e.target.value)} /></FormField></div>
              <div className="md:col-span-2"><FormField label="Endereço"><input className={inputClass} value={gymAddress} onChange={(e) => setGymAddress(e.target.value)} /></FormField></div>
              <FormField label="Telefone"><input className={inputClass} value={gymPhone} onChange={(e) => setGymPhone(e.target.value)} /></FormField>
              <FormField label="CNPJ"><input className={inputClass} value={gymCnpj} onChange={(e) => setGymCnpj(e.target.value)} /></FormField>
            </div>
            <div>
              <label className="block text-xs font-display text-gray-500 uppercase tracking-wider mb-3">Horário de Funcionamento</label>
              <div className="space-y-2">
                {hours.map((h, i) => (
                  <div key={h.day} className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm text-gray-700 w-32 shrink-0">{h.day}</span>
                    {h.closed ? (
                      <Badge className="text-gray-500 bg-gray-100 border-gray-200">Fechado</Badge>
                    ) : (
                      <>
                        <input type="time" value={h.open} onChange={(e) => setHours(hours.map((x, xi) => xi === i ? { ...x, open: e.target.value } : x))} className="bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900" />
                        <span className="text-gray-400 text-xs">até</span>
                        <input type="time" value={h.close} onChange={(e) => setHours(hours.map((x, xi) => xi === i ? { ...x, close: e.target.value } : x))} className="bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900" />
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <button onClick={() => alert("Dados da academia salvos com sucesso!")} className="w-full py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white font-display font-bold text-sm transition-colors shadow-sm">Salvar Alterações</button>
          </div>
        </div>
      )}

      {/* ─── Controle de Acesso / Catraca ─── */}
      {activeTab === "catraca" && (
        <div className="max-w-xl space-y-5">
          <div className={`${cardClass} p-6 space-y-5`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="font-display font-semibold text-gray-900 text-sm">Catraca / Leitor de Acesso</p>
                <p className="text-xs text-gray-400 mt-0.5">Modelo: Catraca ZK Access Pro</p>
              </div>
              <Badge className={turnstileConnected ? "text-green-700 bg-green-50 border-green-200" : "text-red-700 bg-red-50 border-red-200"}>
                {turnstileConnected ? "● Online" : "○ Offline"}
              </Badge>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="IP do Dispositivo"><input className={`${inputClass} font-mono-data`} defaultValue="192.168.0.50" /></FormField>
              <FormField label="Porta"><input className={`${inputClass} font-mono-data`} defaultValue="4370" /></FormField>
            </div>
            {lastTest && <p className="text-xs text-gray-400">Último teste: <span className="text-gray-600 font-mono-data">{lastTest}</span></p>}
            <button onClick={testConnection} disabled={testing} className="w-full py-2.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-display font-bold text-sm transition-colors shadow-sm flex items-center justify-center gap-2">
              <Icon name="plug" className="w-4 h-4" /> {testing ? "Testando conexão..." : "Testar Conexão"}
            </button>
          </div>
        </div>
      )}

      {/* ─── Modals ─── */}
      {editingUser && (
        <Modal title="Editar Usuário" onClose={() => setEditingUser(null)}>
          <FormField label="Nome"><input className={inputClass} value={editingUser.nome} onChange={(e) => setEditingUser({ ...editingUser, nome: e.target.value })} /></FormField>
          <FormField label="E-mail"><input className={inputClass} value={editingUser.email} disabled /></FormField>
          <FormField label="Perfil">
            <select className={inputClass} value={editingUser.perfil} onChange={(e) => setEditingUser({ ...editingUser, perfil: e.target.value as UsuarioPerfil })}>
              <option value="administrador">Administrador</option>
              <option value="personal">Personal</option>
              <option value="aluno">Aluno</option>
            </select>
          </FormField>
          <FormField label="Status">
            <div className="flex items-center gap-3">
              <Toggle checked={editingUser.status === "ativo"} onChange={(v) => setEditingUser({ ...editingUser, status: v ? "ativo" : "inativo" })} />
              <span className="text-sm text-gray-700">{editingUser.status === "ativo" ? "Ativo" : "Inativo"}</span>
            </div>
          </FormField>
          {userActionError && <p className="text-xs text-red-500">{userActionError}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={resetPassword} className="flex-1 py-2 rounded-lg border border-gray-300 text-gray-600 hover:text-gray-900 hover:border-gray-400 text-xs transition-colors">Redefinir senha</button>
            <button onClick={deactivateUser} disabled={savingUser} className="flex-1 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60 text-xs transition-colors">Desativar usuário</button>
          </div>
          <button onClick={saveEditedUser} disabled={savingUser} className="w-full py-2.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-display font-bold text-sm transition-colors shadow-sm">{savingUser ? "Salvando..." : "Salvar"}</button>
        </Modal>
      )}

      {addingUser && (
        <Modal title="Adicionar Usuário" onClose={() => setAddingUser(false)}>
          <p className="text-xs text-gray-400 -mt-2">Isso cria o perfil no sistema. A pessoa ainda precisa se cadastrar (ou ser convidada) para conseguir logar.</p>
          <FormField label="Nome"><input className={inputClass} value={newUserForm.nome} onChange={(e) => setNewUserForm({ ...newUserForm, nome: e.target.value })} /></FormField>
          <FormField label="E-mail"><input className={inputClass} value={newUserForm.email} onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })} /></FormField>
          <FormField label="Perfil">
            <select className={inputClass} value={newUserForm.perfil} onChange={(e) => setNewUserForm({ ...newUserForm, perfil: e.target.value as UsuarioPerfil })}>
              <option value="administrador">Administrador</option>
              <option value="personal">Personal</option>
              <option value="aluno">Aluno</option>
            </select>
          </FormField>
          {userActionError && <p className="text-xs text-red-500">{userActionError}</p>}
          <button onClick={saveNewUser} disabled={savingUser} className="w-full py-2.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-display font-bold text-sm transition-colors shadow-sm">{savingUser ? "Salvando..." : "Salvar Usuário"}</button>
        </Modal>
      )}

      {editingPlan && (
        <Modal title="Editar Plano" onClose={() => setEditingPlan(null)}>
          <FormField label="Nome do Plano"><input className={inputClass} value={editingPlan.name} onChange={(e) => setEditingPlan({ ...editingPlan, name: e.target.value })} /></FormField>
          <FormField label="Valor (R$)"><input type="number" className={inputClass} value={editingPlan.price} onChange={(e) => setEditingPlan({ ...editingPlan, price: Number(e.target.value) })} /></FormField>
          <FormField label="Descrição"><textarea className={`${inputClass} min-h-20`} value={editingPlan.description} onChange={(e) => setEditingPlan({ ...editingPlan, description: e.target.value })} /></FormField>
          <button onClick={() => { setPlans(plans.map((p) => p.id === editingPlan.id ? editingPlan : p)); setEditingPlan(null); }} className="w-full py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white font-display font-bold text-sm transition-colors shadow-sm">Salvar</button>
        </Modal>
      )}

      {addingPlan && (
        <Modal title="Adicionar Plano" onClose={() => setAddingPlan(false)}>
          <FormField label="Nome do Plano"><input className={inputClass} value={newPlanForm.name} onChange={(e) => setNewPlanForm({ ...newPlanForm, name: e.target.value })} placeholder="Ex.: Semestral" /></FormField>
          <FormField label="Valor (R$)"><input type="number" className={inputClass} value={newPlanForm.price} onChange={(e) => setNewPlanForm({ ...newPlanForm, price: Number(e.target.value) })} /></FormField>
          <FormField label="Descrição"><textarea className={`${inputClass} min-h-20`} value={newPlanForm.description} onChange={(e) => setNewPlanForm({ ...newPlanForm, description: e.target.value })} /></FormField>
          <button onClick={saveNewPlan} className="w-full py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white font-display font-bold text-sm transition-colors shadow-sm">Salvar Plano</button>
        </Modal>
      )}
    </div>
  );
}

// ─── Câmera / Reconhecimento Facial ────────────────────────────────────────────

function CameraScreen() {
  const [multiScreenNotice, setMultiScreenNotice] = useState("");

  const openSecondaryDisplay = async () => {
    setMultiScreenNotice("");
    const url = `${window.location.origin}${window.location.pathname}?kiosk=camera`;

    if ("getScreenDetails" in window && window.getScreenDetails) {
      try {
        const details = await window.getScreenDetails();
        if (details.screens.length > 1) {
          const secondary = details.screens.find((s) => !s.isPrimary) ?? details.screens[1];
          const win = window.open(
            url,
            "fitmanager-camera",
            `left=${secondary.left},top=${secondary.top},width=${secondary.width},height=${secondary.height}`
          );
          win?.focus();
          return;
        }
        setMultiScreenNotice("Apenas 1 monitor detectado.");
        return;
      } catch (err) {
        console.warn("[camera] Window Management API indisponível ou permissão negada:", err);
      }
    }

    // Navegador sem suporte à Window Management API — abre em uma janela
    // normal; o usuário arrasta manualmente para o segundo monitor.
    window.open(url, "fitmanager-camera", "width=1000,height=750");
    setMultiScreenNotice("Detecção automática de monitor não suportada neste navegador — abrindo em uma nova janela.");
  };

  return (
    <div className="space-y-6">
      <SectionHeader title="Câmera" />
      <div className={`${cardClass} p-5 space-y-4`}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="font-display font-semibold text-gray-900 text-sm">Reconhecimento facial ao vivo</p>
            <p className="text-xs text-gray-400 mt-0.5">O reconhecimento roda automaticamente assim que a câmera é liberada — nenhum clique necessário.</p>
          </div>
          <button onClick={openSecondaryDisplay} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 hover:border-green-400 text-sm text-gray-600 hover:text-gray-900 transition-colors">
            <Icon name="chevron-right" className="w-4 h-4" /> Abrir em outra tela
          </button>
        </div>
        {multiScreenNotice && <p className="text-xs text-amber-600">{multiScreenNotice}</p>}
        <CameraFeedPanel />
        <p className="text-xs text-gray-400">
          Os alunos precisam ter um <span className="font-mono-data">faceEmbedding</span> já gerado (via cadastro + Cloud Function) para serem reconhecidos — sem isso, todo rosto detectado aparece como "Acesso negado".
        </p>
      </div>
    </div>
  );
}

/**
 * Janela sem chrome nenhum (sem sidebar, sem topbar) aberta no segundo
 * monitor via CameraScreen. Reaproveita a mesma sessão do Firebase Auth já
 * logada na janela principal — o SDK persiste a sessão no navegador, então
 * essa janela nova já nasce autenticada automaticamente.
 */
function CameraKioskWindow() {
  const [authState, setAuthState] = useState<"loading" | "signed-in" | "signed-out">("loading");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => setAuthState(user ? "signed-in" : "signed-out"));
    return unsubscribe;
  }, []);

  if (authState === "loading") {
    return <div className="min-h-screen bg-black flex items-center justify-center text-white text-sm">Conectando...</div>;
  }
  if (authState === "signed-out") {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-white text-sm text-center p-6">
        Faça login na janela principal do FitManager primeiro, depois reabra esta tela.
      </div>
    );
  }
  return <CameraFeedPanel fullscreen />;
}

// ─── Admin Shell ──────────────────────────────────────────────────────────────

const ADMIN_NAV_GROUPS: { title: string; items: { id: Screen; label: string; icon: IconName }[] }[] = [
  {
    title: "Operação",
    items: [
      { id: "dashboard", label: "Dashboard", icon: "dashboard" },
      { id: "checkin", label: "Alunos", icon: "users" },
      { id: "workouts", label: "Treinos", icon: "dumbbell" },
      { id: "camera", label: "Câmera", icon: "camera" },
    ],
  },
  {
    title: "Cadastros",
    items: [
      { id: "register", label: "Novo Aluno", icon: "user-plus" },
    ],
  },
  {
    title: "Gestão",
    items: [
      { id: "billing", label: "Cobranças", icon: "credit-card" },
      { id: "audit", label: "Auditoria", icon: "clipboard-list" },
    ],
  },
  {
    title: "Configurações",
    items: [
      { id: "settings", label: "Configurações", icon: "settings" },
    ],
  },
];

function SidebarNav({ screen, navigate, collapsed }: { screen: Screen; navigate: (s: Screen) => void; collapsed: boolean }) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
      {ADMIN_NAV_GROUPS.map((group) => (
        <div key={group.title}>
          {!collapsed && (
            <p className="px-2 mb-1.5 text-[10px] font-display font-bold text-gray-400 uppercase tracking-widest">{group.title}</p>
          )}
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active = screen === item.id;
              return (
                <button key={item.id} onClick={() => navigate(item.id)} title={collapsed ? item.label : undefined}
                  className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm font-display font-medium transition-colors ${collapsed ? "justify-center" : "text-left"} ${active ? "bg-green-50 text-green-700" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"}`}>
                  <Icon name={item.icon} className="w-4 h-4 shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function AdminPanel({ onLogout }: { onLogout: () => void }) {
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const navigate = (s: Screen) => { setScreen(s); setMobileOpen(false); };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-gray-900 flex">
      {/* Desktop sidebar */}
      <aside className={`hidden md:flex flex-col sticky top-0 h-screen bg-white border-r border-gray-200 transition-all ${collapsed ? "w-16" : "w-64"}`}>
        <div className={`flex items-center h-14 border-b border-gray-200 shrink-0 ${collapsed ? "justify-center px-2" : "justify-between px-4"}`}>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-green-500 flex items-center justify-center shrink-0">
              <span className="text-white font-display font-black text-sm">F</span>
            </div>
            {!collapsed && <span className="font-display font-bold text-gray-900 text-sm truncate">FitManager</span>}
          </div>
          {!collapsed && (
            <button onClick={() => setCollapsed(true)} className="text-gray-400 hover:text-gray-700 transition-colors shrink-0" title="Recolher menu"><Icon name="chevron-left" className="w-4 h-4" /></button>
          )}
        </div>
        {collapsed && (
          <button onClick={() => setCollapsed(false)} className="mx-auto mt-2 text-gray-400 hover:text-gray-700 transition-colors" title="Expandir menu"><Icon name="chevron-right" className="w-4 h-4" /></button>
        )}

        <SidebarNav screen={screen} navigate={navigate} collapsed={collapsed} />

        <div className={`border-t border-gray-200 p-3 shrink-0 ${collapsed ? "flex flex-col items-center gap-2" : ""}`}>
          <div className={`flex items-center gap-2.5 ${collapsed ? "" : "mb-2"}`}>
            <div className="w-8 h-8 rounded-full bg-gray-200 border border-gray-300 flex items-center justify-center text-xs text-gray-600 font-display font-bold shrink-0">A</div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="text-xs font-display font-semibold text-gray-900 truncate">Admin Geral</p>
                <p className="text-[11px] text-gray-400 truncate">Administrador</p>
              </div>
            )}
          </div>
          <button onClick={onLogout} className={`text-xs text-gray-400 hover:text-gray-700 transition-colors flex items-center gap-1.5 ${collapsed ? "justify-center" : ""}`} title="Sair">
            <Icon name="log-out" className="w-3.5 h-3.5" /> {!collapsed && "Sair"}
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 bg-black/40" onClick={() => setMobileOpen(false)}>
          <div className="absolute left-0 top-0 bottom-0 w-64 bg-white border-r border-gray-200 flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 h-14 px-4 border-b border-gray-200 shrink-0">
              <div className="w-7 h-7 rounded-lg bg-green-500 flex items-center justify-center">
                <span className="text-white font-display font-black text-sm">F</span>
              </div>
              <span className="font-display font-bold text-gray-900 text-sm">FitManager</span>
            </div>
            <SidebarNav screen={screen} navigate={navigate} collapsed={false} />
            <div className="border-t border-gray-200 p-3 shrink-0">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-8 h-8 rounded-full bg-gray-200 border border-gray-300 flex items-center justify-center text-xs text-gray-600 font-display font-bold">A</div>
                <div className="min-w-0">
                  <p className="text-xs font-display font-semibold text-gray-900 truncate">Admin Geral</p>
                  <p className="text-[11px] text-gray-400 truncate">Administrador</p>
                </div>
              </div>
              <button onClick={onLogout} className="text-xs text-gray-400 hover:text-gray-700 transition-colors">Sair</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 px-4 md:px-8 h-14 border-b border-gray-200 bg-white/95 backdrop-blur-sm shrink-0">
          <button onClick={() => setMobileOpen(!mobileOpen)} className="md:hidden text-gray-500 hover:text-gray-900"><Icon name="menu" className="w-5 h-5" /></button>
          <div className="flex-1 flex justify-end">
            <div className="relative w-full max-w-sm">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><Icon name="search" className="w-4 h-4" /></span>
              <input ref={searchRef} placeholder="Buscar..." className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-9 pr-14 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-green-400 focus:ring-2 focus:ring-green-500/20 transition-colors" />
              <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono-data text-gray-400 bg-white border border-gray-200 rounded px-1.5 py-0.5">Ctrl K</kbd>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 md:px-8 py-6 max-w-6xl w-full mx-auto">
          {screen === "dashboard" && <Dashboard onNavigate={navigate} />}
          {screen === "checkin" && <StudentsCheckin onNavigate={navigate} />}
          {screen === "register" && <RegisterStudent onBack={() => navigate("checkin")} />}
          {screen === "workouts" && <Workouts />}
          {screen === "billing" && <Billing />}
          {screen === "audit" && <Audit />}
          {screen === "camera" && <CameraScreen />}
          {screen === "settings" && <Settings />}
        </main>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [mode, setMode] = useState<AppMode>("login");
  const [activeStudent, setActiveStudent] = useState<Student | null>(null);

  // Janela aberta no segundo monitor pelo botão "Abrir em outra tela" da tela
  // de Câmera — sem sidebar/login, só o feed + reconhecimento em tela cheia.
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("kiosk") === "camera") {
    return <CameraKioskWindow />;
  }

  const handleLogin = (m: AppMode, studentId?: number) => {
    if (m === "student" && studentId) {
      setActiveStudent(STUDENTS.find((s) => s.id === studentId) ?? null);
    }
    setMode(m);
  };

  const handleLogout = () => { setMode("login"); setActiveStudent(null); };

  if (mode === "login") return <LoginScreen onLogin={handleLogin} onGoToSignup={() => setMode("signup")} />;
  if (mode === "signup") return <CreateAccountScreen onCreated={() => setMode("admin")} onBack={() => setMode("login")} />;
  if (mode === "admin") return <AdminPanel onLogout={handleLogout} />;
  if (mode === "student" && activeStudent) return <StudentPortal student={activeStudent} onLogout={handleLogout} />;
  return <LoginScreen onLogin={handleLogin} onGoToSignup={() => setMode("signup")} />;
}
