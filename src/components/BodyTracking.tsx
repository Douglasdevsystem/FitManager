// Aba "Acompanhamento" do portal do aluno: dados básicos + IMC, meta de peso,
// medidas corporais (padrão de avaliação física) e histórico de avaliações.
// Cada avaliação salva vira um documento em
// alunos/{alunoId}/fitmanager_AvaliacoesFisicas — a equipe (admin/personal)
// lê a mesma subcoleção pela ficha do aluno (AvaliacoesFisicasPanel abaixo).
import { useEffect, useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db, COLLECTIONS } from "../lib/firebase";
import { useAvaliacoesFisicas } from "../lib/hooks";
import type { AvaliacaoFisica, MedidasCorporais, Sexo } from "../lib/types";

// ─── Configuração dos campos ──────────────────────────────────────────────────

type MedidaKey = keyof MedidasCorporais;

interface CampoConfig {
  label: string;
  unit: string;
  min: number;
  max: number;
  integer?: boolean;
}

// Limites plausíveis para adultos/adolescentes — fora disso é quase certamente erro de digitação.
const BASICOS = {
  peso: { label: "Peso atual", unit: "kg", min: 20, max: 350 },
  altura: { label: "Altura", unit: "cm", min: 100, max: 250 },
  idade: { label: "Idade", unit: "anos", min: 10, max: 110, integer: true },
  pesoMeta: { label: "Peso desejado", unit: "kg", min: 30, max: 300 },
  gordura: { label: "% de gordura corporal (opcional)", unit: "%", min: 3, max: 60 },
} satisfies Record<string, CampoConfig>;

type BasicoKey = keyof typeof BASICOS;

const MEDIDAS: { grupo: string; campos: (CampoConfig & { key: MedidaKey })[] }[] = [
  {
    grupo: "Tronco",
    campos: [
      { key: "pescoco", label: "Pescoço", unit: "cm", min: 20, max: 70 },
      { key: "ombros", label: "Ombros", unit: "cm", min: 60, max: 180 },
      { key: "torax", label: "Tórax / peitoral", unit: "cm", min: 50, max: 180 },
      { key: "cintura", label: "Cintura", unit: "cm", min: 40, max: 200 },
      { key: "abdomen", label: "Abdômen", unit: "cm", min: 40, max: 220 },
      { key: "quadril", label: "Quadril", unit: "cm", min: 50, max: 200 },
    ],
  },
  {
    grupo: "Braços",
    campos: [
      { key: "bracoDirRelaxado", label: "Braço dir. relaxado", unit: "cm", min: 15, max: 70 },
      { key: "bracoDirContraido", label: "Braço dir. contraído", unit: "cm", min: 15, max: 75 },
      { key: "bracoEsqRelaxado", label: "Braço esq. relaxado", unit: "cm", min: 15, max: 70 },
      { key: "bracoEsqContraido", label: "Braço esq. contraído", unit: "cm", min: 15, max: 75 },
      { key: "antebraco", label: "Antebraço", unit: "cm", min: 15, max: 55 },
    ],
  },
  {
    grupo: "Pernas",
    campos: [
      { key: "coxaDir", label: "Coxa direita", unit: "cm", min: 30, max: 110 },
      { key: "coxaEsq", label: "Coxa esquerda", unit: "cm", min: 30, max: 110 },
      { key: "panturrilhaDir", label: "Panturrilha direita", unit: "cm", min: 20, max: 70 },
      { key: "panturrilhaEsq", label: "Panturrilha esquerda", unit: "cm", min: 20, max: 70 },
    ],
  },
];

const TODAS_MEDIDAS = MEDIDAS.flatMap((g) => g.campos);

// ─── Cálculos ─────────────────────────────────────────────────────────────────

export function calcularImc(pesoKg: number, alturaCm: number) {
  const m = alturaCm / 100;
  return pesoKg / (m * m);
}

const IMC_FAIXAS = [
  { ate: 18.5, label: "Abaixo do peso", text: "text-sky-400", bg: "bg-sky-400" },
  { ate: 25, label: "Peso normal", text: "text-green-400", bg: "bg-green-400" },
  { ate: 30, label: "Sobrepeso", text: "text-amber-400", bg: "bg-amber-400" },
  { ate: 35, label: "Obesidade grau I", text: "text-orange-400", bg: "bg-orange-400" },
  { ate: 40, label: "Obesidade grau II", text: "text-red-400", bg: "bg-red-400" },
  { ate: Infinity, label: "Obesidade grau III", text: "text-rose-500", bg: "bg-rose-500" },
];

export function classificarImc(imc: number) {
  return IMC_FAIXAS.find((f) => imc < f.ate) ?? IMC_FAIXAS[IMC_FAIXAS.length - 1];
}

// Referência da OMS para relação cintura/quadril.
function classificarRcq(rcq: number, sexo: Sexo) {
  const [moderado, alto] = sexo === "masculino" ? [0.9, 1.0] : [0.8, 0.85];
  if (rcq < moderado) return { label: "Risco baixo", text: "text-green-400" };
  if (rcq < alto) return { label: "Risco moderado", text: "text-amber-400" };
  return { label: "Risco alto", text: "text-red-400" };
}

const IMC_ESCALA_MIN = 15;
const IMC_ESCALA_MAX = 45;

function fmt(n: number, casas = 1) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: casas });
}

function formatarData(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("pt-BR");
}

/** "" → null; texto não numérico → NaN (tratado como inválido). Aceita vírgula decimal. */
function parseNumero(valor: string): number | null {
  const t = valor.trim().replace(",", ".");
  if (t === "") return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

function validar(valor: string, cfg: CampoConfig): string | null {
  const n = parseNumero(valor);
  if (n === null) return null;
  if (valor.trim().startsWith("-")) return "Valores negativos não são permitidos";
  if (Number.isNaN(n)) return "Digite apenas números";
  if (cfg.integer && !Number.isInteger(n)) return "Use um número inteiro";
  if (n < cfg.min || n > cfg.max) return `Entre ${fmt(cfg.min)} e ${fmt(cfg.max)} ${cfg.unit}`;
  return null;
}

/** Valor numérico válido ou null (vazio/inválido). */
function valorValido(valor: string, cfg: CampoConfig): number | null {
  const n = parseNumero(valor);
  return n === null || validar(valor, cfg) ? null : n;
}

// ─── Componentes de UI (tema escuro do portal) ────────────────────────────────

function Card({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[#163059] bg-[#0f2040]/50 p-4 space-y-4">
      <div>
        <p className="text-xs font-display text-slate-400 uppercase tracking-wider">{titulo}</p>
        {subtitulo && <p className="text-xs text-slate-500 mt-1">{subtitulo}</p>}
      </div>
      {children}
    </section>
  );
}

function CampoNumero({ cfg, valor, onChange, dica }: { cfg: CampoConfig; valor: string; onChange: (v: string) => void; dica?: string }) {
  const erro = validar(valor, cfg);
  return (
    <label className="block">
      <span className="block text-xs text-slate-400 mb-1.5">{cfg.label}</span>
      <div className="relative">
        <input
          type="text"
          inputMode={cfg.integer ? "numeric" : "decimal"}
          value={valor}
          placeholder={dica ?? "—"}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full bg-[#163059]/40 border rounded-lg pl-3 pr-12 py-2.5 text-sm text-white font-mono-data placeholder-slate-600 focus:outline-none transition-colors ${erro ? "border-red-400/70 focus:border-red-400" : "border-[#163059] focus:border-green-400"}`}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 pointer-events-none">{cfg.unit}</span>
      </div>
      {erro && <span className="block text-[11px] text-red-400 mt-1">{erro}</span>}
    </label>
  );
}

function BarraImc({ imc }: { imc: number }) {
  const total = IMC_ESCALA_MAX - IMC_ESCALA_MIN;
  const pos = Math.min(Math.max((imc - IMC_ESCALA_MIN) / total, 0), 1) * 100;
  let inicio = IMC_ESCALA_MIN;
  return (
    <div className="pt-3">
      <div className="relative">
        <div className="flex h-2.5 rounded-full overflow-hidden">
          {IMC_FAIXAS.map((f) => {
            const fim = Math.min(f.ate, IMC_ESCALA_MAX);
            const largura = ((fim - inicio) / total) * 100;
            inicio = fim;
            return <div key={f.label} className={`${f.bg} opacity-80`} style={{ width: `${largura}%` }} />;
          })}
        </div>
        <div className="absolute -top-2.5 w-0.5 h-5 bg-white rounded-full shadow" style={{ left: `calc(${pos}% - 1px)` }} />
      </div>
      <div className="flex justify-between text-[10px] text-slate-500 mt-1.5 font-mono-data">
        <span>15</span><span>18,5</span><span>25</span><span>30</span><span>35</span><span>40</span><span>45+</span>
      </div>
    </div>
  );
}

// ─── Tela do aluno ────────────────────────────────────────────────────────────

type FormState = Record<BasicoKey | MedidaKey, string>;

const FORM_VAZIO = Object.fromEntries(
  [...Object.keys(BASICOS), ...TODAS_MEDIDAS.map((c) => c.key)].map((k) => [k, ""]),
) as FormState;

export default function Acompanhamento({ alunoId }: { alunoId: string }) {
  const { data: avaliacoes, loading } = useAvaliacoesFisicas(alunoId);
  const [form, setForm] = useState<FormState>(FORM_VAZIO);
  const [sexo, setSexo] = useState<Sexo | null>(null);
  const [preenchido, setPreenchido] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const ultima = avaliacoes[0] ?? null;
  const primeira = avaliacoes[avaliacoes.length - 1] ?? null;

  // Pré-preenche dados básicos e meta com a última avaliação (medidas ficam
  // em branco, com o valor anterior como dica, para serem medidas de novo).
  useEffect(() => {
    if (loading || preenchido) return;
    setPreenchido(true);
    if (!ultima) return;
    setForm((f) => ({
      ...f,
      peso: String(ultima.peso).replace(".", ","),
      altura: String(ultima.altura).replace(".", ","),
      idade: String(ultima.idade),
      pesoMeta: ultima.pesoMeta != null ? String(ultima.pesoMeta).replace(".", ",") : "",
    }));
    setSexo(ultima.sexo);
  }, [loading, preenchido, ultima]);

  const set = (k: keyof FormState) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setMensagem(null);
  };

  const peso = valorValido(form.peso, BASICOS.peso);
  const altura = valorValido(form.altura, BASICOS.altura);
  const idade = valorValido(form.idade, BASICOS.idade);
  const pesoMeta = valorValido(form.pesoMeta, BASICOS.pesoMeta);
  const gordura = valorValido(form.gordura, BASICOS.gordura);
  const cintura = valorValido(form.cintura, TODAS_MEDIDAS.find((c) => c.key === "cintura")!);
  const quadril = valorValido(form.quadril, TODAS_MEDIDAS.find((c) => c.key === "quadril")!);

  const imc = peso != null && altura != null ? calcularImc(peso, altura) : null;
  const faixaImc = imc != null ? classificarImc(imc) : null;
  const rcq = cintura != null && quadril != null ? cintura / quadril : null;

  const handleSalvar = async () => {
    const camposComErro = [
      ...(Object.keys(BASICOS) as BasicoKey[]).filter((k) => validar(form[k], BASICOS[k])),
      ...TODAS_MEDIDAS.filter((c) => validar(form[c.key], c)),
    ];
    if (camposComErro.length > 0) {
      setMensagem({ tipo: "erro", texto: "Corrija os campos destacados em vermelho antes de salvar." });
      return;
    }
    if (peso == null || altura == null || idade == null || !sexo || imc == null) {
      setMensagem({ tipo: "erro", texto: "Preencha peso, altura, idade e sexo para salvar a avaliação." });
      return;
    }

    const medidas = Object.fromEntries(
      TODAS_MEDIDAS.map((c) => [c.key, valorValido(form[c.key], c)]),
    ) as unknown as MedidasCorporais;

    setSalvando(true);
    try {
      await addDoc(collection(db, COLLECTIONS.alunos, alunoId, COLLECTIONS.avaliacoesFisicas), {
        data: new Date().toISOString(),
        peso,
        altura,
        idade,
        sexo,
        pesoMeta,
        imc: Math.round(imc * 10) / 10,
        medidas,
        percentualGordura: gordura,
        rcq: rcq != null ? Math.round(rcq * 100) / 100 : null,
        criadoEm: serverTimestamp(),
      });
      setForm((f) => ({ ...f, gordura: "", ...Object.fromEntries(TODAS_MEDIDAS.map((c) => [c.key, ""])) }));
      setMensagem({ tipo: "ok", texto: "Avaliação salva! Seu personal já consegue visualizá-la." });
    } catch (err) {
      console.error("[Acompanhamento] falha ao salvar avaliação:", err);
      setMensagem({ tipo: "erro", texto: "Não foi possível salvar a avaliação. Verifique sua conexão e tente novamente." });
    } finally {
      setSalvando(false);
    }
  };

  // Meta
  let metaInfo: React.ReactNode = null;
  if (pesoMeta != null && peso != null && altura != null) {
    const pesoInicial = primeira?.peso ?? peso;
    const falta = peso - pesoMeta;
    const atingida = Math.abs(falta) < 0.05;
    const progresso = atingida
      ? 100
      : pesoInicial === pesoMeta
        ? 0
        : Math.min(Math.max(((pesoInicial - peso) / (pesoInicial - pesoMeta)) * 100, 0), 100);
    const imcMeta = calcularImc(pesoMeta, altura);
    const faixaMeta = classificarImc(imcMeta);
    const m2 = (altura / 100) ** 2;
    const saudavelMin = 18.5 * m2;
    const saudavelMax = 24.9 * m2;

    metaInfo = (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-[#163059]/40 p-3 text-center">
            <p className="font-display font-bold text-xl text-green-400 font-mono-data">{atingida ? "0" : fmt(Math.abs(falta))}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{atingida ? "kg · meta atingida!" : falta > 0 ? "kg para perder" : "kg para ganhar"}</p>
          </div>
          <div className="rounded-lg bg-[#163059]/40 p-3 text-center">
            <p className="font-display font-bold text-xl text-white font-mono-data">{Math.round(progresso)}%</p>
            <p className="text-[11px] text-slate-400 mt-0.5">do caminho</p>
          </div>
          <div className="rounded-lg bg-[#163059]/40 p-3 text-center">
            <p className={`font-display font-bold text-xl font-mono-data ${faixaMeta.text}`}>{fmt(imcMeta)}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">IMC na meta</p>
          </div>
        </div>
        <div>
          <div className="h-2 rounded-full bg-[#163059]">
            <div className="h-2 rounded-full bg-green-400 transition-all" style={{ width: `${progresso}%` }} />
          </div>
          <p className="text-[11px] text-slate-500 mt-1.5 font-mono-data">
            Início: {fmt(pesoInicial)} kg · Atual: {fmt(peso)} kg · Meta: {fmt(pesoMeta)} kg
          </p>
        </div>
        {(imcMeta < 18.5 || imcMeta > 24.9) && (
          <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 flex gap-2.5">
            <span className="text-amber-400 shrink-0">💡</span>
            <p className="text-xs text-slate-300 leading-relaxed">
              Com esse peso, seu IMC ficaria em <strong className="text-white">{fmt(imcMeta)}</strong> ({faixaMeta.label.toLowerCase()}), fora da faixa considerada saudável (18,5 a 24,9).
              Para a sua altura, essa faixa vai de <strong className="text-white">{fmt(saudavelMin)} a {fmt(saudavelMax)} kg</strong>. Que tal conversar com seu personal ou um nutricionista para ajustar a meta?
            </p>
          </div>
        )}
      </div>
    );
  }

  if (loading) return <p className="text-sm text-slate-500 py-10 text-center">Carregando acompanhamento...</p>;

  return (
    <div className="space-y-5 pb-4">
      <div>
        <p className="text-xs text-slate-400 font-display uppercase tracking-widest mb-1">Sua evolução</p>
        <h1 className="font-display font-black text-3xl text-white">Acompanhamento</h1>
        {ultima && <p className="text-xs text-slate-500 mt-1">Última avaliação em {formatarData(ultima.data)}</p>}
      </div>

      {/* 1. Dados básicos */}
      <Card titulo="Dados básicos">
        <div className="grid grid-cols-2 gap-3">
          <CampoNumero cfg={BASICOS.peso} valor={form.peso} onChange={set("peso")} />
          <CampoNumero cfg={BASICOS.altura} valor={form.altura} onChange={set("altura")} />
          <CampoNumero cfg={BASICOS.idade} valor={form.idade} onChange={set("idade")} />
          <div>
            <span className="block text-xs text-slate-400 mb-1.5">Sexo</span>
            <div className="grid grid-cols-2 gap-1.5">
              {(["masculino", "feminino"] as Sexo[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { setSexo(s); setMensagem(null); }}
                  className={`py-2.5 rounded-lg border text-xs font-display font-semibold transition-colors ${sexo === s ? "border-green-400 bg-green-400/15 text-green-400" : "border-[#163059] bg-[#163059]/40 text-slate-400 hover:text-white"}`}
                >
                  {s === "masculino" ? "Masc." : "Fem."}
                </button>
              ))}
            </div>
          </div>
        </div>

        {imc != null && faixaImc ? (
          <div className="rounded-lg border border-[#163059] bg-[#050d1a]/40 p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[11px] text-slate-400 uppercase tracking-wider font-display">Seu IMC</p>
                <p className="font-display font-black text-3xl text-white font-mono-data leading-tight">{fmt(imc)}</p>
              </div>
              <span className={`text-sm font-display font-bold ${faixaImc.text}`}>{faixaImc.label}</span>
            </div>
            <BarraImc imc={imc} />
          </div>
        ) : (
          <p className="text-xs text-slate-500">Informe peso e altura para calcular seu IMC.</p>
        )}
      </Card>

      {/* 2. Meta */}
      <Card titulo="Meta">
        <div>
          <p className="font-display font-semibold text-white text-sm mb-2">Qual peso você deseja alcançar?</p>
          <CampoNumero cfg={BASICOS.pesoMeta} valor={form.pesoMeta} onChange={set("pesoMeta")} />
        </div>
        {metaInfo ?? <p className="text-xs text-slate-500">Informe seu peso atual, sua altura e a meta para ver o progresso.</p>}
      </Card>

      {/* 3. Medidas */}
      <Card titulo="Medidas corporais" subtitulo="Em centímetros. Preencha só o que foi medido; os valores da última avaliação aparecem como referência.">
        {MEDIDAS.map((g) => (
          <div key={g.grupo}>
            <p className="text-xs font-display font-semibold text-green-400 mb-2">{g.grupo}</p>
            <div className="grid grid-cols-2 gap-3">
              {g.campos.map((c) => {
                const anterior = ultima?.medidas?.[c.key];
                return (
                  <CampoNumero key={c.key} cfg={c} valor={form[c.key]} onChange={set(c.key)} dica={anterior != null ? `últ.: ${fmt(anterior)}` : undefined} />
                );
              })}
            </div>
          </div>
        ))}
        <div className="border-t border-[#163059] pt-4">
          <CampoNumero cfg={BASICOS.gordura} valor={form.gordura} onChange={set("gordura")}
            dica={ultima?.percentualGordura != null ? `últ.: ${fmt(ultima.percentualGordura)}` : undefined} />
        </div>

        <div className="rounded-lg border border-[#163059] bg-[#050d1a]/40 p-4">
          <p className="text-[11px] text-slate-400 uppercase tracking-wider font-display">Relação cintura/quadril (RCQ)</p>
          {rcq != null && sexo ? (
            <div className="flex items-end justify-between gap-3 mt-1">
              <p className="font-display font-black text-2xl text-white font-mono-data">{rcq.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              <span className={`text-sm font-display font-bold ${classificarRcq(rcq, sexo).text}`}>{classificarRcq(rcq, sexo).label}</span>
            </div>
          ) : (
            <p className="text-xs text-slate-500 mt-1">Informe cintura, quadril e sexo para calcular.</p>
          )}
          <p className="text-[10px] text-slate-500 mt-2">
            Referência (OMS): {sexo === "feminino" ? "mulheres — risco moderado a partir de 0,80 e alto a partir de 0,85" : sexo === "masculino" ? "homens — risco moderado a partir de 0,90 e alto a partir de 1,00" : "homens ≥ 0,90 e mulheres ≥ 0,80 indicam risco aumentado"}.
          </p>
        </div>
      </Card>

      {/* Salvar */}
      <div className="space-y-2">
        {mensagem && (
          <p className={`text-sm text-center ${mensagem.tipo === "ok" ? "text-green-400" : "text-red-400"}`}>{mensagem.texto}</p>
        )}
        <button
          onClick={handleSalvar}
          disabled={salvando}
          className="w-full py-3.5 rounded-xl bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black font-display font-bold text-sm transition-colors shadow-lg shadow-green-500/10"
        >
          {salvando ? "Salvando..." : "Salvar avaliação"}
        </button>
      </div>

      {/* 4. Histórico */}
      <Card titulo="Histórico de avaliações">
        <HistoricoAvaliacoes avaliacoes={avaliacoes} tema="escuro" />
      </Card>
    </div>
  );
}

// ─── Histórico (compartilhado entre o portal do aluno e o painel da equipe) ───

const TEMAS = {
  escuro: {
    titulo: "text-white",
    texto: "text-slate-300",
    suave: "text-slate-400",
    fraco: "text-slate-500",
    item: "rounded-lg border border-[#163059] bg-[#050d1a]/40",
    divisor: "border-[#163059]",
    aumento: "text-amber-300",
    reducao: "text-sky-300",
    grade: "#163059",
    eixo: "#64748b",
    linha: "#4ade80",
    meta: "#fbbf24",
    fundoPonto: "#050d1a",
  },
  claro: {
    titulo: "text-gray-900",
    texto: "text-gray-700",
    suave: "text-gray-500",
    fraco: "text-gray-400",
    item: "rounded-lg border border-gray-200 bg-gray-50/60",
    divisor: "border-gray-200",
    aumento: "text-amber-600",
    reducao: "text-sky-600",
    grade: "#e5e7eb",
    eixo: "#9ca3af",
    linha: "#16a34a",
    meta: "#d97706",
    fundoPonto: "#ffffff",
  },
};

type Tema = keyof typeof TEMAS;

function GraficoPeso({ avaliacoes, tema }: { avaliacoes: AvaliacaoFisica[]; tema: Tema }) {
  const t = TEMAS[tema];
  const pontos = [...avaliacoes].reverse(); // mais antiga → mais recente
  if (pontos.length < 2) {
    return <p className={`text-xs ${t.fraco}`}>O gráfico de evolução do peso aparece a partir da segunda avaliação salva.</p>;
  }

  const meta = avaliacoes[0].pesoMeta;
  const W = 320, H = 150, esq = 34, dir = 10, topo = 12, base = 24;
  const valores = pontos.map((p) => p.peso).concat(meta != null ? [meta] : []);
  let min = Math.floor(Math.min(...valores) - 1);
  let max = Math.ceil(Math.max(...valores) + 1);
  if (max - min < 4) { min -= 2; max += 2; }
  const x = (i: number) => esq + (i / (pontos.length - 1)) * (W - esq - dir);
  const y = (v: number) => topo + (1 - (v - min) / (max - min)) * (H - topo - base);
  const ticks = [min, (min + max) / 2, max];

  return (
    <div>
      <p className={`text-xs font-display ${t.suave} mb-2`}>Evolução do peso (kg)</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Gráfico da evolução do peso">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={esq} x2={W - dir} y1={y(v)} y2={y(v)} stroke={t.grade} strokeWidth={1} />
            <text x={esq - 6} y={y(v) + 3} textAnchor="end" fontSize={9} fill={t.eixo}>{fmt(v)}</text>
          </g>
        ))}
        {meta != null && (
          <g>
            <line x1={esq} x2={W - dir} y1={y(meta)} y2={y(meta)} stroke={t.meta} strokeWidth={1} strokeDasharray="4 3" />
            <text x={W - dir} y={y(meta) - 4} textAnchor="end" fontSize={9} fill={t.meta}>meta {fmt(meta)}</text>
          </g>
        )}
        <polyline
          points={pontos.map((p, i) => `${x(i)},${y(p.peso)}`).join(" ")}
          fill="none" stroke={t.linha} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
        />
        {pontos.map((p, i) => (
          <circle key={p.id} cx={x(i)} cy={y(p.peso)} r={3.5} fill={t.fundoPonto} stroke={t.linha} strokeWidth={2}>
            <title>{`${formatarData(p.data)}: ${fmt(p.peso)} kg`}</title>
          </circle>
        ))}
        <text x={esq} y={H - 6} fontSize={9} fill={t.eixo}>{formatarData(pontos[0].data)}</text>
        <text x={W - dir} y={H - 6} textAnchor="end" fontSize={9} fill={t.eixo}>{formatarData(pontos[pontos.length - 1].data)}</text>
      </svg>
    </div>
  );
}

function Diferenca({ atual, anterior, tema, casas = 1 }: { atual: number | null | undefined; anterior: number | null | undefined; tema: Tema; casas?: number }) {
  if (atual == null || anterior == null) return null;
  const t = TEMAS[tema];
  const d = Math.round((atual - anterior) * 10 ** casas) / 10 ** casas;
  if (d === 0) return <span className={`text-[11px] font-mono-data ${t.fraco}`}>=</span>;
  return (
    <span className={`text-[11px] font-mono-data ${d > 0 ? t.aumento : t.reducao}`}>
      {d > 0 ? "▲ +" : "▼ −"}{fmt(Math.abs(d), casas)}
    </span>
  );
}

function HistoricoAvaliacoes({ avaliacoes, tema }: { avaliacoes: AvaliacaoFisica[]; tema: Tema }) {
  const t = TEMAS[tema];
  const [aberta, setAberta] = useState<string | null>(null);

  if (avaliacoes.length === 0) {
    return <p className={`text-sm ${t.suave}`}>Nenhuma avaliação salva ainda.</p>;
  }

  return (
    <div className="space-y-4">
      <GraficoPeso avaliacoes={avaliacoes} tema={tema} />

      <div className="space-y-2">
        {avaliacoes.map((av, i) => {
          const ant = avaliacoes[i + 1];
          const expandida = aberta === av.id;
          const linhas: { label: string; atual: number | null; anterior: number | null | undefined; unit: string; casas?: number }[] = [
            { label: "Peso", atual: av.peso, anterior: ant?.peso, unit: "kg" },
            { label: "IMC", atual: av.imc, anterior: ant?.imc, unit: "" },
            { label: "% de gordura", atual: av.percentualGordura, anterior: ant?.percentualGordura, unit: "%" },
            { label: "RCQ", atual: av.rcq, anterior: ant?.rcq, unit: "", casas: 2 },
            ...TODAS_MEDIDAS.map((c) => ({ label: c.label, atual: av.medidas?.[c.key] ?? null, anterior: ant?.medidas?.[c.key], unit: "cm" })),
          ].filter((l) => l.atual != null);

          return (
            <div key={av.id} className={t.item}>
              <button type="button" onClick={() => setAberta(expandida ? null : av.id)} className="w-full flex items-center justify-between gap-3 p-3 text-left">
                <div>
                  <p className={`font-display font-semibold text-sm ${t.titulo}`}>{formatarData(av.data)}</p>
                  <p className={`text-xs ${t.suave} mt-0.5 font-mono-data`}>
                    {fmt(av.peso)} kg · IMC {fmt(av.imc)} <span className={classificarImc(av.imc).text}>· {classificarImc(av.imc).label}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Diferenca atual={av.peso} anterior={ant?.peso} tema={tema} />
                  <span className={`text-xs ${t.fraco} transition-transform ${expandida ? "rotate-180" : ""}`}>▾</span>
                </div>
              </button>
              {expandida && (
                <div className={`border-t ${t.divisor} px-3 py-2`}>
                  {!ant && <p className={`text-[11px] ${t.fraco} py-1`}>Primeira avaliação — sem comparação anterior.</p>}
                  <div className="divide-y divide-transparent">
                    {linhas.map((l) => (
                      <div key={l.label} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                        <span className={t.suave}>{l.label}</span>
                        <span className="flex items-center gap-2">
                          <span className={`font-mono-data ${t.texto}`}>
                            {l.casas === 2 ? l.atual!.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : fmt(l.atual!)}{l.unit && ` ${l.unit}`}
                          </span>
                          <span className="w-14 text-right"><Diferenca atual={l.atual} anterior={l.anterior} tema={tema} casas={l.casas} /></span>
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className={`text-[11px] ${t.fraco} pt-1`}>{av.idade} anos · {av.altura} cm · {av.sexo === "masculino" ? "masculino" : "feminino"}{av.pesoMeta != null ? ` · meta ${fmt(av.pesoMeta)} kg` : ""}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Versão para o painel da equipe (tema claro) — usada na ficha do aluno. */
export function AvaliacoesFisicasPanel({ alunoId }: { alunoId: string }) {
  const { data: avaliacoes, loading, error } = useAvaliacoesFisicas(alunoId);
  if (loading) return <p className="text-sm text-gray-400 py-6 text-center">Carregando avaliações...</p>;
  if (error) return <p className="text-sm text-red-500">Não foi possível carregar as avaliações: {error}</p>;
  const ultima = avaliacoes[0];
  return (
    <div className="space-y-4">
      {ultima?.pesoMeta != null && (
        <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs">
          <span className="text-green-700 font-display font-medium">Meta do aluno</span>
          <span className="font-mono-data text-green-800">{fmt(ultima.pesoMeta)} kg (faltam {fmt(Math.abs(ultima.peso - ultima.pesoMeta))} kg)</span>
        </div>
      )}
      <HistoricoAvaliacoes avaliacoes={avaliacoes} tema="claro" />
    </div>
  );
}
