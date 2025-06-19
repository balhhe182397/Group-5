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

-- Hai dòng dưới đây chỉ chạy nếu cột chưa tồn tại, nếu đã có thì hãy comment lại để tránh lỗi
-- ALTER TABLE books ADD COLUMN average_rating DECIMAL(3,2) DEFAULT 0.00;
-- ALTER TABLE books ADD COLUMN total_comments INT DEFAULT 0;

-- Xóa trigger cũ nếu có
DROP TRIGGER IF EXISTS update_book_rating_after_comment;
DROP TRIGGER IF EXISTS update_book_rating_after_delete;

DELIMITER //
CREATE TRIGGER update_book_rating_after_comment
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

CREATE TRIGGER update_book_rating_after_delete
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

-- Tắt safe update mode trước khi update dữ liệu
SET SQL_SAFE_UPDATES = 0;

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
)
WHERE b.id IS NOT NULL;

-- Create book_notifications table
CREATE TABLE IF NOT EXISTS book_notifications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    book_id INT NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    notification_type ENUM('out_of_stock', 'low_stock', 'other') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (book_id) REFERENCES books(id)
);

-- Check and add average_rating column if it doesn't exist
SET @dbname = 'library_management';
SET @tablename = 'books';
SET @columnname = 'average_rating';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      TABLE_SCHEMA = @dbname
      AND TABLE_NAME = @tablename
      AND COLUMN_NAME = @columnname
  ) > 0,
  "SELECT 1",
  "ALTER TABLE books ADD COLUMN average_rating DECIMAL(3,2) DEFAULT 0.00"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Check and add total_comments column if it doesn't exist
SET @columnname = 'total_comments';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      TABLE_SCHEMA = @dbname
      AND TABLE_NAME = @tablename
      AND COLUMN_NAME = @columnname
  ) > 0,
  "SELECT 1",
  "ALTER TABLE books ADD COLUMN total_comments INT DEFAULT 0"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Update existing books with current average ratings and comment counts
UPDATE books b 
SET 
    average_rating = (
        SELECT COALESCE(AVG(rating), 0) 
        FROM comments c 
        WHERE c.book_id = b.id
    ),
    total_comments = (
        SELECT COUNT(*) 
        FROM comments c 
        WHERE c.book_id = b.id
    );

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS after_comment_insert;
DROP TRIGGER IF EXISTS after_comment_update;
DROP TRIGGER IF EXISTS after_comment_delete;

-- Add trigger to update average_rating and total_comments when a comment is added
DELIMITER //
CREATE TRIGGER after_comment_insert 
AFTER INSERT ON comments
FOR EACH ROW
BEGIN
    UPDATE books 
    SET 
        average_rating = (
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

-- Add trigger to update average_rating and total_comments when a comment is updated
CREATE TRIGGER after_comment_update
AFTER UPDATE ON comments
FOR EACH ROW
BEGIN
    UPDATE books 
    SET 
        average_rating = (
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

-- Add trigger to update average_rating and total_comments when a comment is deleted
CREATE TRIGGER after_comment_delete
AFTER DELETE ON comments
FOR EACH ROW
BEGIN
    UPDATE books 
    SET 
        average_rating = (
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

SELECT * FROM borrows WHERE fine_amount > 0; 