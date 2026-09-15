# FitManager

Sistema de gestão de academia (React + Vite + Tailwind CSS v4), com painel administrativo, portal do aluno e reconhecimento facial na entrada via webcam.

## Stack

- React 19 + TypeScript + Vite
- Tailwind CSS v4
- Firebase (Firestore, Storage, Auth, Cloud Functions) — SDK cliente
- `face-api.js` rodando no navegador para o reconhecimento facial (tela **Câmera**)

## Desenvolvimento local

```bash
npm install
cp .env.example .env   # preencha com as chaves do seu app Web no Firebase
npm run dev
```

## Variáveis de ambiente

Veja `.env.example`. Todas são do SDK cliente do Firebase (não são segredos — ficam
no bundle do navegador por design; a segurança real é feita pelas regras do
Firestore/Storage e pela autenticação).

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_FIRESTORE_PREFIX      # opcional — isola os dados se o projeto Firebase for compartilhado
VITE_STORAGE_PREFIX        # opcional — idem, para o Storage
```

## Deploy na Vercel

1. Importe este repositório na Vercel (framework detectado automaticamente: **Vite**).
2. Em **Settings → Environment Variables**, adicione todas as variáveis `VITE_*` listadas acima com os valores do seu projeto Firebase.
3. Build command: `npm run build` · Output directory: `dist` (padrão, não precisa configurar nada a mais).
4. A pasta `public/models/` (modelos do `face-api.js` para a tela Câmera) já está versionada no repositório e é servida como estático — nenhum passo extra necessário.

## `fitmanager-kiosk/`

Subprojeto separado: app desktop em Electron para o PC da entrada da academia (captura de webcam + reconhecimento facial offline-first, sincronizado com o mesmo Firebase). Não faz parte do deploy web — veja `fitmanager-kiosk/README.md` para configurá-lo.
