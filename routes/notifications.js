const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isLibrarian } = require('../middleware/auth');
const { sendEmail } = require('../config/email');

// Add these helper functions at the top of the file after the imports
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryTransaction(operation, retries = MAX_RETRIES) {
    for (let i = 0; i < retries; i++) {
        try {
            const connection = await db.getConnection();
            try {
                await connection.beginTransaction();
                const result = await operation(connection);
                await connection.commit();
                return result;
            } catch (error) {
                await connection.rollback();
                if (error.code === 'ER_LOCK_WAIT_TIMEOUT' && i < retries - 1) {
                    await sleep(RETRY_DELAY * (i + 1)); // Exponential backoff
                    continue;
                }
                throw error;
            } finally {
                connection.release();
            }
        } catch (error) {
            if (error.code === 'ER_LOCK_WAIT_TIMEOUT' && i < retries - 1) {
                await sleep(RETRY_DELAY * (i + 1));
                continue;
            }
            throw error;
        }
    }
}

// Function to send overdue notification email
async function sendOverdueNotification(user, book, daysOverdue) {
    if (!user.email) {
        console.error('No recipient email for overdue notification');
        return;
    }
    const mailOptions = {
        from: 'nguyenvanhoitgm@gmail.com',
        to: user.email,
        subject: 'Overdue Book Notification',
        html: `
            <h2>Overdue Book Notification</h2>
            <p>Dear ${user.full_name},</p>
            <p>We would like to inform you that you have an overdue book:</p>
            <ul>
                <li>Book Title: ${book.title}</li>
                <li>Due Date: ${new Date(book.due_date).toLocaleDateString('en-US')}</li>
                <li>Days Overdue: ${daysOverdue} days</li>
                <li>Current Fine: ${(daysOverdue * 5000).toLocaleString('en-US')} VND</li>
            </ul>
            <p>Please return the book as soon as possible to avoid additional fines.</p>
            <p>Best regards,<br>Library System</p>
        `
    };

    try {
        await sendEmail(mailOptions.to, mailOptions.subject, mailOptions.html);
        console.log(`Overdue notification sent to ${user.email}`);
    } catch (error) {
        console.error('Error sending overdue notification:', error);
    }
}

// Function to create book notification in database
async function createBookNotification(book, type) {
    try {
        let message = '';
        switch (type) {
            case 'out_of_stock':
                message = `Book "${book.title}" is out of stock. Need to restock.`;
                break;
            case 'low_stock':
                message = `Book "${book.title}" is running low (${book.available_quantity} copies left).`;
                break;
            default:
                message = `Notification about book "${book.title}"`;
        }

        await db.execute(
            'INSERT INTO book_notifications (book_id, message, notification_type) VALUES (?, ?, ?)',
            [book.id, message, type]
        );
    } catch (error) {
        console.error('Error creating book notification:', error);
    }
}

// Function to send out-of-stock notification to librarians and admins
async function sendOutOfStockNotification(book) {
    try {
        await retryTransaction(async (connection) => {
            // Create notification in database
            await connection.execute(
                'INSERT INTO book_notifications (book_id, message, notification_type) VALUES (?, ?, ?)',
                [
                    book.id,
                    `Book "${book.title}" is out of stock.`,
                    'out_of_stock'
                ]
            );

            // Get all admin and librarian users
            const [users] = await connection.execute(
                "SELECT id, email, full_name FROM users WHERE role IN ('admin', 'librarian')"
            );

            // Send email to each admin/librarian
            for (const user of users) {
                if (!user.email) {
                    console.error('No recipient email for out of stock notification');
                    continue;
                }
                await sendEmail(
                    user.email,
                    'Book Out of Stock Notification',
                    `
                    <h2>Book Out of Stock Alert</h2>
                    <p>Dear ${user.full_name},</p>
                    <p>This is to notify you that the following book is now out of stock:</p>
                    <ul>
                        <li>Title: ${book.title}</li>
                        <li>Author: ${book.author}</li>
                        <li>ISBN: ${book.isbn}</li>
                        <li>Total Quantity: ${book.quantity}</li>
                    </ul>
                    <p>Please take necessary action to restock this book.</p>
                    <p>Best regards,<br>Library System</p>
                    `
                );
            }

            console.log(`Out of stock notification sent to ${users.length} staff members for book: ${book.title}`);
            return users.length;
        });
    } catch (error) {
        console.error('Error sending out of stock notification:', error);
        throw error;
    }
}

// Function to check and send notifications for overdue books
async function checkOverdueBooks() {
    try {
        const [overdueBooks] = await db.execute(`
            SELECT b.*, u.email, u.full_name, bk.title
            FROM borrows b
            JOIN users u ON b.user_id = u.id
            JOIN books bk ON b.book_id = bk.id
            WHERE b.status = 'borrowed'
            AND b.due_date < CURRENT_TIMESTAMP
            AND (b.last_notification_date IS NULL OR b.last_notification_date < CURRENT_DATE)
        `);

        console.log(`Found ${overdueBooks.length} overdue books`);

        for (const book of overdueBooks) {
            const daysOverdue = Math.ceil((new Date() - new Date(book.due_date)) / (1000 * 60 * 60 * 24));
            await sendOverdueNotification(
                { email: book.email, full_name: book.full_name },
                { title: book.title, due_date: book.due_date },
                daysOverdue
            );

            // Update last notification date
            await db.execute(
                'UPDATE borrows SET last_notification_date = CURRENT_DATE WHERE id = ?',
                [book.id]
            );
        }
    } catch (error) {
        console.error('Error checking overdue books:', error);
    }
}

// Schedule the check to run every hour
setInterval(checkOverdueBooks, 60 * 60 * 1000);

// Run the check immediately when the server starts
checkOverdueBooks();

// Get all notifications
router.get('/', isLibrarian, async (req, res) => {
    try {
        const [notifications] = await db.execute(`
            SELECT n.*, b.title, b.author, b.isbn
            FROM book_notifications n
            JOIN books b ON n.book_id = b.id
            ORDER BY n.created_at DESC
        `);

        res.render('notifications/index', { notifications });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        req.flash('error_msg', 'Error loading notifications');
        res.redirect('/');
    }
});

// Mark notification as read
router.post('/mark-read/:id', isLibrarian, async (req, res) => {
    try {
        await db.execute(
            'UPDATE book_notifications SET is_read = TRUE WHERE id = ?',
            [req.params.id]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ error: 'Failed to mark notification as read' });
    }
});

// Delete notification
router.delete('/:id', isLibrarian, async (req, res) => {
    try {
        await db.execute('DELETE FROM book_notifications WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({ error: 'Failed to delete notification' });
    }
});

// Get unread notifications count
router.get('/unread-count', isLibrarian, async (req, res) => {
    try {
        const [result] = await db.execute(
            'SELECT COUNT(*) as count FROM book_notifications WHERE is_read = FALSE'
        );
        res.json({ count: result[0].count });
    } catch (error) {
        console.error('Error getting unread notifications count:', error);
        res.status(500).json({ error: 'Failed to get unread notifications count' });
    }
});

module.exports = {
    router,
    sendOutOfStockNotification
}; 