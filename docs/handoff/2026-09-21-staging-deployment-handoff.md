# 2026-09-21 Backend & Staging Readiness Handoff

## 1. Session state

- **日期**：2026-09-21
- **後端專案目錄**：`/Users/appgongyong/Documents/Codex/2026-09-18/pet_digit_backend`
- **前端專案目錄**：`/Users/appgongyong/Documents/Codex/2026-09-18/referenced-chatgpt-conversation-this-is-an`
- **最新 Commit**：`6639d17` (`fix(firebase): remove redundant message index`)
- **審查結論**：Chat v1 架構在 Round 5 Senior Backend Review 獲 **APPROVE**（本地模擬器範圍審查通過，`npm run verify` 全部通過）
- **重大進展**：本日已起草完成 [user-pet-room-v1.md](file:///Users/appgongyong/Documents/Codex/2026-09-18/pet_digit_backend/docs/contracts/user-pet-room-v1.md) 以及前端規格 [2026-09-21-user-pet-room-lifecycle-spec.md](file:///Users/appgongyong/Documents/Codex/2026-09-18/referenced-chatgpt-conversation-this-is-an/docs/specs/2026-09-21-user-pet-room-lifecycle-spec.md)。

---

## 2. 當前架構與本地已達成項目（Chat v1）

1. **冪等性與併發回放（C-1, M-1）**
   - 請求處理採單一事務進入 `processing` 狀態（60s lease）。
   - 重複 `clientId` 請求進入 750ms 上限、每 50ms 輪詢的 `waitForRequestResolution`；前筆成功直接返回同一標準訊息，超時則嚴格 fail-closed（`failed-precondition`）。
2. **串流 SHA-256 媒體校驗（H-2）**
   - 媒體 Finalize 採 `pipeline(object.createReadStream(), hash)` 串流計算 Digest，不佔用完整緩衝區記憶體。
   - 嚴格指定執行資源：`memory: 512MiB`, `timeoutSeconds: 120`, `concurrency: 10`。
3. **排程器與游標分頁（H-1, M-2）**
   - `recoverExpiredClientRequestsScheduled`：每 5 分鐘執行一次，限制每批 100 筆，使用 base64url 游標並持久化於 `maintenance/scheduler-recovery`。
   - `cleanupStagingObjectsScheduled`：每小時執行一次，清理過期暫存。
   - `cleanupOrphanFinalizedMediaScheduled`：每小時執行一次，每批 100 筆、並行度上限 8，保留 24 小時寬限期。
   - 所有 Function 與 Scheduler 均釘選在台灣區域 `asia-east1`。
4. **安全規則與權限防禦（L-1）**
   - 客戶端全面禁止直寫 canonical 訊息，僅能透過 Cloud Functions 寫入。
   - Storage Rules 先檢查成員文檔存在性（`firestore.exists(...)`）再判斷 `active == true`。

---

## 3. 待辦事項清單

### 階段 A：Staging 雲端環境部署整備（Chat v1 Pipeline）

#### Gate 1: Firebase / GCP 雲端專案與資源確認
- [ ] 確認雲端專案 ID `pet-digit-backend`（對應 `.firebaserc` 中的 `staging` alias）。
- [ ] 確認 Firestore Native (Standard) 與 Storage 預設儲存貯體已在 `asia-east1` 就緒。
- [ ] 確保 staging / production 環境機密設定獨立於代碼庫外管理（禁止將憑證與本地 bypass 變數帶入雲端）。

#### Gate 2: 安全規則與索引部署
- [ ] 執行 `firebase deploy --only firestore:rules,storage --project=staging` 部署安全規則。
- [ ] 執行 `firebase deploy --only firestore:indexes --project=staging` 部署複合索引。
- [ ] 在 Firebase 控制台確認 `clientRequests` collection-group 複合索引（`state ASC, leaseUntil ASC, __name__ ASC`）狀態變更為 `READY`。

#### Gate 3: App Check 嚴格模式與供應商註冊
- [ ] 在 Firebase 控制台 App Check 頁面註冊客戶端憑證：
  - Apple 平台：DeviceCheck / App Attest
  - Android 平台：Play Integrity
- [ ] 驗證雲端環境生效之 `functions/.env.pet-digit-backend` 設定（`APP_ENV=staging`, `APP_CHECK_MODE=enforce`）。
- [ ] 進行 Fail-closed 驗證：缺少或無效 App Check token 的請求必須被拒絕。

#### Gate 4: Cloud Functions (2nd gen) 與 Pub/Sub 排程器部署
- [ ] 執行 `firebase deploy --only functions --project=staging` 部署所有 2nd gen Functions。
- [ ] 確認 Cloud Scheduler 觸發機制與 Pub/Sub 服務帳號（IAM）具有調用與發布權限：
  - `recoverExpiredClientRequestsScheduled`（每 5 分鐘）
  - `cleanupStagingObjectsScheduled`（每 1 小時）
  - `cleanupOrphanFinalizedMediaScheduled`（每 1 小時）
- [ ] 檢查初始日誌確認排程觸發與游標前進正常。

#### Gate 5: Cloud Logging 結構化日誌警報設置
- [ ] 在 Google Cloud Logging / Monitoring 針對下列結構化事件建立告警規則：
  - `finalized_media_delete_failed`
  - `staging_delete_failed`
  - `compensation_failed`
  - `active_lease_age` 超過閾值
  - 任務重試次數超限

#### Gate 6: 外部相依性安全審計
- [ ] 在可正常連線至公共 npm registry 的環境中執行 `npm audit --omit=dev`。
- [ ] 產出相依性安全報告並完成最終安全簽核。

---

### 階段 B：使用者、寵物與房間生命週期實作（Lifecycle v1 Feature Pipeline）

依據 [docs/contracts/user-pet-room-v1.md](file:///Users/appgongyong/Documents/Codex/2026-09-18/pet_digit_backend/docs/contracts/user-pet-room-v1.md) 與前端契約規格：

#### 1. 資料集合與 Security Rules 擴充
- [ ] **`/users/{uid}` 與 `/users/{uid}/pets/{petId}`**：建立 UserProfile 與 Pet 資料模型及驗證邏輯；Rules 限制僅本人可讀寫自身寵物與檔案。
- [ ] **`/searchTags/{searchTagLower}`**：建立 handle 唯一性反向索引，透過 Cloud Function 保證大小寫不區分的原子寫入與防重名，客戶端禁止直寫。
- [ ] **`/users/{uid}/roomSummaries/{roomId}`**：聊天室列表 Fan-out 模型，建房/進房/更動時由後端維護快照。
- [ ] **`/rooms/{roomId}/members/{uid}` 擴充**：支援 `pets: PetRoomSnapshot[]`，紀錄當前房間登場的寵物快照（照片、物種、品種、性格）。

#### 2. Callable Functions (v2 onCall) 實作
- [ ] `upsertUserProfile(nickname, avatarUrl, searchTag)`：更新個人檔案並原子更新 `searchTags`。
- [ ] `searchUsers(query, limit?)`：依 searchTag 前綴檢索使用者（排除自身）。
- [ ] `registerPet(name, species, breed, avatarUrl, gender?, birthday?, personality?, setAsDefault?)`：註冊名下寵物。
- [ ] `updatePet(petId, updates)`：修改寵物資料。
- [ ] `setDefaultPet(petId)`：切換預設出場主寵物。
- [ ] `createRoom(type: 'direct' | 'group', inviteeUids, name?, avatarUrl?)`：
  - 私聊（direct）採用確定性 ID `dm_{minUid}_{maxUid}`，防止重複建房。
  - 同步將預設寵物快照寫入 members。
  - Fan-out 寫入各成員之 `roomSummaries`。
- [ ] `updateRoomPets(roomId, petIds)`：房間內寵物調度，將勾選的寵物列表深快照至成員文檔。
- [ ] `leaveRoom(roomId)`：退出房間與清理相關快照。

#### 3. 測試覆蓋
- [ ] 撰寫單元測試與 Security Rules 測試覆蓋新增集合與 Callable Functions。
- [ ] 撰寫 Integration 測試模擬使用者註冊、帶寵進房與房間生命週期。

---

### 階段 C：客戶端（Flutter）跨端整合驗證

- [ ] **Android Staging 配置驗證**：前端已提交 `feat(firebase): add Android staging configuration`，連線至真實 staging 驗證登入與端點通信。
- [ ] **權限與成員狀態測試**：驗證使用者在 `active: false` 時被即時拒絕讀寫與媒體上傳。
- [ ] **增量同步（Incremental Sync）驗證**：驗證 Flutter MessageStore 與 Firestore `DocumentChange` 即時監聽與游標分頁整合。
- [ ] **客戶端重試與冪等驗證**：模擬弱網或重複送出訊息，確認客戶端接收到同一標準訊息且無重複紀錄。
- [ ] **雙端寵物狀態同步**：驗證前端房間渲染層（像素幀/動作機）與後端成員寵物快照（`PetRoomSnapshot`）的連動。

---

## 4. 常用驗證指令

```bash
# 本地完整驗證套件（lint -> typecheck -> build -> unit test -> rules test -> integration test -> git check）
npm run verify

# 單獨運行單元測試
npm test

# 啟動本地 Emulator 套件
npm run emulator

# Staging 預覽或部署（需已完成 firebase login）
firebase deploy --only firestore:rules,storage --project=staging
firebase deploy --only firestore:indexes --project=staging
firebase deploy --only functions --project=staging
```
