-- Drop and recreate database
DROP DATABASE IF EXISTS library_management;
CREATE DATABASE library_management;
USE library_management;

-- Users table
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role ENUM('admin', 'librarian', 'student', 'lecturer') NOT NULL,
    student_id VARCHAR(20) UNIQUE NULL,
    lecturer_id VARCHAR(20) UNIQUE NULL,
    id_card_image VARCHAR(255) NULL,
    is_verified BOOLEAN DEFAULT FALSE,
    reset_token VARCHAR(100) NULL,
    reset_expires DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Books table
CREATE TABLE books (
    id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(255) NOT NULL,
    author VARCHAR(100) NOT NULL,
    isbn VARCHAR(20) UNIQUE NOT NULL,
    category VARCHAR(50) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    available_quantity INT NOT NULL DEFAULT 1,
    description TEXT,
    cover_image VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Borrows table
CREATE TABLE borrows (
    id INT PRIMARY KEY AUTO_INCREMENT,
    book_id INT NOT NULL,
    user_id INT NOT NULL,
    request_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approval_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    approved_by INT NULL,
    approval_date TIMESTAMP NULL,
    pickup_date TIMESTAMP NULL,
    borrow_date TIMESTAMP NULL,
    due_date TIMESTAMP NULL,
    return_date TIMESTAMP NULL,
    status ENUM('requested', 'borrowed', 'returned', 'overdue', 'cancelled') NOT NULL DEFAULT 'requested',
    fine_amount DECIMAL(10,2) DEFAULT 0.00,
    last_notification_date DATE NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (book_id) REFERENCES books(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (approved_by) REFERENCES users(id)
);

-- Insert default admin user
INSERT INTO users (username, password, email, full_name, role, is_verified)
VALUES ('admin', 'admin123', 'admin@library.com', 'Admin User', 'admin', TRUE);

-- Insert default librarian
INSERT INTO users (username, password, email, full_name, role, is_verified)
VALUES ('librarian', 'librarian123', 'librarian@library.com', 'Librarian User', 'librarian', TRUE);

-- Insert sample student
INSERT INTO users (username, password, email, full_name, role, is_verified, student_id)
VALUES ('student', 'student123', 'student@library.com', 'Student User', 'student', TRUE, 'SV001');

-- Insert sample books
INSERT INTO books (title, author, isbn, category, quantity, available_quantity, description)
VALUES 
('Lập Trình Web với Node.js', 'John Doe', '978-1234567890', 'Technology', 5, 5, 'Sách về lập trình web với Node.js'),
('Cơ Sở Dữ Liệu', 'Jane Smith', '978-0987654321', 'Computer Science', 3, 3, 'Sách về cơ sở dữ liệu'),
('Lập Trình Python', 'Mike Johnson', '978-1122334455', 'Programming', 4, 4, 'Sách về lập trình Python'); 