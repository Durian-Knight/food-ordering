# Hệ thống đặt đồ ăn (Microservices + Saga)

API Gateway + 4 service (Auth, Inventory/Catalog, Order, Payment), mỗi service một database PostgreSQL riêng, chạy bằng Docker Compose. Thiết kế chi tiết: [docs/thiet-ke.md](docs/thiet-ke.md).

## Chạy

```bash
cp .env.example .env
docker compose up --build
```

Mở giao diện web: http://localhost:8080 (đăng nhập sẵn `khach@food.vn` / `123456`).

Kiểm tra: `curl localhost:8080/health` phải trả cả 4 service `UP`.

![Thanh toán lỗi, Saga hoàn kho](docs/anh/thanh-toan-loi-saga.png)

## Tài khoản mẫu

Mật khẩu đều là `123456`: `admin@food.vn` (ADMIN), `chuquan@food.vn` (STORE_OWNER, chủ 2 cửa hàng mẫu), `khach@food.vn` (CUSTOMER).

Muốn xóa sạch dữ liệu để seed lại: `docker compose down -v`.

## Thử nhanh bằng curl

```bash
TOKEN=$(curl -s -X POST localhost:8080/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"khach@food.vn","password":"123456"}' | sed 's/.*"accessToken":"\([^"]*\)".*/\1/')

# Đặt món thành công → CONFIRMED (201)
curl -X POST localhost:8080/api/orders -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"items":[{"itemId":2,"qty":2}]}'

# Ép thanh toán lỗi → kho được hoàn lại, đơn CANCELLED (409), xem sagaLog trong kết quả
curl -X POST localhost:8080/api/orders -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"items":[{"itemId":2,"qty":2}],"simulatePaymentFail":true}'

# 50 đơn cùng lúc tranh 10 phần → đúng 10 thành công
node scripts/concurrency-test.mjs
```

## Cấu trúc

```
gateway/              API Gateway (:8080) — cổng duy nhất mở ra ngoài, phục vụ luôn giao diện web (src/public)
auth-service/         Đăng ký, đăng nhập, JWT (:3001, auth_db)
inventory-service/    Cửa hàng, món, tồn kho, giữ chỗ (:3002, inventory_db)
order-service/        Đơn hàng + điều phối Saga (:3003, order_db)
payment-service/      Thanh toán giả lập (:3004, payment_db)
infra/postgres/       Script tạo 4 database + 4 user
scripts/              Seed dữ liệu, test đồng thời, kịch bản demo
docs/                 Thiết kế, diagram, báo cáo
```

Mỗi service tự tạo bảng từ `src/db/schema.sql` khi khởi động.

## Trạng thái

- [x] Giai đoạn 1: khung 5 service, Docker Compose, database per service, `/health`, Gateway định tuyến + JWT
- [x] Giai đoạn 2: Auth Service (đăng ký, đăng nhập, /auth/me)
- [x] Giai đoạn 3: Inventory/Catalog + chống bán vượt + seed
- [x] Giai đoạn 4: Order + Saga + Payment giả lập
- [x] Giai đoạn 5: Giao diện web
- [ ] Giai đoạn 6: Test, kịch bản demo, báo cáo
