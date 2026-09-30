// Tela de uma partida do Quest (jogo da velha, xadrez ou memória). Só
// exibe o estado vindo do Firestore e envia a intenção de lance para a
// Cloud Function questJogar — quem decide se o lance vale é o servidor.
import { useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import {
  JOGOS, questApi,
  type EstadoMemoria, type EstadoVelha, type EstadoXadrez, type QuestPartida,
} from "../lib/quest";

function Avatar({ url, nome, tamanho = 36 }: { url?: string | null; nome: string; tamanho?: number }) {
  return url ? (
    <img src={url} alt={nome} className="rounded-full object-cover border-2 border-[#163059]" style={{ width: tamanho, height: tamanho }} />
  ) : (
    <span className="rounded-full bg-[#163059] border-2 border-[#163059] flex items-center justify-center font-display font-bold text-green-400/80"
      style={{ width: tamanho, height: tamanho, fontSize: tamanho * 0.4 }}>
      {nome.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

export { Avatar as QuestAvatar };

// ─── Jogo da velha ────────────────────────────────────────────────────────────

function TabuleiroVelha({ estado, podeJogar, onJogar }: { estado: EstadoVelha; podeJogar: boolean; onJogar: (l: unknown) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2 w-full max-w-xs mx-auto">
      {estado.tabuleiro.map((valor, i) => {
        const vencedora = estado.linhaVencedora?.includes(i);
        return (
          <button key={i} type="button" disabled={!podeJogar || !!valor} onClick={() => onJogar({ posicao: i })}
            className={`aspect-square rounded-xl border-2 flex items-center justify-center font-display font-black text-5xl transition-colors
              ${vencedora ? "border-green-400 bg-green-400/15" : "border-[#163059] bg-[#0f2040]/60"}
              ${podeJogar && !valor ? "hover:border-green-400/60 hover:bg-green-400/5" : ""}
              ${valor === "X" ? "text-green-400" : "text-sky-300"}`}>
            {valor}
          </button>
        );
      })}
    </div>
  );
}

// ─── Xadrez ───────────────────────────────────────────────────────────────────

// Glifos "cheios" para as duas cores (a cor vem do CSS); ︎ força a
// versão em texto — sem ele alguns celulares desenham ♟ como emoji.
const GLIFOS: Record<string, string> = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const PROMOCOES = [
  { id: "q", nome: "Dama" }, { id: "r", nome: "Torre" }, { id: "b", nome: "Bispo" }, { id: "n", nome: "Cavalo" },
];

function Peca({ tipo, cor }: { tipo: string; cor: "w" | "b" }) {
  return (
    <span className={`leading-none select-none ${cor === "w" ? "text-white" : "text-slate-950"}`}
      style={{
        fontSize: "min(9vw, 44px)",
        textShadow: cor === "w"
          ? "0 0 1px #000, 0 0 1px #000, 0 1px 2px rgba(0,0,0,.6)"
          : "0 0 1px rgba(255,255,255,.7), 0 1px 1px rgba(255,255,255,.25)",
      }}>
      {GLIFOS[tipo]}{"︎"}
    </span>
  );
}

function TabuleiroXadrez({ estado, minhaCor, podeJogar, onJogar }: { estado: EstadoXadrez; minhaCor: "w" | "b"; podeJogar: boolean; onJogar: (l: unknown) => void }) {
  const chess = useMemo(() => new Chess(estado.fen), [estado.fen]);
  const [selecionada, setSelecionada] = useState<Square | null>(null);
  const [promocao, setPromocao] = useState<{ from: Square; to: Square } | null>(null);

  useEffect(() => { setSelecionada(null); setPromocao(null); }, [estado.fen]);

  const destinos = useMemo(() => {
    if (!selecionada) return new Map<string, boolean>();
    const movs = chess.moves({ square: selecionada, verbose: true });
    return new Map(movs.map((m) => [m.to, !!m.promotion || m.flags.includes("c") || m.flags.includes("e")]));
  }, [chess, selecionada]);

  const tabuleiro = chess.board(); // [0] = 8ª fileira
  const fileiras = minhaCor === "w" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const colunas = minhaCor === "w" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const reiEmXeque = estado.xeque
    ? tabuleiro.flat().find((c) => c && c.type === "k" && c.color === chess.turn())?.square
    : undefined;

  const clicar = (quadrado: Square) => {
    if (!podeJogar) return;
    const peca = chess.get(quadrado);
    if (selecionada && destinos.has(quadrado)) {
      const precisaPromover = chess.moves({ square: selecionada, verbose: true }).some((m) => m.to === quadrado && m.promotion);
      if (precisaPromover) setPromocao({ from: selecionada, to: quadrado });
      else onJogar({ from: selecionada, to: quadrado });
      return;
    }
    setSelecionada(peca && peca.color === minhaCor ? (selecionada === quadrado ? null : quadrado) : null);
  };

  const pares = [];
  for (let i = 0; i < estado.san.length; i += 2) pares.push([estado.san[i], estado.san[i + 1]]);

  return (
    <div className="space-y-3">
      <div className="relative w-full max-w-md mx-auto aspect-square rounded-lg overflow-hidden border-2 border-[#163059] grid grid-cols-8 grid-rows-8">
        {fileiras.map((f) => colunas.map((c) => {
          const casa = tabuleiro[f][c];
          const quadrado = `${"abcdefgh"[c]}${8 - f}` as Square;
          const clara = (f + c) % 2 === 0;
          const ultimo = estado.ultimoLance && (estado.ultimoLance.from === quadrado || estado.ultimoLance.to === quadrado);
          const destino = destinos.get(quadrado);
          return (
            <button key={quadrado} type="button" onClick={() => clicar(quadrado)} aria-label={quadrado}
              className={`relative flex items-center justify-center ${clara ? "bg-[#dfe8d2]" : "bg-[#5f8a57]"}`}>
              {ultimo && <span className="absolute inset-0 bg-yellow-300/40" />}
              {selecionada === quadrado && <span className="absolute inset-0 bg-green-400/50" />}
              {reiEmXeque === quadrado && <span className="absolute inset-0 bg-[radial-gradient(circle,rgba(239,68,68,.95)_0%,rgba(239,68,68,.35)_60%,transparent_75%)]" />}
              {destino !== undefined && (destino && casa
                ? <span className="absolute inset-0.5 rounded-full border-4 border-black/25" />
                : <span className="absolute w-1/3 h-1/3 rounded-full bg-black/25" />)}
              {casa && <span className="relative"><Peca tipo={casa.type} cor={casa.color} /></span>}
              {c === colunas[0] && <span className={`absolute top-0.5 left-0.5 text-[9px] font-bold ${clara ? "text-[#5f8a57]" : "text-[#dfe8d2]"}`}>{8 - f}</span>}
              {f === fileiras[7] && <span className={`absolute bottom-0 right-0.5 text-[9px] font-bold ${clara ? "text-[#5f8a57]" : "text-[#dfe8d2]"}`}>{"abcdefgh"[c]}</span>}
            </button>
          );
        }))}

        {promocao && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center p-4" onClick={() => setPromocao(null)}>
            <div className="rounded-xl bg-[#091426] border border-[#163059] p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
              <p className="font-display font-bold text-white text-sm text-center">Promover peão para:</p>
              <div className="grid grid-cols-4 gap-2">
                {PROMOCOES.map((p) => (
                  <button key={p.id} onClick={() => { onJogar({ ...promocao, promotion: p.id }); setPromocao(null); }}
                    className="flex flex-col items-center gap-1 px-2 py-2 rounded-lg bg-[#dfe8d2] hover:bg-green-200">
                    <Peca tipo={p.id} cor={minhaCor} />
                    <span className="text-[10px] font-display font-semibold text-slate-800">{p.nome}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {pares.length > 0 && (
        <div className="rounded-lg border border-[#163059] bg-[#0f2040]/50 p-3 max-h-24 overflow-y-auto">
          <p className="text-[11px] font-mono-data text-slate-400 leading-relaxed">
            {pares.map(([b, p], i) => (
              <span key={i} className="mr-2 whitespace-nowrap"><span className="text-slate-600">{i + 1}.</span> {b} {p ?? ""}</span>
            ))}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Jogo da memória ──────────────────────────────────────────────────────────

function TabuleiroMemoria({ estado, meuId, podeJogar, onJogar }: { estado: EstadoMemoria; meuId: string; podeJogar: boolean; onJogar: (l: unknown) => void }) {
  // Quando alguém erra, o servidor já "desvira" as cartas; mostramos as duas
  // por um instante a partir de ultimaTentativa para todos verem.
  const [flash, setFlash] = useState<EstadoMemoria["ultimaTentativa"]>(null);
  const seqInicial = useRef(estado.seq);
  useEffect(() => {
    const t = estado.ultimaTentativa;
    if (!t || t.acertou || t.seq === seqInicial.current) return;
    setFlash(t);
    const timer = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(timer);
  }, [estado.seq, estado.ultimaTentativa]);

  const colunas = estado.totalCartas <= 16 ? 4 : 6;
  return (
    <div className="grid gap-2 w-full max-w-sm mx-auto" style={{ gridTemplateColumns: `repeat(${colunas}, minmax(0, 1fr))` }}>
      {Array.from({ length: estado.totalCartas }, (_, i) => {
        const encontrada = estado.encontradas[i];
        const virada = estado.virada?.carta === i ? estado.virada.simbolo : null;
        const flashIdx = flash?.cartas.indexOf(i) ?? -1;
        const simbolo = encontrada?.simbolo ?? virada ?? (flashIdx >= 0 ? flash!.simbolos[flashIdx] : null);
        const clicavel = podeJogar && !encontrada && !virada;
        return (
          <button key={i} type="button" disabled={!clicavel} onClick={() => onJogar({ carta: i })}
            className={`aspect-square rounded-xl border-2 flex items-center justify-center text-3xl transition-all duration-300
              ${simbolo ? "[transform:rotateY(0deg)]" : ""}
              ${encontrada ? (encontrada.dono === meuId ? "border-green-400/70 bg-green-400/10" : "border-sky-400/50 bg-sky-400/10")
                : simbolo ? (flashIdx >= 0 ? "border-red-400/70 bg-red-400/10" : "border-amber-300/70 bg-amber-300/10")
                : "border-[#163059] bg-gradient-to-br from-[#163059] to-[#0f2040]"}
              ${clicavel ? "hover:border-green-400/60 active:scale-95" : ""}`}>
            {simbolo ?? <span className="text-green-400/30 text-lg font-display font-black">?</span>}
          </button>
        );
      })}
    </div>
  );
}

// ─── Tela da partida ──────────────────────────────────────────────────────────

export default function QuestGame({ partida, meuId, onVoltar }: { partida: QuestPartida; meuId: string; onVoltar: () => void }) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [confirmarDesistencia, setConfirmarDesistencia] = useState(false);
  const oponenteId = partida.jogadores.find((id) => id !== meuId)!;
  const emAndamento = partida.status === "andamento";
  const minhaVez = emAndamento && partida.vez === meuId;
  const podeJogar = minhaVez && !enviando;

  const jogar = async (lance: unknown) => {
    setEnviando(true);
    setErro("");
    try {
      await questApi.jogar(partida.id, lance);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  const desistir = async () => {
    setEnviando(true);
    try {
      await questApi.desistir(partida.id);
      setConfirmarDesistencia(false);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  const extra = (id: string): string => {
    if (!partida.estado) return "";
    if (partida.jogo === "velha") return (partida.estado as EstadoVelha).simbolos[id];
    if (partida.jogo === "xadrez") return (partida.estado as EstadoXadrez).brancasId === id ? "Brancas" : "Pretas";
    const pares = (partida.estado as EstadoMemoria).pares[id] ?? 0;
    return `${pares} ${pares === 1 ? "par" : "pares"}`;
  };

  const Jogador = ({ id }: { id: string }) => {
    const daVez = emAndamento && partida.vez === id;
    return (
      <div className={`flex-1 min-w-0 flex items-center gap-2 rounded-xl border p-2.5 transition-colors ${daVez ? "border-green-400/60 bg-green-400/10" : "border-[#163059] bg-[#0f2040]/50"}`}>
        <Avatar url={partida.fotos[id]} nome={partida.nomes[id] ?? "?"} />
        <div className="min-w-0">
          <p className="text-sm font-display font-semibold text-white truncate">{id === meuId ? "Você" : partida.nomes[id]}</p>
          <p className="text-[11px] text-slate-400 font-mono-data">{extra(id)}</p>
        </div>
      </div>
    );
  };

  const venci = partida.vencedorId === meuId;
  const empate = partida.status === "finalizada" && !partida.vencedorId;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onVoltar} className="w-9 h-9 rounded-full border border-[#163059] text-slate-400 hover:text-white flex items-center justify-center shrink-0" aria-label="Voltar">←</button>
        <div className="min-w-0">
          <p className="text-xs text-slate-400 font-display uppercase tracking-widest">Quest</p>
          <h1 className="font-display font-black text-2xl text-white leading-tight truncate">{JOGOS[partida.jogo].icone} {JOGOS[partida.jogo].nome}</h1>
        </div>
      </div>

      <div className="flex items-stretch gap-2">
        <Jogador id={meuId} />
        <span className="self-center text-xs font-display font-bold text-slate-500">VS</span>
        <Jogador id={oponenteId} />
      </div>

      {/* Status */}
      {emAndamento ? (
        <div className={`rounded-xl p-3 text-center font-display font-bold text-sm ${minhaVez ? "bg-green-400/15 text-green-400 border border-green-400/40" : "bg-[#0f2040] text-slate-400 border border-[#163059]"}`}>
          {minhaVez ? (
            <span className="inline-flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" /> Sua vez{partida.jogo === "xadrez" && (partida.estado as EstadoXadrez).xeque ? " — você está em xeque!" : ""}</span>
          ) : (
            <span>⏳ Vez de {partida.nomes[oponenteId]}{partida.jogo === "xadrez" && (partida.estado as EstadoXadrez).xeque ? " (em xeque)" : ""}</span>
          )}
        </div>
      ) : partida.status === "finalizada" ? (
        <div className={`rounded-2xl p-4 text-center border ${venci ? "border-green-400/50 bg-green-400/10" : empate ? "border-sky-400/40 bg-sky-400/5" : "border-red-400/40 bg-red-400/5"}`}>
          <p className="text-4xl mb-1">{venci ? "🏆" : empate ? "🤝" : "😓"}</p>
          <p className={`font-display font-black text-xl ${venci ? "text-green-400" : empate ? "text-sky-300" : "text-red-300"}`}>
            {venci ? "Você venceu!" : empate ? "Empate!" : "Você perdeu"}
          </p>
          {partida.motivoFim && <p className="text-xs text-slate-400 mt-1">Motivo:{partida.motivoFim}</p>}
        </div>
      ) : null}

      {/* Tabuleiro */}
      {partida.estado && (
        <div className={enviando ? "opacity-70 pointer-events-none" : ""}>
          {partida.jogo === "velha" && <TabuleiroVelha estado={partida.estado as EstadoVelha} podeJogar={podeJogar} onJogar={jogar} />}
          {partida.jogo === "xadrez" && (
            <TabuleiroXadrez estado={partida.estado as EstadoXadrez} minhaCor={(partida.estado as EstadoXadrez).brancasId === meuId ? "w" : "b"} podeJogar={podeJogar} onJogar={jogar} />
          )}
          {partida.jogo === "memoria" && <TabuleiroMemoria estado={partida.estado as EstadoMemoria} meuId={meuId} podeJogar={podeJogar} onJogar={jogar} />}
        </div>
      )}

      {enviando && <p className="text-xs text-slate-500 text-center">Enviando jogada...</p>}
      {erro && <p className="text-sm text-red-400 text-center">{erro}</p>}

      {emAndamento && (
        <div className="pt-2">
          {!confirmarDesistencia ? (
            <button onClick={() => setConfirmarDesistencia(true)} className="w-full py-2.5 rounded-xl border border-red-400/30 text-red-300 hover:bg-red-400/10 text-sm font-display font-semibold transition-colors">
              🏳️ Desistir da partida
            </button>
          ) : (
            <div className="rounded-xl border border-red-400/30 bg-red-400/5 p-3 space-y-2">
              <p className="text-sm text-center text-slate-300">Desistir conta como derrota. Tem certeza?</p>
              <div className="flex gap-2">
                <button onClick={desistir} disabled={enviando} className="flex-1 py-2 rounded-lg bg-red-500 hover:bg-red-400 disabled:opacity-60 text-white text-sm font-display font-bold">Desistir</button>
                <button onClick={() => setConfirmarDesistencia(false)} className="flex-1 py-2 rounded-lg border border-[#163059] text-slate-300 text-sm">Continuar jogando</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
