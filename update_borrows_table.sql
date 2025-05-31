USE library_management;

-- Add new columns to borrows table
ALTER TABLE borrows 
ADD COLUMN request_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER user_id,
ADD COLUMN approval_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending' AFTER request_date,
ADD COLUMN approved_by INT NULL AFTER approval_status,
ADD COLUMN approval_date TIMESTAMP NULL AFTER approved_by,
ADD COLUMN pickup_date TIMESTAMP NULL AFTER approval_date,
MODIFY COLUMN borrow_date TIMESTAMP NULL,
MODIFY COLUMN due_date TIMESTAMP NULL;

-- Add foreign key for approved_by
ALTER TABLE borrows
ADD CONSTRAINT fk_approved_by
FOREIGN KEY (approved_by) REFERENCES users(id);

-- Update status column to include new statuses
ALTER TABLE borrows
MODIFY COLUMN status ENUM('requested', 'borrowed', 'returned', 'overdue', 'cancelled') NOT NULL DEFAULT 'requested';

-- Update existing records
UPDATE borrows 
SET status = CASE 
    WHEN return_date IS NOT NULL THEN 'returned'
    WHEN due_date < CURRENT_TIMESTAMP THEN 'overdue'
    WHEN borrow_date IS NOT NULL THEN 'borrowed'
    ELSE 'requested'
END; 