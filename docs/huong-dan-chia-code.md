# Hướng dẫn chia code cho nhóm

Tài liệu này chia hệ thống thành từng phần cho mỗi thành viên. Mỗi người **nắm chắc phần của mình** để giải thích khi bảo vệ, đồng thời **hiểu luồng chung** của cả hệ thống.

Toàn bộ code khoảng 1.300 dòng, chia làm 4 phần có khối lượng gần bằng nhau.

## 1. Bảng phân công (nhóm 4 người)

| Người | Phần phụ trách | File chính | Số dòng |
|-------|----------------|------------|--------:|
| **TV1** | API Gateway + Auth Service + Giao diện web | `gateway/src/index.js`, `auth-service/src/index.js`, `gateway/src/public/*` | ~550 |
| **TV2** | Inventory/Catalog Service + Chống bán vượt | `inventory-service/src/index.js`, `inventory-service/src/db/*.sql`, `scripts/concurrency-test.mjs` | ~350 |
| **TV3** | Order Service + Saga | `order-service/src/saga.js`, `order-service/src/index.js`, `order-service/src/db/schema.sql` | ~220 |
| **TV4** | Payment Service + Docker + Database + Báo cáo | `payment-service/*`, `docker-compose.yml`, `infra/postgres/init.sh`, các `Dockerfile`, `docs/thiet-ke.md` | ~200 + báo cáo |

TV3 có ít dòng nhất nhưng giữ phần **khó và quan trọng nhất** (Saga), nên sẽ bị hỏi nhiều nhất. TV4 có ít code nhưng phụ trách tổng hợp báo cáo.

**Nhóm 3 người:** gộp TV1 và TV4. Người này phụ trách Gateway, Auth, Payment, Docker. Giao diện web chuyển cho TV2.

**Nhóm 2 người:** người A làm TV1 + TV4, người B làm TV2 + TV3 (vì Inventory và Saga liên quan chặt với nhau).

## 2. Chi tiết từng phần

### TV1: API Gateway + Auth + Giao diện web

**Đọc code theo thứ tự:**
1. `gateway/src/index.js`: bảng `ROUTES` (đường dẫn nào đi tới service nào, đường dẫn nào cần đăng nhập), phần kiểm tra JWT, phần proxy.
2. `auth-service/src/index.js`: đăng ký (bcrypt hash mật khẩu), đăng nhập (so khớp, cấp JWT), `/auth/me`, tài khoản mẫu.
3. `gateway/src/public/app.js`: hàm `api()` gửi token, luồng đăng nhập, giỏ hàng, đặt món, hiển thị nhật ký Saga.

**Phải giải thích được:**
- Vì sao client chỉ gọi Gateway, không gọi thẳng service.
- Gateway kiểm tra JWT rồi tự gắn `X-User-Id`, `X-User-Role` xuống service. Gateway **xóa** 2 header này nếu client tự gửi, để không ai giả danh người khác được.
- Vì sao `/api/reservations` và `POST /api/payments` trả 404: đó là API nội bộ, không có trong bảng `ROUTES`.
- JWT gồm những gì (`sub`, `email`, `role`, hạn 8 giờ), vì sao không lưu mật khẩu gốc.

**Demo phụ trách:** kịch bản 4 (Gateway chặn), đăng ký và đăng nhập trên giao diện.

### TV2: Inventory/Catalog + Chống bán vượt

**Đọc code theo thứ tự:**
1. `inventory-service/src/db/schema.sql`: bảng `stock` có 2 cột `available` (còn bán được) và `reserved` (đang giữ cho đơn chưa xong), ràng buộc `CHECK (available >= 0)`, bảng `reservations` với `UNIQUE(order_id)`.
2. `inventory-service/src/index.js`, phần `POST /reservations`: câu `UPDATE ... WHERE available >= qty`, việc sắp xếp `item_id` trước khi update.
3. Hàm `finishReservation`: release (hoàn kho) và confirm (chốt bán), `SELECT ... FOR UPDATE`.
4. `scripts/concurrency-test.mjs`.

**Phải giải thích được:**
- **Vì sao không bán vượt:** câu `UPDATE` có điều kiện được PostgreSQL thực hiện nguyên tử trên từng dòng. 50 request cùng lúc sẽ xếp hàng ở dòng đó, request nào thấy `available < qty` thì cập nhật 0 dòng và báo hết hàng.
- So sánh 3 cách: (1) cập nhật có điều kiện (đang dùng: đơn giản, không cần thử lại), (2) khóa bi quan `SELECT ... FOR UPDATE` rồi mới trừ (đúng nhưng giữ khóa lâu hơn), (3) khóa lạc quan bằng cột `version` (phải thử lại khi xung đột, nhiều xung đột thì chậm).
- Vì sao sắp xếp `item_id` tăng dần: 2 đơn cùng có món 5 và 6 nhưng thứ tự khác nhau có thể khóa chéo nhau (deadlock). Khóa cùng thứ tự thì không bị.
- Vì sao gọi release 2 lần không cộng kho 2 lần: release kiểm tra trạng thái, nếu đã `RELEASED` thì trả OK luôn.

**Demo phụ trách:** kịch bản 3 (50 đơn đồng thời), sửa tồn kho bằng tài khoản chủ quán.

### TV3: Order Service + Saga

**Đọc code theo thứ tự:**
1. `order-service/src/db/schema.sql`: bảng `orders` (các trạng thái), `order_items` (lưu tên và giá lúc đặt), `saga_log`.
2. `order-service/src/saga.js`, hàm `placeOrder`: **đây là file quan trọng nhất của đồ án**. Đọc theo 4 bước có đánh dấu trong code.
3. `order-service/src/index.js`: API tạo đơn, xem đơn, chuyển kết quả Saga thành mã HTTP.

**Phải giải thích được:**
- **Vì sao không dùng giao dịch database thông thường (hay 2PC):** mỗi service có database riêng, không thể gói 3 database vào 1 transaction. 2PC khóa tài nguyên lâu và phụ thuộc vào một bộ điều phối trung tâm.
- **Orchestration và Choreography:** nhóm chọn Orchestration (Order Service điều khiển từng bước) vì dễ theo dõi, dễ vẽ sequence diagram, dễ gỡ lỗi. Choreography (các service phát sự kiện cho nhau) thì lỏng hơn nhưng khó theo dõi luồng.
- Bảng 4 bước và hành động hoàn tác (xem `docs/thiet-ke.md` mục 4).
- Luồng khi Payment lỗi: đơn chuyển `COMPENSATING`, gọi Inventory hoàn kho, rồi chuyển đơn sang `CANCELLED`. Mở `sagaLog` để chỉ từng dòng.
- Vì sao lưu `name_snapshot`, `price_snapshot`: giá món có thể đổi sau này, đơn cũ phải giữ đúng giá lúc đặt.
- **Giới hạn** (thầy rất hay hỏi): nếu Inventory sập đúng lúc hoàn kho, đơn dừng ở `COMPENSATING`. Hướng khắc phục: thử lại có giãn cách, job định kỳ quét đơn `COMPENSATING`, giữ chỗ có hạn để tự nhả hàng.

**Demo phụ trách:** kịch bản 1 và 2, mở nhật ký Saga trên giao diện.

### TV4: Payment + Docker + Database + Báo cáo

**Đọc code theo thứ tự:**
1. `payment-service/src/index.js`: thanh toán giả lập, cờ `simulateFail`, `ON CONFLICT (order_id) DO NOTHING`.
2. `docker-compose.yml`: 6 container, `depends_on` với `condition: service_healthy`, biến môi trường, chỉ Gateway mở cổng.
3. `infra/postgres/init.sh`: tạo 4 database và 4 user, `REVOKE ... FROM PUBLIC`.
4. Một `Dockerfile` bất kỳ (5 file giống nhau).

**Phải giải thích được:**
- **Database per service:** 1 container PostgreSQL nhưng 4 database và 4 user riêng. User `inventory` không kết nối được vào `order_db`. Có thể chứng minh bằng lệnh:
  `docker compose exec postgres psql -U inventory -d order_db` (sẽ báo không có quyền CONNECT).
- Vì sao dùng 1 container thay vì 4: nhẹ máy hơn mà vẫn tách quyền. Nếu thầy yêu cầu tách hẳn thì chỉ cần thêm container trong compose.
- Vì sao Payment không cho client gọi trực tiếp: chỉ Order Service được thu tiền trong Saga.
- Vì sao `UNIQUE(order_id)` ở bảng payments: tránh thu tiền 2 lần cho 1 đơn.
- Cách chạy toàn bộ hệ thống bằng 1 lệnh, cách xem log, cách reset dữ liệu.

**Demo phụ trách:** khởi động hệ thống từ đầu, mở `/health`, chứng minh database tách quyền.

**Báo cáo:** tổng hợp theo dàn ý trong kế hoạch. Các sơ đồ lấy từ `docs/thiet-ke.md` (dán mã mermaid vào https://mermaid.live để xuất ảnh), ảnh giao diện lấy từ `docs/anh/`.

## 3. Phần cả nhóm đều phải hiểu

Thầy có thể hỏi bất kỳ ai những câu sau, nên ai cũng cần trả lời được:

1. Vẽ lại luồng một đơn hàng đi qua những service nào (xem sequence diagram trong `docs/thiet-ke.md`).
2. Khi thanh toán lỗi thì kho được trả lại bằng cách nào.
3. Khi 2 người cùng đặt phần cuối cùng thì ai được, ai không.
4. Mỗi service có database riêng nghĩa là gì, vì sao không cho service này đọc database của service khác.
5. Trạng thái của đơn hàng: `PENDING` → `STOCK_RESERVED` → `CONFIRMED`, hoặc → `COMPENSATING` → `CANCELLED`.

## 4. Cách làm việc chung trên repo

Mỗi thành viên:

```bash
git clone https://github.com/Durian-Knight/food-ordering.git
cd food-ordering
cp .env.example .env
docker compose up --build
```

Khi cần sửa phần của mình:

```bash
git checkout -b tv2-inventory          # tạo nhánh riêng, đặt tên theo phần phụ trách
# ... sửa code trong thư mục của mình ...
docker compose up --build inventory-service   # build lại riêng service vừa sửa
git add inventory-service
git commit -m "Inventory: mô tả thay đổi"
git push -u origin tv2-inventory
```

Sau đó tạo Pull Request trên GitHub để người khác xem rồi mới gộp vào `main`.

Lưu ý:
- Mỗi người chủ yếu sửa trong thư mục service của mình, nên hầu như không bị xung đột code.
- Nếu đổi API mà service khác đang gọi (ví dụ đổi dữ liệu trả về của `POST /reservations`, mà Order Service đang dùng), hãy báo người phụ trách service đó trước.
- Muốn thêm thành viên vào repo: vào **Settings → Collaborators** trên GitHub và mời theo tên tài khoản.

## 5. Gợi ý thứ tự trình bày khi bảo vệ (khoảng 15 phút)

| Thời gian | Người | Nội dung |
|-----------|-------|----------|
| 2 phút | TV4 | Giới thiệu đề tài, kiến trúc, khởi động hệ thống, `/health` |
| 3 phút | TV1 | Gateway, đăng nhập, demo bị chặn khi không có token |
| 5 phút | TV3 | Saga: demo đặt thành công, demo thanh toán lỗi, mở nhật ký Saga, giải thích sequence diagram |
| 3 phút | TV2 | Chống bán vượt: chạy script 50 đơn đồng thời, giải thích câu UPDATE |
| 2 phút | TV4 | Database per service, hạn chế và hướng phát triển |
