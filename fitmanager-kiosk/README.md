# FitManager Kiosk

App desktop (Electron) instalado no PC da entrada da academia: captura vídeo
da webcam, detecta e reconhece rostos localmente (`face-api.js`) e libera o
acesso comparando com os embeddings dos alunos sincronizados do Firebase.
Funciona offline para o reconhecimento em si; sincroniza check-ins pendentes
quando a internet volta.

Este projeto vive dentro do painel administrativo web (`Sistema de Gestão de
Matrícula/fitmanager-kiosk`) — ambos apontam para o **mesmo projeto Firebase
que já roda outro sistema em produção** (`appfood-e25bb`). Por isso toda
coleção do Firestore e todo caminho do Storage usados aqui têm o prefixo
`fitmanager_` / `fitmanager/` — isso garante isolamento total dos dados do
outro sistema, sem precisar tocar em nada que já existe lá. Nunca remova
esse prefixo nem leia/grave uma coleção/caminho fora da lista abaixo.

## Arquitetura — por que face-api.js roda no renderer, não no main

O pedido original descrevia o reconhecimento rodando no *main process*. Na
prática isso não é possível: o main process do Electron é Node.js puro, sem
DOM/Canvas/WebGL — exatamente o que `face-api.js` precisa para detectar
rostos com boa performance. O *renderer* já é um Chromium completo (é onde
`getUserMedia` da webcam também vive), então é lá que a detecção roda,
exatamente como em qualquer app web.

Divisão real de responsabilidades:

- **`src/renderer`** — captura da câmera, roda `face-api.js` (via
  `src/renderer/face-detector.js`), compara embeddings (`src/face-engine/compare.js`,
  compartilhado com o main) e mostra o feedback "Liberado"/"Negado".
- **`src/main`** — processo Node.js: Firebase Admin SDK, cache local de
  embeddings, gravação de check-ins. Nunca expõe credenciais ao renderer —
  a única ponte é `src/main/preload.js`, que expõe apenas 3 funções via
  `contextBridge` (`getEmbeddings`, `recordCheckin`, `onEmbeddingsUpdated`).
- **`src/firebase`** — Admin SDK, listener `onSnapshot` de `alunos` com cache
  em disco, escrita de `checkins` com fila offline.
- **`src/face-engine/compare.js`** — distância euclidiana + threshold. Escrito
  para funcionar tanto como módulo CommonJS (main) quanto como `<script>`
  simples no renderer, sem precisar de bundler.
- **`functions`** — Cloud Functions separadas (deploy independente), onde o
  Node *é* o único ambiente disponível — por isso ali sim é necessário o
  polyfill `canvas` para rodar `face-api.js`.

## Setup

```bash
cd fitmanager-kiosk
npm install                 # também baixa os modelos do face-api.js (postinstall)
cp .env.example .env        # preencha com os dados do seu projeto Firebase
```

1. No Console do Firebase: **Configurações do projeto > Contas de serviço >
   Gerar nova chave privada** → salve como `firebase-service-account.json` na
   raiz do projeto (já está no `.gitignore`, nunca commite esse arquivo).
2. Preencha o `.env` com as chaves do seu app Firebase e o caminho do JSON
   acima.
3. `npm start` — baixa os modelos do `face-api.js` se ainda não existirem
   (idempotente, não falha se estiver offline — tenta de novo na próxima vez)
   e abre a janela do kiosk.

## Coleções e caminhos (todos prefixados — projeto Firebase compartilhado)

| O quê | Nome real no Firebase |
|---|---|
| Alunos | `fitmanager_alunos` (+ subcoleções `treinos`, `execucoesTreino`) |
| Check-ins | `fitmanager_checkins` |
| Usuários do sistema (equipe) | `fitmanager_usuarios` |
| Planos | `fitmanager_planos` |
| Notificações enviadas | `fitmanager_notificacoes` |
| Fila de notificações a enviar | `fitmanager_notificacoesPendentes` |
| Log de auditoria | `fitmanager_logsAuditoria` |
| Fotos dos alunos (Storage) | `fitmanager/fotos-alunos/{alunoId}.jpg` |
| Fotos de check-in (Storage) | `fitmanager/checkins-fotos/{checkinId}.jpg` |

O prefixo vem de `FIRESTORE_PREFIX`/`STORAGE_PREFIX` (kiosk e functions) e
`VITE_FIRESTORE_PREFIX`/`VITE_STORAGE_PREFIX` (painel web) — os três **têm
que ter o mesmo valor**. Schema completo de cada documento (campos, tipos)
está descrito nos comentários de `src/firebase/*.js` e `functions/index.js`.

## Fluxo de dados

```
Painel Web (cadastro + foto)
        │  upload em Storage: fitmanager/fotos-alunos/{alunoId}.jpg
        ▼
Cloud Function onAlunoWritten
        │  gera faceEmbedding (face-api.js + node-canvas)
        ▼
Firestore: fitmanager_alunos/{alunoId}.faceEmbedding
        │  onSnapshot em tempo real
        ▼
Kiosk Electron (src/firebase/sync-embeddings.js)
        │  cache local em src/cache/embeddings-cache.json
        ▼
Renderer: captura webcam → detecta rosto → compara com o cache
        │  match ou não-match
        ▼
Firestore: fitmanager_checkins/{id}  (com fila offline se a internet cair)
        │  onCreate
        ▼
Cloud Function onCheckinCreated → fitmanager_logsAuditoria
   (o painel escuta fitmanager_checkins diretamente em tempo real também)
```

## Cloud Functions

```bash
cd functions
npm install
node ../scripts/download-models.js ./models   # copia os mesmos pesos do face-api.js para cá
npm run deploy                                  # requer firebase-tools + firebase login
```

- `onAlunoWritten` — gera o embedding automaticamente quando um aluno ganha
  foto e ainda não tem embedding.
- `regenerateEmbedding` — callable, para regerar manualmente pelo painel.
- `onCheckinCreated` — espelha o check-in em `fitmanager_logsAuditoria`.
- `checkVencimentos` — varredura diária (08:00) de planos vencendo em 5 dias;
  enfileira em `fitmanager_notificacoesPendentes` para o futuro disparador de
  WhatsApp (a mesma integração Evolution API configurada em **Configurações >
  Notificações / WhatsApp** no painel web).

## ⚠️ Regras de segurança — projeto Firebase compartilhado

`firestore.rules` e `storage.rules` aqui **não são para publicar sozinhos**.
Este projeto Firebase já tem regras de segurança de outro sistema (appfood).
Cada arquivo tem, no topo, instruções de onde colar o trecho do FitManager
dentro do arquivo de regras que já está publicado — nunca rode
`firebase deploy --only firestore:rules` (ou `storage`) apontando só para
estes arquivos, isso apagaria as regras do outro sistema.

## Segurança e LGPD

- `consentimentoLGPD: true` é parte do schema do aluno — o cadastro no painel
  deve obrigar esse checkbox antes de salvar.
- As regras (depois de mescladas — ver aviso acima) bloqueiam qualquer
  leitura/escrita não autenticada; o kiosk nunca passa por elas (usa o Admin
  SDK, que as ignora por padrão) — elas protegem o painel web e qualquer
  outro cliente.
- Todas as funções auxiliares das regras (`fitmanagerIsAdmin()` etc.) e todas
  as coleções/caminhos têm o prefixo `fitmanager` — zero chance de colidir
  com o que já existe no projeto.
- Embeddings nunca trafegam para fora do par kiosk↔Firebase; o painel web não
  precisa (e não deve) ler `faceEmbedding`.
- Fotos no Storage exigem autenticação para leitura (não são públicas).

## O que falta para produção (não incluído neste scaffold)

- **Mesclar as regras de segurança** no `firestore.rules`/`storage.rules` já
  publicados do projeto (ver aviso acima) — sem isso, ninguém autenticado
  consegue ler/gravar nada do FitManager.
- **Autenticação real no painel web**: o painel FitManager atual (React) usa
  um login de demonstração (qualquer senha funciona, sem Firebase Auth). As
  regras assumem um documento em `fitmanager_usuarios/{uid}` com campo
  `perfil` — isso só existe depois de o painel autenticar de verdade via
  Firebase Auth (o SDK cliente já está configurado em
  `Sistema de Gestão de Matrícula/src/lib/firebase.ts`, falta a tela de
  login chamar `signInWithEmailAndPassword` de verdade e as telas passarem a
  ler/escrever no Firestore em vez do array mockado `STUDENTS`).
- **Integração com a catraca** (GPIO/relé/serial) — o ponto de extensão é o
  `if (result.matched)` em `src/renderer/renderer.js`; a spec deixou isso
  "a definir depois".
- **Log fotográfico de tentativas negadas** — mencionado como opcional na
  spec; não implementado aqui (o checkin "negado" já é gravado, só falta a
  foto anexada).
- **Disparo real de WhatsApp** nos vencimentos — a função `checkVencimentos`
  só decide quem notificar; falta o worker que lê
  `fitmanager_notificacoesPendentes` e chama a Evolution API.
- **electron-builder**: configuração básica incluída em `package.json`
  (`npm run build`), mas o empacotamento em instalador não foi testado aqui.
