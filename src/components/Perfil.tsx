// Tela "Perfil" do portal do aluno, inspirada no Tinder: galeria de até 6
// fotos (recorte 4:5, arrastar para reordenar), cartão de visualização "como
// os outros veem", edição dos dados e privacidade. A visibilidade controla
// se o aluno aparece no Quest (ver lib/perfil.ts e functions/quest.js).
import { useEffect, useRef, useState } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytesResumable } from "firebase/storage";
import { db, storage, COLLECTIONS, STORAGE_PATHS } from "../lib/firebase";
import {
  HORARIOS, MAX_BIO, MAX_FOTOS, MAX_OBJETIVOS, MODALIDADES, NIVEIS, OBJETIVOS, SEXOS,
  calcularIdade, completude, perfilVazio, rotulo,
  type FotoPerfil, type PerfilAluno,
} from "../lib/perfil";

const LIMITE_BYTES = 5 * 1024 * 1024;
const SAIDA_LARGURA = 1080; // 1080 × 1350 (4:5)

// ─── Cartão de perfil (reutilizado no Quest) ──────────────────────────────────

export interface DadosCartao {
  nome: string;
  idade?: number | null;
  academiaNome?: string | null;
  fotos: string[];
  bio?: string;
  objetivos?: string[];
  nivel?: string | null;
  horario?: string | null;
  modalidades?: string[];
  cidade?: string;
  instagram?: string;
}

function Chip({ children, destaque }: { children: React.ReactNode; destaque?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-display font-medium border ${destaque ? "border-green-400/40 bg-green-400/10 text-green-300" : "border-[#163059] bg-[#163059]/40 text-slate-300"}`}>
      {children}
    </span>
  );
}

export function CartaoPerfil({ dados, rodape }: { dados: DadosCartao; rodape?: React.ReactNode }) {
  const [indice, setIndice] = useState(0);
  const total = dados.fotos.length;
  const atual = Math.min(indice, Math.max(total - 1, 0));

  const tocar = (e: React.MouseEvent<HTMLDivElement>) => {
    if (total < 2) return;
    const { left, width } = e.currentTarget.getBoundingClientRect();
    const direita = e.clientX - left > width / 2;
    setIndice((i) => Math.min(Math.max(i + (direita ? 1 : -1), 0), total - 1));
  };

  const objetivos = (dados.objetivos ?? []).map((o) => rotulo(OBJETIVOS, o)).filter(Boolean) as string[];
  const interesses = [rotulo(NIVEIS, dados.nivel), rotulo(HORARIOS, dados.horario)].filter(Boolean) as string[];

  return (
    <div className="space-y-4">
      <div className="relative aspect-[4/5] w-full rounded-2xl overflow-hidden bg-[#0f2040] border border-[#163059] select-none" onClick={tocar}>
        {total > 0 ? (
          <img src={dados.fotos[atual]} alt={`Foto ${atual + 1} de ${dados.nome}`} className="absolute inset-0 w-full h-full object-cover" draggable={false} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#163059] to-[#050d1a]">
            <span className="font-display font-black text-8xl text-green-400/30">{dados.nome.trim().charAt(0).toUpperCase() || "?"}</span>
          </div>
        )}

        {total > 1 && (
          <div className="absolute top-2 inset-x-2 flex gap-1">
            {dados.fotos.map((_, i) => (
              <span key={i} className={`h-1 flex-1 rounded-full ${i === atual ? "bg-white" : "bg-white/35"}`} />
            ))}
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/90 via-black/50 to-transparent pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 p-4 pointer-events-none">
          <p className="font-display font-black text-3xl text-white leading-tight drop-shadow">
            {dados.nome || "Seu nome"}
            {dados.idade != null && <span className="font-display font-semibold text-2xl text-white/90">, {dados.idade}</span>}
          </p>
          <p className="text-sm text-white/80 mt-1 flex items-center gap-1.5">
            <span>🏋️</span> {dados.academiaNome || "Sua academia"}
          </p>
          {dados.cidade && <p className="text-xs text-white/70 mt-0.5 flex items-center gap-1.5"><span>📍</span> {dados.cidade}</p>}
        </div>
      </div>

      {dados.bio?.trim() && (
        <div className="rounded-xl border border-[#163059] bg-[#0f2040]/50 p-4">
          <p className="text-xs font-display text-slate-400 uppercase tracking-wider mb-2">Sobre</p>
          <p className="text-sm text-slate-200 whitespace-pre-line leading-relaxed">{dados.bio}</p>
        </div>
      )}
      {objetivos.length > 0 && (
        <div className="rounded-xl border border-[#163059] bg-[#0f2040]/50 p-4">
          <p className="text-xs font-display text-slate-400 uppercase tracking-wider mb-2">Objetivos</p>
          <div className="flex flex-wrap gap-2">{objetivos.map((o) => <Chip key={o} destaque>{o}</Chip>)}</div>
        </div>
      )}
      {(interesses.length > 0 || (dados.modalidades ?? []).length > 0) && (
        <div className="rounded-xl border border-[#163059] bg-[#0f2040]/50 p-4">
          <p className="text-xs font-display text-slate-400 uppercase tracking-wider mb-2">Interesses</p>
          <div className="flex flex-wrap gap-2">
            {interesses.map((i) => <Chip key={i}>{i}</Chip>)}
            {(dados.modalidades ?? []).map((m) => <Chip key={m}>{m}</Chip>)}
          </div>
        </div>
      )}
      {dados.instagram && (
        <a href={`https://instagram.com/${dados.instagram}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-xl border border-[#163059] bg-[#0f2040]/50 p-4 text-sm text-slate-200 hover:border-green-400/50 transition-colors">
          <span>📸</span> @{dados.instagram}
        </a>
      )}
      {rodape}
    </div>
  );
}

// ─── Recorte 4:5 + compressão ─────────────────────────────────────────────────

function Recorte({ arquivo, onCancelar, onConcluir }: { arquivo: File; onCancelar: () => void; onConcluir: (blob: Blob) => void }) {
  const [url] = useState(() => URL.createObjectURL(arquivo));
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [erro, setErro] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [processando, setProcessando] = useState(false);
  const moldura = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(300);
  const H = (W * 5) / 4;
  const arrasto = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  useEffect(() => {
    const el = moldura.current;
    if (el) setW(el.clientWidth);
  }, []);

  useEffect(() => {
    const i = new Image();
    i.onload = () => setImg(i);
    i.onerror = () => setErro("Não foi possível abrir essa imagem. Tente outro arquivo (JPG ou PNG).");
    i.src = url;
  }, [url]);

  const escalaBase = img ? Math.max(W / img.naturalWidth, H / img.naturalHeight) : 1;
  const escala = escalaBase * zoom;
  const dw = img ? img.naturalWidth * escala : W;
  const dh = img ? img.naturalHeight * escala : H;
  const limitar = (x: number, y: number) => ({ x: Math.min(0, Math.max(W - dw, x)), y: Math.min(0, Math.max(H - dh, y)) });

  // Centraliza ao carregar e mantém a imagem cobrindo a moldura ao dar zoom.
  useEffect(() => {
    if (img) setPos({ x: (W - img.naturalWidth * escalaBase) / 2, y: (H - img.naturalHeight * escalaBase) / 2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, W]);

  const mudarZoom = (novo: number) => {
    const z = Math.min(Math.max(novo, 1), 4);
    // Zoom em torno do centro da moldura.
    const cx = (W / 2 - pos.x) / escala;
    const cy = (H / 2 - pos.y) / escala;
    const e2 = escalaBase * z;
    const nw = (img?.naturalWidth ?? 0) * e2;
    const nh = (img?.naturalHeight ?? 0) * e2;
    setZoom(z);
    setPos({ x: Math.min(0, Math.max(W - nw, W / 2 - cx * e2)), y: Math.min(0, Math.max(H - nh, H / 2 - cy * e2)) });
  };

  const concluir = async () => {
    if (!img) return;
    setProcessando(true);
    const sw = W / escala;
    const sh = H / escala;
    const larguraSaida = Math.round(Math.min(SAIDA_LARGURA, sw));
    const canvas = document.createElement("canvas");
    canvas.width = larguraSaida;
    canvas.height = Math.round((larguraSaida * 5) / 4);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, -pos.x / escala, -pos.y / escala, sw, sh, 0, 0, canvas.width, canvas.height);
    // Comprime em JPEG, reduzindo a qualidade até caber no limite de 5 MB.
    for (const qualidade of [0.85, 0.75, 0.6, 0.45]) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", qualidade));
      if (blob && blob.size <= LIMITE_BYTES) {
        onConcluir(blob);
        return;
      }
    }
    setProcessando(false);
    setErro("A foto continua maior que 5 MB mesmo após a compressão. Tente outra imagem.");
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/95 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={onCancelar} className="text-sm text-slate-400 hover:text-white">Cancelar</button>
          <p className="font-display font-bold text-white">Ajustar foto</p>
          <button onClick={concluir} disabled={!img || processando} className="text-sm font-display font-bold text-green-400 disabled:opacity-50">
            {processando ? "..." : "Usar"}
          </button>
        </div>
        <div
          ref={moldura}
          className="relative w-full aspect-[4/5] overflow-hidden rounded-2xl bg-[#0f2040] touch-none cursor-grab active:cursor-grabbing"
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); arrasto.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y }; }}
          onPointerMove={(e) => { const a = arrasto.current; if (a) setPos(limitar(a.x + e.clientX - a.px, a.y + e.clientY - a.py)); }}
          onPointerUp={() => { arrasto.current = null; }}
          onPointerCancel={() => { arrasto.current = null; }}
          onWheel={(e) => mudarZoom(zoom - e.deltaY * 0.002)}
        >
          {img && (
            <img src={url} alt="" draggable={false} className="absolute max-w-none pointer-events-none"
              style={{ left: pos.x, top: pos.y, width: dw, height: dh }} />
          )}
          {/* Grade de terços */}
          <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3">
            {Array.from({ length: 9 }, (_, i) => <div key={i} className="border border-white/10" />)}
          </div>
          {!img && !erro && <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">Carregando...</p>}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">−</span>
          <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => mudarZoom(Number(e.target.value))} className="flex-1 accent-green-400" aria-label="Zoom" />
          <span className="text-xs text-slate-500">+</span>
        </div>
        <p className="text-xs text-slate-500 text-center">Arraste para posicionar e use o controle para aproximar.</p>
        {erro && <p className="text-sm text-red-400 text-center">{erro}</p>}
      </div>
    </div>
  );
}

// ─── Galeria de fotos ─────────────────────────────────────────────────────────

function Galeria({ fotos, onMudar, alunoId }: { fotos: FotoPerfil[]; onMudar: (f: FotoPerfil[]) => Promise<void>; alunoId: string }) {
  const [menuAberto, setMenuAberto] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [progresso, setProgresso] = useState<number | null>(null);
  const [erro, setErro] = useState("");
  const [arrastando, setArrastando] = useState<{ de: number; para: number; dx: number; dy: number } | null>(null);
  const inicio = useRef<{ i: number; x: number; y: number; ativo: boolean } | null>(null);
  const inputCamera = useRef<HTMLInputElement>(null);
  const inputGaleria = useRef<HTMLInputElement>(null);

  const escolher = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    setMenuAberto(false);
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setErro("Escolha um arquivo de imagem.");
      return;
    }
    setErro("");
    setArquivo(f);
  };

  const enviar = async (blob: Blob) => {
    setArquivo(null);
    setProgresso(0);
    const path = `${STORAGE_PATHS.perfisAlunos}/${alunoId}/${Date.now()}.jpg`;
    try {
      const tarefa = uploadBytesResumable(storageRef(storage, path), blob, { contentType: "image/jpeg" });
      tarefa.on("state_changed", (s) => setProgresso(Math.round((s.bytesTransferred / s.totalBytes) * 100)));
      await tarefa;
      const url = await getDownloadURL(tarefa.snapshot.ref);
      await onMudar([...fotos, { url, path }].slice(0, MAX_FOTOS));
    } catch (err) {
      console.error("[Perfil] falha no upload:", err);
      setErro("Não foi possível enviar a foto. Verifique sua conexão e tente novamente.");
    } finally {
      setProgresso(null);
    }
  };

  const remover = async (i: number) => {
    const foto = fotos[i];
    await onMudar(fotos.filter((_, j) => j !== i));
    deleteObject(storageRef(storage, foto.path)).catch(() => {}); // arquivo órfão não quebra nada
  };

  // Arrastar para reordenar (pointer events — funciona com toque e mouse).
  const aoPressionar = (i: number) => (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-remover]")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    inicio.current = { i, x: e.clientX, y: e.clientY, ativo: false };
  };
  const aoMover = (e: React.PointerEvent) => {
    const s = inicio.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.ativo && Math.hypot(dx, dy) < 8) return;
    s.ativo = true;
    const alvo = document.elementsFromPoint(e.clientX, e.clientY)
      .map((el) => (el as HTMLElement).closest?.("[data-slot]") as HTMLElement | null)
      .find((el) => el && Number(el.dataset.slot) !== s.i);
    const para = alvo ? Math.min(Number(alvo.dataset.slot), fotos.length - 1) : s.i;
    setArrastando({ de: s.i, para, dx, dy });
  };
  const aoSoltar = () => {
    const a = arrastando;
    inicio.current = null;
    setArrastando(null);
    if (a && a.de !== a.para) {
      const nova = [...fotos];
      const [item] = nova.splice(a.de, 1);
      nova.splice(a.para, 0, item);
      onMudar(nova);
    }
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: MAX_FOTOS }, (_, i) => {
          const foto = fotos[i];
          const sendoArrastada = arrastando?.de === i;
          const alvo = arrastando && arrastando.para === i && arrastando.de !== i;
          if (!foto) {
            const proximo = i === fotos.length;
            return (
              <button key={i} data-slot={i} type="button" disabled={progresso !== null}
                onClick={() => setMenuAberto(true)}
                className={`relative aspect-[4/5] rounded-xl border-2 border-dashed flex items-center justify-center transition-colors ${proximo ? "border-green-400/50 bg-green-400/5 hover:bg-green-400/10" : "border-[#163059] bg-[#0f2040]/40 hover:border-green-400/40"}`}>
                {proximo && progresso !== null ? (
                  <span className="text-xs font-mono-data text-green-400">{progresso}%</span>
                ) : (
                  <span className="w-8 h-8 rounded-full bg-green-500 text-black flex items-center justify-center text-xl font-bold leading-none shadow-lg">+</span>
                )}
              </button>
            );
          }
          return (
            <div key={foto.path} data-slot={i}
              onPointerDown={aoPressionar(i)} onPointerMove={aoMover} onPointerUp={aoSoltar} onPointerCancel={aoSoltar}
              className={`relative aspect-[4/5] rounded-xl overflow-hidden bg-[#0f2040] touch-none select-none cursor-grab ${alvo ? "ring-2 ring-green-400" : ""} ${sendoArrastada ? "z-10 opacity-90 shadow-2xl scale-105" : "transition-transform"}`}
              style={sendoArrastada ? { transform: `translate(${arrastando!.dx}px, ${arrastando!.dy}px) scale(1.05)` } : undefined}>
              <img src={foto.url} alt={`Foto ${i + 1}`} className="w-full h-full object-cover pointer-events-none" draggable={false} />
              {i === 0 && (
                <span className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded-full bg-green-500 text-black text-[10px] font-display font-bold">Principal</span>
              )}
              <button data-remover type="button" onClick={() => remover(i)} aria-label={`Remover foto ${i + 1}`}
                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/70 text-white text-xs flex items-center justify-center hover:bg-red-500 transition-colors">
                ✕
              </button>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-500">A primeira foto é a principal. Segure e arraste para reordenar.</p>
      {erro && <p className="text-xs text-red-400">{erro}</p>}

      <input ref={inputCamera} type="file" accept="image/*" capture="user" className="hidden" onChange={escolher} />
      <input ref={inputGaleria} type="file" accept="image/*" className="hidden" onChange={escolher} />

      {menuAberto && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center" onClick={() => setMenuAberto(false)}>
          <div className="w-full max-w-sm rounded-t-2xl sm:rounded-2xl border border-[#163059] bg-[#091426] p-4 space-y-2" onClick={(e) => e.stopPropagation()}>
            <p className="font-display font-bold text-white text-center mb-2">Adicionar foto</p>
            <button onClick={() => inputCamera.current?.click()} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-[#163059]/40 hover:bg-[#163059]/70 text-white text-sm font-display font-semibold">
              <span className="text-xl">📷</span> Tirar foto
            </button>
            <button onClick={() => inputGaleria.current?.click()} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-[#163059]/40 hover:bg-[#163059]/70 text-white text-sm font-display font-semibold">
              <span className="text-xl">🖼️</span> Escolher da galeria
            </button>
            <button onClick={() => setMenuAberto(false)} className="w-full py-2.5 text-sm text-slate-400 hover:text-white">Cancelar</button>
          </div>
        </div>
      )}

      {arquivo && <Recorte arquivo={arquivo} onCancelar={() => setArquivo(null)} onConcluir={enviar} />}
    </div>
  );
}

// ─── Campos de formulário (tema escuro) ───────────────────────────────────────

const inputEscuro = "w-full bg-[#163059]/40 border border-[#163059] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-400 transition-colors";

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[#163059] bg-[#0f2040]/50 p-4 space-y-3">
      <p className="text-xs font-display text-slate-400 uppercase tracking-wider">{titulo}</p>
      {children}
    </section>
  );
}

function Rotulo({ texto, children, erro }: { texto: string; children: React.ReactNode; erro?: string }) {
  return (
    <label className="block">
      <span className="block text-xs text-slate-400 mb-1.5">{texto}</span>
      {children}
      {erro && <span className="block text-[11px] text-red-400 mt-1">{erro}</span>}
    </label>
  );
}

function ChipSelecionavel({ ativo, onClick, children, desabilitado }: { ativo: boolean; onClick: () => void; children: React.ReactNode; desabilitado?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={desabilitado && !ativo}
      className={`px-3 py-1.5 rounded-full text-xs font-display font-medium border transition-colors disabled:opacity-40 ${ativo ? "border-green-400 bg-green-400/15 text-green-300" : "border-[#163059] bg-[#163059]/30 text-slate-400 hover:text-white"}`}>
      {children}
    </button>
  );
}

function Interruptor({ ligado, onChange, titulo, descricao }: { ligado: boolean; onChange: (v: boolean) => void; titulo: string; descricao: string }) {
  return (
    <button type="button" onClick={() => onChange(!ligado)} className="w-full flex items-start justify-between gap-4 text-left">
      <span>
        <span className="block text-sm font-display font-semibold text-white">{titulo}</span>
        <span className="block text-xs text-slate-400 mt-0.5">{descricao}</span>
      </span>
      <span className={`mt-0.5 w-11 h-6 rounded-full relative shrink-0 transition-colors ${ligado ? "bg-green-500" : "bg-[#163059]"}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${ligado ? "left-5" : "left-0.5"}`} />
      </span>
    </button>
  );
}

// ─── Tela ─────────────────────────────────────────────────────────────────────

function validarPerfil(p: PerfilAluno) {
  const erros: Partial<Record<keyof PerfilAluno, string>> = {};
  const nome = p.nome.trim();
  if (nome.length < 2 || nome.length > 60) erros.nome = "Informe um nome entre 2 e 60 caracteres.";
  if (p.dataNascimento) {
    const idade = calcularIdade(p.dataNascimento);
    if (idade == null || idade < 10 || idade > 100) erros.dataNascimento = "Data de nascimento inválida.";
  }
  if (p.bio.length > MAX_BIO) erros.bio = `A bio pode ter no máximo ${MAX_BIO} caracteres.`;
  if (p.cidade.length > 60) erros.cidade = "Nome de cidade muito longo.";
  if (p.instagram && !/^[A-Za-z0-9._]{1,30}$/.test(p.instagram)) erros.instagram = "Use só letras, números, ponto e sublinhado (até 30).";
  return erros;
}

export default function TelaPerfil({ alunoId, uid, nomeCadastro, perfil, academiaNome, onVoltar }: {
  alunoId: string;
  uid: string;
  nomeCadastro: string;
  perfil: PerfilAluno | null;
  academiaNome?: string | null;
  onVoltar: () => void;
}) {
  const salvo: PerfilAluno = { ...perfilVazio(nomeCadastro, uid), ...perfil, uid };
  const [form, setForm] = useState<PerfilAluno>(salvo);
  const [modo, setModo] = useState<"editar" | "ver">("editar");
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const ref = doc(db, COLLECTIONS.perfisAlunos, alunoId);

  // Quando o documento chega/atualiza (ex.: fotos salvas), traz as fotos para o formulário.
  const fotosSalvas = JSON.stringify(perfil?.fotos ?? []);
  useEffect(() => {
    setForm((f) => ({ ...f, fotos: perfil?.fotos ?? [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fotosSalvas]);

  const set = <K extends keyof PerfilAluno>(k: K, v: PerfilAluno[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setMensagem(null);
  };
  const alternar = (k: "objetivos" | "modalidades", v: string, max = Infinity) => {
    const atual = form[k];
    set(k, atual.includes(v) ? atual.filter((x) => x !== v) : atual.length < max ? [...atual, v] : atual);
  };

  // Fotos são gravadas na hora (como no Tinder), a partir do que já está
  // salvo — edições de texto ainda não salvas não vão junto.
  const salvarFotos = async (fotos: FotoPerfil[]) => {
    setForm((f) => ({ ...f, fotos }));
    await setDoc(ref, { ...salvo, fotos, atualizadoEm: serverTimestamp() });
  };

  const erros = validarPerfil(form);
  const { pct, faltando } = completude(form);

  const salvar = async () => {
    setTentouSalvar(true);
    if (Object.keys(erros).length > 0) {
      setMensagem({ tipo: "erro", texto: "Corrija os campos destacados antes de salvar." });
      return;
    }
    setSalvando(true);
    try {
      await setDoc(ref, { ...form, nome: form.nome.trim(), cidade: form.cidade.trim(), bio: form.bio.trim(), uid, atualizadoEm: serverTimestamp() });
      setMensagem({ tipo: "ok", texto: "Perfil salvo!" });
    } catch (err) {
      console.error("[Perfil] falha ao salvar:", err);
      setMensagem({ tipo: "erro", texto: "Não foi possível salvar. Verifique sua conexão e tente novamente." });
    } finally {
      setSalvando(false);
    }
  };

  const idade = calcularIdade(form.dataNascimento);
  const dadosCartao: DadosCartao = {
    nome: form.nome.trim(),
    idade: form.esconderIdade ? null : idade,
    academiaNome,
    fotos: form.fotos.map((f) => f.url),
    bio: form.bio,
    objetivos: form.objetivos,
    nivel: form.nivel,
    horario: form.horario,
    modalidades: form.modalidades,
    cidade: form.cidade.trim(),
    instagram: form.instagram,
  };
  const erroVisivel = (k: keyof PerfilAluno) => (tentouSalvar || (form[k] as string)?.length > 0 ? erros[k] : undefined);

  return (
    <div className="space-y-5 pb-2">
      <div className="flex items-center gap-3">
        <button onClick={onVoltar} className="w-9 h-9 rounded-full border border-[#163059] text-slate-400 hover:text-white flex items-center justify-center" aria-label="Voltar">←</button>
        <div>
          <p className="text-xs text-slate-400 font-display uppercase tracking-widest">Seu perfil</p>
          <h1 className="font-display font-black text-3xl text-white leading-tight">Perfil</h1>
        </div>
      </div>

      {/* Completude */}
      <div className="rounded-xl border border-green-400/30 bg-green-400/5 p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="font-display font-semibold text-sm text-white">Perfil {pct}% completo</p>
          {pct === 100 && <span className="text-green-400 text-sm">✓ Completo!</span>}
        </div>
        <div className="h-2 rounded-full bg-[#163059]">
          <div className="h-2 rounded-full bg-green-400 transition-all" style={{ width: `${pct}%` }} />
        </div>
        {faltando.length > 0 && <p className="text-xs text-slate-400 mt-2">💡 {faltando[0]} para deixar seu perfil mais completo.</p>}
      </div>

      {/* Alternar editar/visualizar */}
      <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#0f2040] border border-[#163059]">
        {(["editar", "ver"] as const).map((m) => (
          <button key={m} onClick={() => setModo(m)}
            className={`py-2 rounded-lg text-sm font-display font-semibold transition-colors ${modo === m ? "bg-green-400/15 text-green-400" : "text-slate-400 hover:text-white"}`}>
            {m === "editar" ? "Editar" : "Visualizar"}
          </button>
        ))}
      </div>

      {modo === "ver" ? (
        <div className="space-y-3">
          <p className="text-xs text-slate-400 text-center">É assim que os outros alunos da academia veem você.</p>
          {!form.visivelQuest && (
            <p className="text-xs text-amber-300 text-center rounded-lg border border-amber-400/30 bg-amber-400/5 p-2">
              Seu perfil está oculto — no momento ninguém o vê. Ative em Privacidade.
            </p>
          )}
          <CartaoPerfil dados={dadosCartao} />
        </div>
      ) : (
        <>
          <Secao titulo="Fotos">
            <Galeria fotos={form.fotos} onMudar={salvarFotos} alunoId={alunoId} />
          </Secao>

          <Secao titulo="Sobre você">
            <Rotulo texto="Nome" erro={erroVisivel("nome")}>
              <input className={inputEscuro} value={form.nome} maxLength={60} onChange={(e) => set("nome", e.target.value)} placeholder="Como quer ser chamado(a)" />
            </Rotulo>
            <div className="grid grid-cols-2 gap-3">
              <Rotulo texto="Data de nascimento" erro={erroVisivel("dataNascimento")}>
                <input type="date" className={`${inputEscuro} [color-scheme:dark]`} value={form.dataNascimento} max={new Date().toISOString().slice(0, 10)} min="1920-01-01" onChange={(e) => set("dataNascimento", e.target.value)} />
              </Rotulo>
              <Rotulo texto="Cidade" erro={erroVisivel("cidade")}>
                <input className={inputEscuro} value={form.cidade} maxLength={60} onChange={(e) => set("cidade", e.target.value)} placeholder="Ex.: Campinas" />
              </Rotulo>
            </div>
            <div>
              <span className="block text-xs text-slate-400 mb-1.5">Sexo</span>
              <div className="flex flex-wrap gap-2">
                {SEXOS.map((s) => <ChipSelecionavel key={s.id} ativo={form.sexo === s.id} onClick={() => set("sexo", form.sexo === s.id ? "" : s.id)}>{s.label}</ChipSelecionavel>)}
              </div>
            </div>
          </Secao>

          <Secao titulo="Bio">
            <textarea className={`${inputEscuro} min-h-28 resize-none`} value={form.bio} maxLength={MAX_BIO}
              onChange={(e) => set("bio", e.target.value.slice(0, MAX_BIO))} placeholder="Conte um pouco sobre você, sua rotina de treinos e o que te motiva..." />
            <p className={`text-[11px] text-right font-mono-data ${form.bio.length >= MAX_BIO ? "text-amber-400" : "text-slate-500"}`}>{form.bio.length}/{MAX_BIO}</p>
          </Secao>

          <Secao titulo={`Objetivos (até ${MAX_OBJETIVOS})`}>
            <div className="flex flex-wrap gap-2">
              {OBJETIVOS.map((o) => (
                <ChipSelecionavel key={o.id} ativo={form.objetivos.includes(o.id)} desabilitado={form.objetivos.length >= MAX_OBJETIVOS} onClick={() => alternar("objetivos", o.id, MAX_OBJETIVOS)}>
                  {o.icone} {o.label}
                </ChipSelecionavel>
              ))}
            </div>
          </Secao>

          <Secao titulo="Treino">
            <div>
              <span className="block text-xs text-slate-400 mb-1.5">Nível</span>
              <div className="grid grid-cols-3 gap-2">
                {NIVEIS.map((n) => (
                  <button key={n.id} type="button" onClick={() => set("nivel", form.nivel === n.id ? "" : n.id)}
                    className={`py-2.5 rounded-lg border text-xs font-display font-semibold transition-colors ${form.nivel === n.id ? "border-green-400 bg-green-400/15 text-green-400" : "border-[#163059] bg-[#163059]/30 text-slate-400 hover:text-white"}`}>
                    <span className="block text-base mb-0.5">{n.icone}</span>{n.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="block text-xs text-slate-400 mb-1.5">Horário que costuma treinar</span>
              <div className="grid grid-cols-3 gap-2">
                {HORARIOS.map((h) => (
                  <button key={h.id} type="button" onClick={() => set("horario", form.horario === h.id ? "" : h.id)}
                    className={`py-2.5 rounded-lg border text-xs font-display font-semibold transition-colors ${form.horario === h.id ? "border-green-400 bg-green-400/15 text-green-400" : "border-[#163059] bg-[#163059]/30 text-slate-400 hover:text-white"}`}>
                    <span className="block text-base mb-0.5">{h.icone}</span>{h.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="block text-xs text-slate-400 mb-1.5">Modalidades favoritas</span>
              <div className="flex flex-wrap gap-2">
                {MODALIDADES.map((m) => <ChipSelecionavel key={m} ativo={form.modalidades.includes(m)} onClick={() => alternar("modalidades", m)}>{m}</ChipSelecionavel>)}
              </div>
            </div>
          </Secao>

          <Secao titulo="Redes sociais">
            <Rotulo texto="Instagram (opcional)" erro={erroVisivel("instagram")}>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">@</span>
                <input className={`${inputEscuro} pl-7`} value={form.instagram} maxLength={30} autoCapitalize="none" autoCorrect="off"
                  onChange={(e) => set("instagram", e.target.value.replace(/^@/, "").trim())} placeholder="seu.usuario" />
              </div>
            </Rotulo>
          </Secao>

          <Secao titulo="Privacidade">
            <Interruptor ligado={form.visivelQuest} onChange={(v) => set("visivelQuest", v)}
              titulo="Perfil visível para alunos da academia"
              descricao="Você aparece na lista do Quest e pode desafiar e ser desafiado. Desligado, ninguém vê seu perfil." />
            <div className="border-t border-[#163059]" />
            <Interruptor ligado={form.esconderIdade} onChange={(v) => set("esconderIdade", v)}
              titulo="Esconder minha idade"
              descricao="Sua idade não aparece no perfil. A data de nascimento nunca é mostrada a outros alunos." />
          </Secao>
        </>
      )}

      {/* Rodapé fixo com o botão Salvar */}
      {modo === "editar" && (
        <div className="sticky bottom-0 -mx-4 px-4 pt-3 pb-4 bg-gradient-to-t from-[#050d1a] via-[#050d1a] to-[#050d1a]/0">
          {mensagem && <p className={`text-xs text-center mb-2 ${mensagem.tipo === "ok" ? "text-green-400" : "text-red-400"}`}>{mensagem.texto}</p>}
          <button onClick={salvar} disabled={salvando}
            className="w-full py-3.5 rounded-xl bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black font-display font-bold text-sm transition-colors shadow-lg shadow-green-500/20">
            {salvando ? "Salvando..." : "Salvar"}
          </button>
        </div>
      )}
    </div>
  );
}
