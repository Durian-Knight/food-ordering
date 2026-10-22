-- Dữ liệu mẫu, chỉ chèn khi bảng stores còn trống.
-- owner_id = 2 là tài khoản chủ quán tạo bởi seed của Auth Service.
INSERT INTO stores (name, address, owner_id) VALUES
  ('Phở Hà Nội', '12 Lê Lợi, Q.1', 2),
  ('Cơm Tấm Sài Gòn', '45 Nguyễn Trãi, Q.5', 2);

INSERT INTO menu_items (store_id, name, price) VALUES
  (1, 'Phở bò tái', 55000),
  (1, 'Phở gà', 50000),
  (1, 'Quẩy', 5000),
  (2, 'Cơm tấm sườn bì chả', 60000),
  (2, 'Cơm tấm sườn', 45000),
  (2, 'Trà đá', 5000);

INSERT INTO stock (item_id, available) VALUES
  (1, 10), (2, 20), (3, 50), (4, 10), (5, 30), (6, 100);
