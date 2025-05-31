USE library_management;

-- Add status column to borrows table
ALTER TABLE borrows 
ADD COLUMN status ENUM('borrowed', 'returned', 'overdue') NOT NULL DEFAULT 'borrowed';

-- Update existing records
UPDATE borrows 
SET status = CASE 
    WHEN return_date IS NOT NULL THEN 'returned'
    WHEN due_date < CURRENT_TIMESTAMP THEN 'overdue'
    ELSE 'borrowed'
END; 