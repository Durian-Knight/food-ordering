#!/bin/bash
# Chạy 1 lần khi volume Postgres còn trống: tạo 4 database + 4 user riêng.
set -e
create() {
  local user=$1 pw=$2 db=$3
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" <<SQL
CREATE USER $user WITH PASSWORD '$pw';
CREATE DATABASE $db OWNER $user;
REVOKE ALL ON DATABASE $db FROM PUBLIC;
SQL
}
create auth      "$AUTH_DB_PW" auth_db
create inventory "$INV_DB_PW"  inventory_db
create orders    "$ORD_DB_PW"  order_db
create payment   "$PAY_DB_PW"  payment_db
