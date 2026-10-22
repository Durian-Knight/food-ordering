# Hệ thống đặt đồ ăn (Microservices + Saga)

API Gateway + 4 service (Auth, Inventory/Catalog, Order, Payment), mỗi service một database PostgreSQL riêng, chạy bằng Docker Compose. Thiết kế chi tiết: [docs/thiet-ke.md](docs/thiet-ke.md).

## Chạy

```bash
cp .env.example .env
docker compose up --build
```

Kiểm tra: `curl localhost:8080/health` phải trả cả 4 service `UP`.

## Cấu trúc

```
gateway/              API Gateway (:8080) — cổng duy nhất mở ra ngoài
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
- [ ] Giai đoạn 2: Auth Service (đăng ký, đăng nhập)
- [ ] Giai đoạn 3: Inventory/Catalog + chống bán vượt + seed
- [ ] Giai đoạn 4: Order + Saga + Payment giả lập
- [ ] Giai đoạn 5: Giao diện web
- [ ] Giai đoạn 6: Test, kịch bản demo, báo cáo
