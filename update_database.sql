-- Tạo bảng comments nếu chưa tồn tại
CREATE TABLE IF NOT EXISTS comments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    book_id INT NOT NULL,
    user_id INT NOT NULL,
    content TEXT NOT NULL,
    rating INT CHECK (rating >= 1 AND rating <= 5),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Thêm cột average_rating vào bảng books nếu chưa tồn tại
ALTER TABLE books
ADD COLUMN IF NOT EXISTS average_rating DECIMAL(3,2) DEFAULT 0.00;

-- Thêm cột total_comments vào bảng books nếu chưa tồn tại
ALTER TABLE books
ADD COLUMN IF NOT EXISTS total_comments INT DEFAULT 0;

-- Tạo trigger để tự động cập nhật average_rating và total_comments khi có comment mới
DELIMITER //
CREATE TRIGGER IF NOT EXISTS update_book_rating_after_comment
AFTER INSERT ON comments
FOR EACH ROW
BEGIN
    UPDATE books 
    SET average_rating = (
        SELECT COALESCE(AVG(rating), 0)
        FROM comments
        WHERE book_id = NEW.book_id
    ),
    total_comments = (
        SELECT COUNT(*)
        FROM comments
        WHERE book_id = NEW.book_id
    )
    WHERE id = NEW.book_id;
END//

-- Tạo trigger để tự động cập nhật average_rating và total_comments khi xóa comment
CREATE TRIGGER IF NOT EXISTS update_book_rating_after_delete
AFTER DELETE ON comments
FOR EACH ROW
BEGIN
    UPDATE books 
    SET average_rating = (
        SELECT COALESCE(AVG(rating), 0)
        FROM comments
        WHERE book_id = OLD.book_id
    ),
    total_comments = (
        SELECT COUNT(*)
        FROM comments
        WHERE book_id = OLD.book_id
    )
    WHERE id = OLD.book_id;
END//
DELIMITER ;

-- Cập nhật dữ liệu cho các sách hiện có
UPDATE books b
SET average_rating = (
    SELECT COALESCE(AVG(rating), 0)
    FROM comments c
    WHERE c.book_id = b.id
),
total_comments = (
    SELECT COUNT(*)
    FROM comments c
    WHERE c.book_id = b.id
); 