# Firebase Chat Backend 規格書

狀態：revised draft — incremental sync baseline
日期：2026-09-19
覆核者：主架構 agent

## 1. 決策摘要

推薦採用：

- Firebase Authentication：身份與 token。
- Cloud Firestore：房間、成員、canonical messages、read cursor。
- Cloud Storage：圖片、GIF、影片與縮圖。
- Cloud Functions 2nd gen：授權後的 message API、media finalize、通知與清理。
- Firestore realtime listener：取代主要訊息 WebSocket。
- Firestore `docChanges` + client-side normalized message store：訊息更新只採差異合併，禁止以完整列表 snapshot 取代既有 message state。
- FCM：背景通知，不作訊息真實來源。
- App Check：降低偽造 app、濫用 API 與 billing abuse。
- Realtime Database：只在未來需要 presence／typing indicator 時採用。

目前 Flutter 仍 fake-first。Firebase adapter 必須接在既有
`MessageRepository` / data-source seam 後方，不讓 domain 或 UI 依賴 Firebase SDK。

## 2. 現況與邊界

目前 domain 已支援 text、image、video，並保留 `clientId`、`serverId`、
optimistic status、upload progress。Gespraech adapter 使用 `tempUid`、
`type=0/2/6/7`；這些只屬 legacy transport mapping，不得進入 Firebase
domain contract。

目前 adapter：

- `DioMessageRemoteDataSource`
- `WebSocketMessageEventSource`
- `RemoteMessageMapper`

Firebase 版本應新增：

- `FirebaseMessageRemoteDataSource`
- `FirebaseMediaUploadDataSource`
- `FirestoreMessageEventSource`
- `FirebaseMessageMapper`

## 3. Firestore schema

```text
users/{uid}
rooms/{roomId}
rooms/{roomId}/members/{uid}
rooms/{roomId}/messages/{messageId}
rooms/{roomId}/clientRequests/{clientId}
users/{uid}/devices/{deviceId}
users/{uid}/roomSummaries/{roomId}
```

`clientRequests/{clientId}` 以 document path 隔離 request；uid、roomId、
request state 存在 document 欄位，不把含 `/` 的複合字串當 document ID。

### Message document

```json
{
  "messageId": "server-generated",
  "roomId": "room_123",
  "clientId": "uuid-v4",
  "senderId": "firebase_uid",
  "kind": "text | image | video",
  "text": "hello",
  "media": null,
  "clientCreatedAt": "timestamp",
  "createdAt": "serverTimestamp",
  "state": "normal",
  "schemaVersion": 1
}
```

Media 欄位：

```json
{
  "storagePath": "rooms/room_123/media/uid/client-id/original",
  "thumbnailStoragePath": "rooms/room_123/media/uid/client-id/thumbnail",
  "mimeType": "video/mp4",
  "fileName": "clip.mp4",
  "sizeBytes": 123456,
  "durationMs": 15000,
  "checksum": "sha256:..."
}
```

Canonical message 優先保存 `storagePath`，不保存永久公開 download URL。
目前 50 MiB 限制須在 server 重驗證：`52,428,800` bytes。

## 4. Send protocol

### Text

```text
client 產生 clientId
→ optimistic pending message
→ callable/HTTPS createMessage
→ server 驗證 Auth、App Check、membership
→ transaction 建立 clientRequests/{clientId} + messages/{messageId}
→ Firestore listener 回傳 canonical message
→ client 以 clientId/serverId merge
```

### Media

```text
client 產生 clientId
→ optimistic pending message
→ Storage upload 至 rooms/{roomId}/media/{uid}/{clientId}/original
→ finalizeMediaMessage
→ server 驗證 object path、owner、MIME、size、membership
→ transaction 建立 canonical message
→ listener 回傳 message
```

Media upload 與 message finalize 必須分開。這不同於目前 Gespraech 的
multipart `message/add` atomic request；Firebase adapter 不應硬套舊 API。
Repository 需明確支援「Storage upload progress」與「finalize receipt」兩階段。

## 5. Idempotency、retry、dedupe

- `clientId` 是 retry、app restart、listener echo merge 的穩定身份。
- server key：`uid + roomId + clientId`。
- 已 committed request 重送：回傳原 `messageId`，不得建立第二筆。
- timeout 不代表 server 未寫入；client 必須以相同 `clientId` 查詢／重送。
- fallback content hash 只能診斷，不作主要 idempotency key。
- media retry 優先重用相同 Storage path；orphan upload 由 TTL cleanup 清除。

## 6. Realtime strategy

### 6.1 MVP default：bounded listener + delta merge

主要訊息同步使用 bounded query：

```text
rooms/{roomId}/messages
orderBy(createdAt)
limitToLast(50)
```

Firestore listener 的 `docChanges` 是同步原始事件：

```text
added    → MessageStore.upsert(message)
modified → MessageStore.replace(messageId, message)
removed  → MessageStore.removeOrTombstone(messageId)
```

第一個 query snapshot 可能包含目前 bounded window 的全部 `added`；這不是
完整歷史同步。client 必須將它 merge 進既有 store，不得以 snapshot 取代
repository、room store 或 UI scroll state。

舊訊息使用 cursor pagination。不可監聽完整歷史。使用 `startAfter`／最後一筆
document snapshot 載入更舊頁面；載入結果同樣透過 store merge。

Reconnect 規則：

```text
listener error / app resume
  → 保留現有 MessageStore
  → 重新 attach 相同 bounded query
  → 將 docChanges merge 至 store
  → 保留 room scroll、draft、optimistic pending state
```

禁止以下作法作為訊息刷新流程：

```dart
ref.invalidate(chatConnectionProvider);
```

此類 invalidate 只能用於 connection lifecycle 或 configuration 變更，不能
用來觸發訊息重新載入。訊息 reconnect 必須由 app-scoped event source 管理，
room provider 只消費 store projection。

### 6.2 Client sync boundary

```text
FirestoreMessageEventSource
  → Stream<MessageDelta>

MessageRepository / MessageStore
  → dedupe by messageId/clientId
  → apply added/modified/removed
  → expose immutable room projection

roomMessagesProvider(roomId)
  → watch store projection
```

`Stream<List<ChatMessage>>` 不得作為遠端同步的原始契約；若 UI 需要 list，
只能是 store projection。單筆 delta 不得造成完整 room state 重建。

### 6.3 Optional reliability extension：sequence checkpoint

當產品需要精準偵測長時間離線、事件遺失、跨裝置 replay 或同步稽核時，才啟用
`roomSequence`：

```json
{
  "roomSequence": 1842,
  "sequenceScope": "room"
}
```

規則：

- 由 server 產生，client 不可自行指定。
- client 保存 `lastAppliedSequence` 作為 checkpoint。
- 收到非連續 sequence 時，標記 sync gap，先做 bounded recovery，再恢復 live listener。
- `roomSequence` 不是 MVP 必填欄位；不得為了 sequence counter 讓每個 room
  的單一 counter document 成為高流量 transaction hotspot。

### 6.4 Optional durable event log

以下結構不是 Firebase MVP default：

```text
rooms/{roomId}/messageEvents/{eventId}
```

只有在 gap recovery、replay、稽核或跨裝置嚴格事件順序成為明確需求時採用。
啟用前必須完成：保留期限、TTL cleanup、額外 read/write 成本、索引、transaction
contention 與 migration 評估。

若採用 event log，message mutation 與 event append 必須由受控 server transaction
或等價 atomic workflow 完成；client 不得直接寫 event log。

目前 Gespraech WebSocket adapter 保留作 migration／rollback path；Firebase
MVP 不自建 WebSocket gateway。只有 typing、presence、極低延遲 transient
events 成為硬需求時，才另評估 Cloud Run gateway。

## 7. Security

### Auth

- 未登入不可讀寫。
- `senderId` 一律取 verified Firebase UID，拒絕 client 指定。
- 既有 Gespraech UID 若需保留，建立 `legacyUid ↔ firebaseUid` mapping。

### Firestore Rules

- active room member 可讀 messages。
- client 不可直接寫 canonical messages。
- member 的 read cursor 只允許本人有限欄位更新。
- user profile/device token 只允許本人寫。
- Functions 使用 Admin SDK 時，必須在 server 再做 membership 驗證，不能依賴 Rules。

### Storage Rules

- authenticated user 才可操作 staging path。
- path uid 必須等於 `request.auth.uid`。
- 驗證 MIME、size、clientId path。
- canonical media 不允許 client 任意刪除。
- download 依 Storage SDK + Rules 或短期 signed URL；不使用永久公開 URL。

App Check 與 Auth、Rules 並用，不互相取代。

## 8. Ops / observability

### Environment

- Local：Auth、Firestore、Storage、Functions Emulator。
- Staging：獨立 Firebase project、credentials、App Check registration。
- Production：Rules/indexes/Functions 由 CI/CD 部署，禁止 Console 手改。

### Metrics

- API p50/p95/p99 latency、4xx/5xx、timeout、429。
- duplicate/idempotent replay。
- upload/finalize failure、orphan media、pending age。
- listener reconnect、Firestore reads/writes、Storage egress。
- FCM failure、Function cold start、billing forecast。

Correlation fields：`requestId`、`uid`、`roomId`、`clientId`、`messageId`、
`functionRevision`。禁止 log token、完整訊息內容、signed URL。

### Cost / reliability controls

- listener limit + cursor pagination。
- Storage staging TTL、orphan cleanup、thumbnail separate path。
- per-user/room/IP rate limit。
- Function max instances、budget alerts。
- Firestore scheduled backup；production 評估 PITR 與 restore drill。

## 9. Migration order

1. Firebase Auth UID mapping。
2. Firestore rooms/members schema。
3. MessageStore 與 `MessageDelta` contract。
4. Read-only Firestore bounded listener + `docChanges` merge。
5. Text createMessage。
6. Storage image/video upload。
7. Media finalize。
8. clientId idempotency、retry、orphan cleanup。
9. Firestore offline persistence / cache consistency verification。
10. FCM。
11. Emulator Rules tests。
12. Staging synthetic rooms/messages。
13. Feature flag gradual rollout。
14. 只有 reliability requirements 成立時，才加入 `roomSequence` / event log。
15. 觀察後再移除 Gespraech WebSocket adapter。

## 10. 覆核結論與未決事項

採用 Firebase Auth + Firestore + Storage + Functions 2nd gen + App Check。
Firestore listener 是主要訊息 realtime source；RTDB 只保留 presence/typing
選項；不自建 Firebase WebSocket gateway。

開始實作前仍需決定：Firebase UID migration、room ID 型別、membership 權威、
媒體保存期限、thumbnail/transcoding、DAU/egress 預估、資料區域與合規、
是否需要 app restart 恢復 pending send、是否有足夠需求啟用 roomSequence/event log。

## 參考

- [Get realtime updates with Cloud Firestore](https://firebase.google.com/docs/firestore/query-data/listen)
- [Paginate data with query cursors](https://firebase.google.com/docs/firestore/query-data/query-cursors)
- [Access data offline](https://firebase.google.com/docs/firestore/enterprise/enable-offline)
- [Firestore vs Realtime Database](https://firebase.google.com/docs/firestore/rtdb-vs-firestore)
- [Cloud Functions 1st/2nd gen](https://firebase.google.com/docs/functions/version-comparison)
- [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)
- [Firebase Security Rules](https://firebase.google.com/docs/rules/basics)
- [Storage Rules conditions](https://firebase.google.com/docs/storage/security/rules-conditions)
- [Firebase App Check custom backend](https://firebase.google.com/docs/app-check/custom-resource)
