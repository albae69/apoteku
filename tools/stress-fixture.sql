-- Fixture untuk stress test.
-- Menambah satu batch berstok besar per produk aktif supaya skenario
-- penjualan (write:sale-create) tidak kehabisan stok saat diuji.
-- Idempoten: aman dijalankan berulang.
--
-- Pakai: mysql -h 127.0.0.1 -u root -proot apoteku < tools/stress-fixture.sql

INSERT INTO batches (product_id, supplier_id, batch_number, expiry_date, quantity, cost_price, received_at)
SELECT p.id, NULL, CONCAT('STRESS-', p.id), '2030-01-01', 2000000, 1000, NOW()
FROM products p
WHERE p.is_active = 1
  AND NOT EXISTS (
    SELECT 1 FROM batches b WHERE b.batch_number = CONCAT('STRESS-', p.id)
  );

SELECT b.id, b.batch_number, p.name, b.quantity
FROM batches b
JOIN products p ON p.id = b.product_id
WHERE b.batch_number LIKE 'STRESS-%';
