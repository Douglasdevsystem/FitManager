// Aba "Quest" do portal do aluno: desafios de passatempo entre alunos da
// mesma academia. Lista de alunos (com presença online), fluxo de convite,
// "Meus desafios" (recebidos, enviados, em andamento, histórico, placar) e
// ranking. As partidas em si ficam em QuestGame.tsx.
import { useEffect, useMemo, useState } from "react";
import {
  JOGOS, estaOnline, questApi, statusEfetivo, useQuestPerfis,
  type Placar, type QuestJogo, type QuestPartida, type QuestPerfil,
} from "../lib/quest";
import { useAcademiaId } from "../lib/sessao";
import { CartaoPerfil } from "./Perfil";
import QuestGame, { QuestAvatar } from "./QuestGame";

export type QuestAba = "alunos" | "desafios" | "ranking";

function useAgora(intervaloMs = 30_000) {
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), intervaloMs);
    return () => clearInterval(t);
  }, [intervaloMs]);
  return agora;
}

function tempoRelativo(ms: number) {
  const min = Math.round(ms / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? "dia" : "dias"}`;
}

function statusPresenca(p: QuestPerfil, agora: number) {
  if (estaOnline(p, agora)) return { online: true, texto: "Online" };
  const ts = p.ultimoSinal?.toMillis?.();
  return { online: false, texto: ts ? `Visto há ${tempoRelativo(agora - ts)}` : "Offline" };
}

function AvatarPresenca({ perfil, agora, tamanho = 48 }: { perfil: QuestPerfil; agora: number; tamanho?: number }) {
  const online = estaOnline(perfil, agora);
  return (
    <span className="relative shrink-0">
      <QuestAvatar url={perfil.fotoUrl} nome={perfil.nome ?? "?"} tamanho={tamanho} />
      <span className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-[#050d1a] ${online ? "bg-green-400" : "bg-slate-600"}`} />
    </span>
  );
}

function PlacarLinha({ placar }: { placar?: Placar }) {
  return (
    <span className="font-mono-data text-[11px] text-slate-400">
      <span className="text-green-400">{placar?.v ?? 0}V</span> · <span className="text-red-300">{placar?.d ?? 0}D</span> · <span className="text-sky-300">{placar?.e ?? 0}E</span>
    </span>
  );
}

// ─── Desafiar um aluno (perfil + escolha do jogo) ─────────────────────────────

function DesafiarModal({ perfil, agora, onFechar, onEnviado }: { perfil: QuestPerfil; agora: number; onFechar: () => void; onEnviado: () => void }) {
  const [jogo, setJogo] = useState<QuestJogo | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const presenca = statusPresenca(perfil, agora);

  const enviar = async () => {
    if (!jogo) return;
    setEnviando(true);
    setErro("");
    try {
      await questApi.desafiar(perfil.alunoId, jogo);
      onEnviado();
    } catch (err) {
      setErro((err as Error).message);
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center" onClick={onFechar}>
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-[#163059] bg-[#050d1a] p-4 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <span className={`text-xs font-display font-semibold flex items-center gap-1.5 ${presenca.online ? "text-green-400" : "text-slate-500"}`}>
            <span className={`w-2 h-2 rounded-full ${presenca.online ? "bg-green-400" : "bg-slate-600"}`} /> {presenca.texto}
          </span>
          <button onClick={onFechar} className="text-slate-400 hover:text-white text-sm" aria-label="Fechar">✕</button>
        </div>

        <CartaoPerfil dados={{
          nome: perfil.nome ?? "Aluno", idade: perfil.idade, academiaNome: perfil.academiaNome, fotos: perfil.fotos ?? [],
          bio: perfil.bio, objetivos: perfil.objetivos, nivel: perfil.nivel, horario: perfil.horario,
          modalidades: perfil.modalidades, cidade: perfil.cidade, instagram: perfil.instagram,
        }} />

        <div className="rounded-xl border border-[#163059] bg-[#0f2040]/50 p-4 space-y-3">
          <p className="text-xs font-display text-slate-400 uppercase tracking-wider">Escolha o jogo</p>
          <div className="grid gap-2">
            {(Object.keys(JOGOS) as QuestJogo[]).map((j) => (
              <button key={j} type="button" onClick={() => setJogo(j)}
                className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-colors ${jogo === j ? "border-green-400 bg-green-400/10" : "border-[#163059] bg-[#163059]/20 hover:border-green-400/40"}`}>
                <span className="text-2xl w-8 text-center">{JOGOS[j].icone}</span>
                <span className="flex-1">
                  <span className="block text-sm font-display font-semibold text-white">{JOGOS[j].nome}</span>
                  <span className="block text-xs text-slate-400">{JOGOS[j].descricao}</span>
                </span>
                <span className="text-[11px]"><PlacarLinha placar={perfil.placar?.[j]} /></span>
              </button>
            ))}
          </div>
          {erro && <p className="text-xs text-red-400">{erro}</p>}
          <button onClick={enviar} disabled={!jogo || enviando}
            className="w-full py-3 rounded-xl bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-display font-bold text-sm transition-colors">
            {enviando ? "Enviando..." : jogo ? `Desafiar ${perfil.nome?.split(" ")[0]} para ${JOGOS[jogo].nome}` : "Escolha um jogo"}
          </button>
          <p className="text-[11px] text-slate-500 text-center">O convite expira em 24 horas se não for respondido.</p>
        </div>
      </div>
    </div>
  );
}

// ─── Aba: alunos ──────────────────────────────────────────────────────────────

function ListaAlunos({ perfis, meuPerfil, agora, loading, onEscolher }: {
  perfis: QuestPerfil[]; meuPerfil: QuestPerfil | null; agora: number; loading: boolean; onEscolher: (p: QuestPerfil) => void;
}) {
  const [busca, setBusca] = useState("");
  const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  const lista = useMemo(() => {
    const termo = normalizar(busca.trim());
    return perfis
      // Mesma academia (o servidor também valida ao enviar o convite).
      .filter((p) => p.alunoId !== meuPerfil?.alunoId && (p.academiaId ?? null) === (meuPerfil?.academiaId ?? null))
      .filter((p) => !termo || normalizar(p.nome ?? "").includes(termo))
      .sort((a, b) => Number(estaOnline(b, agora)) - Number(estaOnline(a, agora)) || (a.nome ?? "").localeCompare(b.nome ?? "", "pt-BR"));
  }, [perfis, meuPerfil, busca, agora]);

  const online = lista.filter((p) => estaOnline(p, agora)).length;

  return (
    <div className="space-y-3">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">🔍</span>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar aluno pelo nome"
          className="w-full bg-[#163059]/40 border border-[#163059] rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-400 transition-colors" />
      </div>
      <p className="text-xs text-slate-500">{online} {online === 1 ? "aluno online" : "alunos online"} · {lista.length} {lista.length === 1 ? "disponível" : "disponíveis"}</p>

      {loading ? (
        <p className="text-sm text-slate-500 py-8 text-center">Carregando alunos...</p>
      ) : lista.length === 0 ? (
        <div className="text-center py-10 space-y-2">
          <span className="text-4xl">🔎</span>
          <p className="text-sm text-slate-400">{busca ? "Nenhum aluno encontrado com esse nome." : "Ainda não há outros alunos com perfil visível na academia."}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {lista.map((p) => {
            const presenca = statusPresenca(p, agora);
            return (
              <button key={p.id} onClick={() => onEscolher(p)}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-[#163059] bg-[#0f2040]/50 hover:border-green-400/40 transition-colors text-left">
                <AvatarPresenca perfil={p} agora={agora} />
                <span className="flex-1 min-w-0">
                  <span className="block font-display font-semibold text-sm text-white truncate">{p.nome}{p.idade != null ? `, ${p.idade}` : ""}</span>
                  <span className={`block text-xs ${presenca.online ? "text-green-400" : "text-slate-500"}`}>{presenca.texto}</span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <PlacarLinha placar={p.placar?.total} />
                  <span className="text-xs font-display font-bold text-green-400">Desafiar ›</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Aba: meus desafios ───────────────────────────────────────────────────────

function Secao({ titulo, qtd, children }: { titulo: string; qtd: number; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-display text-slate-400 uppercase tracking-wider">{titulo} <span className="text-slate-600">({qtd})</span></p>
      {children}
    </div>
  );
}

function MeusDesafios({ partidas, meuId, meuPerfil, agora, onAbrir }: {
  partidas: QuestPartida[]; meuId: string; meuPerfil: QuestPerfil | null; agora: number; onAbrir: (id: string) => void;
}) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [permissao, setPermissao] = useState(() => (typeof Notification !== "undefined" ? Notification.permission : "denied"));

  const recebidos = partidas.filter((p) => statusEfetivo(p) === "pendente" && p.desafiadoId === meuId);
  const enviados = partidas.filter((p) => statusEfetivo(p) === "pendente" && p.desafianteId === meuId);
  const andamento = partidas.filter((p) => p.status === "andamento")
    .sort((a, b) => Number(b.vez === meuId) - Number(a.vez === meuId));
  const historico = partidas.filter((p) => ["finalizada", "recusado", "cancelado", "expirado"].includes(statusEfetivo(p)));

  const responder = async (id: string, acao: "aceitar" | "recusar" | "cancelar") => {
    setOcupado(id);
    setErro("");
    try {
      await questApi.responder(id, acao);
      if (acao === "aceitar") onAbrir(id);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const oponente = (p: QuestPartida) => p.jogadores.find((id) => id !== meuId)!;
  const Linha = ({ p, children, onClick }: { p: QuestPartida; children: React.ReactNode; onClick?: () => void }) => {
    const op = oponente(p);
    const Tag = onClick ? "button" : "div";
    return (
      <Tag onClick={onClick} className={`w-full flex items-center gap-3 p-3 rounded-xl border border-[#163059] bg-[#0f2040]/50 text-left ${onClick ? "hover:border-green-400/40 transition-colors" : ""}`}>
        <QuestAvatar url={p.fotos[op]} nome={p.nomes[op] ?? "?"} tamanho={40} />
        <span className="flex-1 min-w-0">
          <span className="block font-display font-semibold text-sm text-white truncate">{p.nomes[op]}</span>
          <span className="block text-xs text-slate-400">{JOGOS[p.jogo].icone} {JOGOS[p.jogo].nome}</span>
        </span>
        {children}
      </Tag>
    );
  };

  const total = meuPerfil?.placar?.total;
  const resultado = (p: QuestPartida) => {
    const s = statusEfetivo(p);
    if (s === "finalizada") {
      if (!p.vencedorId) return <span className="text-xs font-display font-bold text-sky-300">Empate</span>;
      return p.vencedorId === meuId
        ? <span className="text-xs font-display font-bold text-green-400">Vitória</span>
        : <span className="text-xs font-display font-bold text-red-300">Derrota</span>;
    }
    const rotulos: Record<string, string> = { recusado: "Recusado", cancelado: "Cancelado", expirado: "Expirado" };
    return <span className="text-xs text-slate-500">{rotulos[s]}</span>;
  };

  return (
    <div className="space-y-5">
      {/* Placar */}
      <div className="rounded-xl border border-green-400/30 bg-green-400/5 p-4">
        <p className="text-xs font-display text-slate-400 uppercase tracking-wider mb-3">Seu placar</p>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div><p className="font-display font-black text-2xl text-green-400">{total?.v ?? 0}</p><p className="text-[11px] text-slate-400">vitórias</p></div>
          <div><p className="font-display font-black text-2xl text-red-300">{total?.d ?? 0}</p><p className="text-[11px] text-slate-400">derrotas</p></div>
          <div><p className="font-display font-black text-2xl text-sky-300">{total?.e ?? 0}</p><p className="text-[11px] text-slate-400">empates</p></div>
        </div>
        <div className="mt-3 pt-3 border-t border-green-400/20 space-y-1">
          {(Object.keys(JOGOS) as QuestJogo[]).map((j) => (
            <div key={j} className="flex items-center justify-between text-xs">
              <span className="text-slate-300">{JOGOS[j].icone} {JOGOS[j].nome}</span>
              <PlacarLinha placar={meuPerfil?.placar?.[j]} />
            </div>
          ))}
        </div>
      </div>

      {permissao === "default" && (
        <button onClick={() => Notification.requestPermission().then(setPermissao)}
          className="w-full flex items-center gap-3 p-3 rounded-xl border border-[#163059] bg-[#0f2040]/50 text-left hover:border-green-400/40">
          <span className="text-xl">🔔</span>
          <span className="text-xs text-slate-300">Ativar notificações para saber na hora quando alguém te desafiar</span>
        </button>
      )}

      {erro && <p className="text-sm text-red-400 text-center">{erro}</p>}

      <Secao titulo="Convites recebidos" qtd={recebidos.length}>
        {recebidos.length === 0 && <p className="text-xs text-slate-500">Nenhum convite no momento.</p>}
        {recebidos.map((p) => (
          <div key={p.id} className="rounded-xl border border-green-400/40 bg-green-400/5 p-3 space-y-3">
            <div className="flex items-center gap-3">
              <QuestAvatar url={p.fotos[p.desafianteId]} nome={p.nomes[p.desafianteId] ?? "?"} tamanho={40} />
              <p className="flex-1 text-sm text-white"><strong className="font-display">{p.nomes[p.desafianteId]}</strong> te desafiou para <strong className="font-display">{JOGOS[p.jogo].nome}</strong> {JOGOS[p.jogo].icone}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => responder(p.id, "aceitar")} disabled={ocupado === p.id} className="flex-1 py-2 rounded-lg bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black text-sm font-display font-bold">Aceitar</button>
              <button onClick={() => responder(p.id, "recusar")} disabled={ocupado === p.id} className="flex-1 py-2 rounded-lg border border-[#163059] text-slate-300 hover:text-white text-sm font-display">Recusar</button>
            </div>
            <p className="text-[11px] text-slate-500 text-right">Expira em {tempoRelativo(new Date(p.expiraEm).getTime() - agora)}</p>
          </div>
        ))}
      </Secao>

      <Secao titulo="Partidas em andamento" qtd={andamento.length}>
        {andamento.length === 0 && <p className="text-xs text-slate-500">Nenhuma partida em andamento.</p>}
        {andamento.map((p) => (
          <Linha key={p.id} p={p} onClick={() => onAbrir(p.id)}>
            {p.vez === meuId
              ? <span className="px-2.5 py-1 rounded-full bg-green-400/15 text-green-400 text-[11px] font-display font-bold flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />Sua vez</span>
              : <span className="px-2.5 py-1 rounded-full bg-[#163059]/60 text-slate-400 text-[11px] font-display">Vez do oponente</span>}
          </Linha>
        ))}
      </Secao>

      <Secao titulo="Convites enviados" qtd={enviados.length}>
        {enviados.length === 0 && <p className="text-xs text-slate-500">Nenhum convite aguardando resposta.</p>}
        {enviados.map((p) => (
          <Linha key={p.id} p={p}>
            <span className="flex flex-col items-end gap-1">
              <span className="text-[11px] text-slate-500">expira em {tempoRelativo(new Date(p.expiraEm).getTime() - agora)}</span>
              <button onClick={() => responder(p.id, "cancelar")} disabled={ocupado === p.id} className="text-[11px] text-red-300 hover:text-red-200 font-display font-semibold">Cancelar</button>
            </span>
          </Linha>
        ))}
      </Secao>

      <Secao titulo="Histórico" qtd={historico.length}>
        {historico.length === 0 && <p className="text-xs text-slate-500">Suas partidas encerradas aparecem aqui.</p>}
        {historico.slice(0, 30).map((p) => (
          <Linha key={p.id} p={p} onClick={p.status === "finalizada" ? () => onAbrir(p.id) : undefined}>
            <span className="flex flex-col items-end gap-0.5">
              {resultado(p)}
              <span className="text-[10px] text-slate-600">{new Date(p.finalizadoEm ?? p.atualizadoEm).toLocaleDateString("pt-BR")}</span>
            </span>
          </Linha>
        ))}
      </Secao>
    </div>
  );
}

// ─── Aba: ranking ─────────────────────────────────────────────────────────────

function Ranking({ perfis, meuPerfil }: { perfis: QuestPerfil[]; meuPerfil: QuestPerfil | null }) {
  const [filtro, setFiltro] = useState<QuestJogo | "total">("total");
  const lista = perfis
    .filter((p) => (p.academiaId ?? null) === (meuPerfil?.academiaId ?? null))
    .map((p) => ({ p, placar: p.placar?.[filtro] ?? {} }))
    .filter(({ placar }) => (placar.v ?? 0) + (placar.d ?? 0) + (placar.e ?? 0) > 0)
    .sort((a, b) => (b.placar.v ?? 0) - (a.placar.v ?? 0) || (a.placar.d ?? 0) - (b.placar.d ?? 0) || (b.placar.e ?? 0) - (a.placar.e ?? 0));
  const medalhas = ["🥇", "🥈", "🥉"];

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {([["total", "Todos"], ...(Object.keys(JOGOS) as QuestJogo[]).map((j) => [j, `${JOGOS[j].icone} ${JOGOS[j].nome}`])] as [QuestJogo | "total", string][]).map(([id, label]) => (
          <button key={id} onClick={() => setFiltro(id)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-display font-semibold border transition-colors ${filtro === id ? "border-green-400 bg-green-400/15 text-green-400" : "border-[#163059] text-slate-400 hover:text-white"}`}>
            {label}
          </button>
        ))}
      </div>

      {lista.length === 0 ? (
        <div className="text-center py-10 space-y-2">
          <span className="text-4xl">🏆</span>
          <p className="text-sm text-slate-400">Ninguém pontuou aqui ainda. Que tal ser o primeiro?</p>
        </div>
      ) : (
        <div className="space-y-2">
          {lista.map(({ p, placar }, i) => {
            const eu = p.alunoId === meuPerfil?.alunoId;
            return (
              <div key={p.id} className={`flex items-center gap-3 p-3 rounded-xl border ${eu ? "border-green-400/50 bg-green-400/5" : "border-[#163059] bg-[#0f2040]/50"}`}>
                <span className="w-7 text-center font-display font-black text-lg text-slate-400">{medalhas[i] ?? `${i + 1}º`}</span>
                <QuestAvatar url={p.fotoUrl} nome={p.nome ?? "?"} tamanho={36} />
                <span className="flex-1 min-w-0 font-display font-semibold text-sm text-white truncate">{eu ? "Você" : p.nome}</span>
                <span className="text-right">
                  <span className="block font-display font-black text-green-400 text-lg leading-none">{placar.v ?? 0}</span>
                  <span className="text-[10px] text-slate-500">{placar.d ?? 0}D · {placar.e ?? 0}E</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-slate-500 text-center">Ordenado por vitórias; em caso de empate, menos derrotas fica à frente.</p>
    </div>
  );
}

// ─── Tela ─────────────────────────────────────────────────────────────────────

export default function Quest({ meuId, meuPerfil, partidas, pronto, erroPresenca, abaInicial = "alunos", onAbrirPerfil }: {
  meuId: string;
  meuPerfil: QuestPerfil | null;
  partidas: QuestPartida[];
  pronto: boolean;
  erroPresenca: string | null;
  abaInicial?: QuestAba;
  onAbrirPerfil: () => void;
}) {
  const [aba, setAba] = useState<QuestAba>(abaInicial);
  const [desafiando, setDesafiando] = useState<QuestPerfil | null>(null);
  const [partidaAberta, setPartidaAberta] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");
  const agora = useAgora();
  const { data: perfis, loading } = useQuestPerfis(useAcademiaId(), pronto);

  const partida = partidas.find((p) => p.id === partidaAberta);
  if (partida && (partida.status === "andamento" || partida.status === "finalizada")) {
    return <QuestGame partida={partida} meuId={meuId} onVoltar={() => setPartidaAberta(null)} />;
  }

  const pendentesRecebidos = partidas.filter((p) => statusEfetivo(p) === "pendente" && p.desafiadoId === meuId).length;
  const minhaVez = partidas.filter((p) => p.status === "andamento" && p.vez === meuId).length;
  const visivel = meuPerfil?.visivel === true;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-slate-400 font-display uppercase tracking-widest mb-1">Desafie seus colegas</p>
        <h1 className="font-display font-black text-3xl text-white">Quest</h1>
      </div>

      {erroPresenca && <p className="rounded-xl border border-red-400/30 bg-red-400/5 p-3 text-sm text-red-300">{erroPresenca}</p>}

      {pronto && !visivel && (
        <button onClick={onAbrirPerfil} className="w-full rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 flex gap-3 text-left hover:bg-amber-400/10 transition-colors">
          <span className="text-xl">🙈</span>
          <span>
            <span className="block font-display font-semibold text-amber-300 text-sm">Seu perfil está oculto</span>
            <span className="block text-xs text-slate-400 mt-0.5">Para desafiar e aparecer para os colegas, ative "Perfil visível" em Perfil › Privacidade. <span className="text-green-400 font-semibold">Abrir perfil ›</span></span>
          </span>
        </button>
      )}

      {aviso && <p className="rounded-xl border border-green-400/30 bg-green-400/5 p-3 text-sm text-green-300 text-center">{aviso}</p>}

      <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#0f2040] border border-[#163059]">
        {([["alunos", "Alunos", 0], ["desafios", "Meus desafios", pendentesRecebidos + minhaVez], ["ranking", "Ranking", 0]] as [QuestAba, string, number][]).map(([id, label, n]) => (
          <button key={id} onClick={() => { setAba(id); setAviso(""); }}
            className={`relative py-2 rounded-lg text-xs font-display font-semibold transition-colors ${aba === id ? "bg-green-400/15 text-green-400" : "text-slate-400 hover:text-white"}`}>
            {label}
            {n > 0 && <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-green-500 text-black text-[10px] font-bold flex items-center justify-center">{n}</span>}
          </button>
        ))}
      </div>

      {aba === "alunos" && (
        <ListaAlunos perfis={perfis} meuPerfil={meuPerfil} agora={agora} loading={!pronto || loading}
          onEscolher={(p) => (visivel ? setDesafiando(p) : onAbrirPerfil())} />
      )}
      {aba === "desafios" && <MeusDesafios partidas={partidas} meuId={meuId} meuPerfil={meuPerfil} agora={agora} onAbrir={setPartidaAberta} />}
      {aba === "ranking" && <Ranking perfis={perfis} meuPerfil={meuPerfil} />}

      {desafiando && (
        <DesafiarModal perfil={desafiando} agora={agora} onFechar={() => setDesafiando(null)}
          onEnviado={() => { setDesafiando(null); setAba("desafios"); setAviso(`Convite enviado para ${desafiando.nome}! Aguarde a resposta.`); }} />
      )}
    </div>
  );
}
