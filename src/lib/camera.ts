// Abertura da webcam compartilhada pelo painel (Câmera, janela de segundo
// monitor) e pelo cadastro de aluno. Centraliza as tentativas e, sobretudo,
// traduz cada falha do navegador numa instrução que a recepção consegue seguir.

export interface ErroCamera {
  titulo: string;
  instrucao: string;
  codigo: string;
}

/**
 * Pede a câmera. Se a configuração pedida não existir neste notebook (ex.:
 * uma câmera escolhida antes que foi desconectada), tenta de novo com
 * qualquer câmera disponível antes de desistir.
 */
export async function abrirCamera(deviceId?: string): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    const err = new Error("getUserMedia indisponível");
    err.name = window.isSecureContext ? "NotSupportedError" : "InsecureContextError";
    throw err;
  }
  const tentativas: MediaStreamConstraints[] = [
    { video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" } },
    { video: true },
  ];
  let ultimoErro: unknown;
  for (const constraints of tentativas) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      ultimoErro = err;
      const nome = (err as Error)?.name;
      // Permissão negada ou câmera ocupada não se resolvem mudando a configuração.
      if (nome === "NotAllowedError" || nome === "SecurityError" || nome === "NotReadableError") break;
    }
  }
  throw ultimoErro;
}

export function explicarErroCamera(err: unknown): ErroCamera {
  const codigo = (err as Error)?.name || "Erro";
  switch (codigo) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        codigo,
        titulo: "Acesso à câmera bloqueado",
        instrucao:
          "Clique no ícone de cadeado (ou de câmera) à esquerda do endereço do site, em \"Câmera\" escolha \"Permitir\" e recarregue a página. " +
          "Se o problema continuar: no Windows, abra Configurações › Privacidade e segurança › Câmera e ative o acesso para o navegador.",
      };
    case "NotReadableError":
    case "TrackStartError":
      return {
        codigo,
        titulo: "A câmera está sendo usada por outro programa",
        instrucao:
          "Feche Teams, Zoom, Meet, o app Câmera do Windows, o aplicativo do quiosque ou outra aba/janela do FitManager que esteja com a câmera aberta, e toque em \"Tentar novamente\".",
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return {
        codigo,
        titulo: "Nenhuma câmera encontrada",
        instrucao: "Verifique se a webcam está conectada/ativada (alguns notebooks têm tecla ou tampa para desligá-la) e toque em \"Tentar novamente\".",
      };
    case "InsecureContextError":
      return {
        codigo,
        titulo: "Conexão não segura",
        instrucao: "A câmera só funciona em endereços https://. Abra o sistema pelo endereço https:// oficial.",
      };
    case "NotSupportedError":
      return { codigo, titulo: "Navegador sem suporte à câmera", instrucao: "Use uma versão atualizada do Chrome, Edge ou Firefox." };
    default:
      return { codigo, titulo: "Não foi possível acessar a câmera", instrucao: "Recarregue a página e tente novamente. Se persistir, reinicie o navegador." };
  }
}
