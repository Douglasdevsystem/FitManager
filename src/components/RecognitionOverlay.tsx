import type { Aluno } from "../lib/types";

export interface RecognitionOverlayEvent {
  kind: "granted" | "denied";
  aluno: Aluno | null;
}

export function RecognitionOverlay({ event }: { event: RecognitionOverlayEvent | null }) {
  if (!event) return null;
  const granted = event.kind === "granted";

  return (
    <div
      className={`absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 px-6 text-center animate-[fadeInScale_0.25s_ease-out] ${
        granted ? "bg-green-600/95" : "bg-red-600/95"
      }`}
    >
      <span className="text-white text-3xl md:text-5xl font-display font-black tracking-tight">
        {granted ? "ENTRADA PERMITIDA" : "ACESSO NEGADO"}
      </span>
      {granted && event.aluno ? (
        <div className="flex items-center gap-4 mt-2">
          {event.aluno.fotoUrl && (
            <img src={event.aluno.fotoUrl} alt={event.aluno.nome} className="w-20 h-20 rounded-full object-cover border-4 border-white shadow-lg" />
          )}
          <span className="text-white text-xl md:text-3xl font-display font-bold">{event.aluno.nome}</span>
        </div>
      ) : (
        !granted && <span className="text-white/90 text-base md:text-lg font-display">Rosto não reconhecido</span>
      )}
    </div>
  );
}
