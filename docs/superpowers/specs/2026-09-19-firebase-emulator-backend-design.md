# Firebase Emulator Backend Scaffold Design

## Goal

建立不連 production Firebase 的 Firebase Emulator Suite backend scaffold，提供最小 chat/message/media API 邊界與 rules/integration test 基礎。

## Architecture

Firebase Functions 2nd gen 使用 TypeScript 與 Firebase Admin SDK，透過 emulator 提供 Auth、Firestore、Storage、Functions。本地 API 只接受已驗證 Auth token；membership 透過可替換介面驗證，MVP 以 `rooms/{roomId}/members/{uid}` 為權威資料。

`createMessage` 與 `finalizeMediaMessage` 以 `uid + roomId + clientId` 做 idempotency key，使用 Firestore transaction 建立 `clientRequests/{clientId}` 與 canonical message。client 不可直接寫 canonical messages。

## Components

- Root Firebase config：emulator ports、rules、indexes、functions source。
- Functions source：health check、message validation、membership interface、idempotent message creation、media path/object validation。
- Firestore rules：預設 deny；authenticated member 可讀 messages，client 不可寫 messages。
- Storage rules：authenticated owner 可寫 staging object；限制 path、MIME、50 MiB；canonical media 不可由 client 任意刪除。
- Emulator integration tests：Functions contract、duplicate clientId、Firestore rules、Storage rules。
- README：local startup、tests、environment variables、production isolation。

## Scope Boundaries

本次不加入 Redis、Cloud CDN、media transcoding、FCM、App Check enforcement、Flutter SDK、service-account JSON 或 production secrets。

## Error Contract

未登入回傳 `unauthenticated`；非 member 回傳 `permission-denied`；invalid payload/path 回傳 `invalid-argument`；重送同一 key 回傳原 canonical message，不建立第二筆。

## Verification

先執行 failing tests，再寫最小實作。最後執行 lint、typecheck、emulator tests、`git diff --check`，確認 git status 後 commit `chore: scaffold Firebase emulator backend` 並 push `origin/main`。
