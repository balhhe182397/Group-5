const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAuthenticated, isLibrarian } = require('../middleware/auth');
const { sendEmail } = require('../config/email');
const { sendOutOfStockNotification } = require('./notifications');

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

// Add this function after the sendEmail helper function
async function checkBookStockAndNotify(bookId, connection) {
    try {
        const [books] = await connection.execute(
            'SELECT id, title, author, isbn, quantity, available_quantity FROM books WHERE id = ?',
            [bookId]
        );

        if (books.length === 0) return;

        const book = books[0];
        
        // If book is out of stock
        if (book.available_quantity <= 0) {
            await sendOutOfStockNotification(book);
        }
        // If book is running low (less than 20% of total quantity available)
        else if (book.available_quantity <= Math.ceil(book.quantity * 0.2)) {
            const message = `Book "${book.title}" is running low (${book.available_quantity} copies left).`;
            await connection.execute(
                'INSERT INTO book_notifications (book_id, message, notification_type) VALUES (?, ?, ?)',
                [book.id, message, 'low_stock']
            );
        }
    } catch (error) {
        console.error('Error checking book stock and sending notification:', error);
    }
}

// List all borrows (for admin/librarian)
router.get('/', isLibrarian, async (req, res) => {
    try {
        const [borrows] = await db.execute(`
            SELECT b.*, u.username, u.full_name, bk.title,
                   a.full_name as approver_name,
                   CASE 
                       WHEN b.status IN ('borrowed', 'overdue') AND b.due_date < CURRENT_TIMESTAMP 
                       THEN DATEDIFF(CURRENT_TIMESTAMP, b.due_date) * 5000
                       WHEN b.status = 'returned' AND b.due_date < b.return_date
                       THEN DATEDIFF(b.return_date, b.due_date) * 5000
                       ELSE b.fine_amount 
                   END as current_fine
            FROM borrows b 
            JOIN users u ON b.user_id = u.id 
            JOIN books bk ON b.book_id = bk.id 
            LEFT JOIN users a ON b.approved_by = a.id
            ORDER BY b.request_date DESC
        `);
        res.render('borrows/index', { borrows });
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error loading borrows');
        res.redirect('/');
    }
});

// Show borrow request details
router.get('/request/:borrowId', isLibrarian, async (req, res) => {
    try {
        const [borrows] = await db.execute(`
            SELECT b.*, u.username, u.full_name, u.email, u.student_id, u.lecturer_id,
                   bk.title, bk.author, bk.isbn,
                   a.full_name as approver_name
            FROM borrows b 
            JOIN users u ON b.user_id = u.id 
            JOIN books bk ON b.book_id = bk.id 
            LEFT JOIN users a ON b.approved_by = a.id
            WHERE b.id = ?
        `, [req.params.borrowId]);

        if (borrows.length === 0) {
            req.flash('error_msg', 'Borrow request not found');
            return res.redirect('/borrows');
        }

        res.render('borrows/request-details', { borrow: borrows[0] });
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error loading borrow request details');
        res.redirect('/borrows');
    }
});

// User's borrows
router.get('/my-borrows', isAuthenticated, async (req, res) => {
    try {
        const [borrows] = await db.execute(`
            SELECT b.*, bk.title,
                   CASE 
                       WHEN b.status IN ('borrowed', 'overdue') AND b.due_date < CURRENT_TIMESTAMP 
                       THEN DATEDIFF(CURRENT_TIMESTAMP, b.due_date) * 5000
                       WHEN b.status = 'returned' AND b.due_date < b.return_date
                       THEN DATEDIFF(b.return_date, b.due_date) * 5000
                       ELSE b.fine_amount 
                   END as current_fine
            FROM borrows b 
            JOIN books bk ON b.book_id = bk.id 
            WHERE b.user_id = ? 
            ORDER BY b.request_date DESC
        `, [req.session.user.id]);
        res.render('borrows/my-borrows', { borrows });
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error loading your borrows');
        res.redirect('/');
    }
});

// Show borrow form for a specific book
router.get('/borrow/:bookId', isAuthenticated, async (req, res) => {
    try {
        const [books] = await db.execute('SELECT * FROM books WHERE id = ?', [req.params.bookId]);
        if (books.length === 0) {
            req.flash('error_msg', 'Book not found');
            return res.redirect('/books');
        }

        const book = books[0];
        if (book.available_quantity <= 0) {
            req.flash('error_msg', 'Book is not available for borrowing');
            return res.redirect('/books');
        }

        // Check if user already has a pending request for this book
        const [existingRequests] = await db.execute(
            'SELECT * FROM borrows WHERE user_id = ? AND book_id = ? AND status = "requested"',
            [req.session.user.id, req.params.bookId]
        );
        if (existingRequests.length > 0) {
            req.flash('error_msg', 'You already have a pending request for this book');
            return res.redirect('/books');
        }

        res.render('borrows/borrow-form', { book });
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error loading borrow form');
        res.redirect('/books');
    }
});

// Request to borrow a book
router.post('/borrow/:bookId', isAuthenticated, async (req, res) => {
    try {
        const { pickup_date } = req.body;
        
        // Check if book is available
        const [books] = await db.execute('SELECT * FROM books WHERE id = ?', [req.params.bookId]);
        if (books.length === 0 || books[0].available_quantity <= 0) {
            req.flash('error_msg', 'Book is not available for borrowing');
            return res.redirect('/books');
        }

        // Check if user already has a pending request for this book
        const [existingRequests] = await db.execute(
            'SELECT * FROM borrows WHERE user_id = ? AND book_id = ? AND status = "requested"',
            [req.session.user.id, req.params.bookId]
        );
        if (existingRequests.length > 0) {
            req.flash('error_msg', 'You already have a pending request for this book');
            return res.redirect('/books');
        }

        // Create borrow request
        await db.execute(
            'INSERT INTO borrows (book_id, user_id, pickup_date, status) VALUES (?, ?, ?, "requested")',
            [req.params.bookId, req.session.user.id, pickup_date]
        );

        req.flash('success_msg', 'Borrow request submitted successfully. Please wait for approval.');
        res.redirect('/borrows/my-borrows');
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error submitting borrow request');
        res.redirect('/books');
    }
});

// Approve borrow request
router.post('/approve/:id', isLibrarian, async (req, res) => {
    if (!req.user) {
        req.flash('error', 'Bạn cần đăng nhập lại.');
        return res.redirect('/users/login');
    }
    try {
        const borrowId = req.params.id;
        const userId = req.user.id;

        const result = await retryTransaction(async (connection) => {
            // Get borrow request details
            const [borrowRequests] = await connection.execute(
                'SELECT * FROM borrows WHERE id = ?',
                [borrowId]
            );

            if (borrowRequests.length === 0) {
                throw new Error('Borrow request not found');
            }

            const borrowRequest = borrowRequests[0];

            // Calculate due date (14 days from approval)
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + 14);

            // Update borrow status
            await connection.execute(
                `UPDATE borrows 
                 SET status = 'borrowed',
                     approval_status = 'approved', 
                     approved_by = ?, 
                     approval_date = CURRENT_TIMESTAMP,
                     due_date = ?
                 WHERE id = ?`,
                [userId, dueDate, borrowId]
            );

            // Update book available quantity
            await connection.execute(
                'UPDATE books SET available_quantity = available_quantity - 1 WHERE id = ?',
                [borrowRequest.book_id]
            );

            // Get updated book info
            const [books] = await connection.execute(
                'SELECT * FROM books WHERE id = ?',
                [borrowRequest.book_id]
            );

            return { borrowRequest, book: books[0] };
        });

        // Send notifications outside the transaction
        if (result.book.available_quantity <= 0) {
            await checkBookStockAndNotify(result.book.id, db);
        }

        req.flash('success', 'Borrow request approved successfully');
        res.redirect('/borrows/pending');
    } catch (error) {
        console.error('Error in approve borrow request:', error);
        req.flash('error', 'Failed to approve borrow request. Please try again.');
        res.redirect('/borrows/pending');
    }
});

// Reject borrow request
router.post('/reject/:borrowId', isLibrarian, async (req, res) => {
    try {
        const [borrows] = await db.execute('SELECT * FROM borrows WHERE id = ?', [req.params.borrowId]);
        if (borrows.length === 0) {
            req.flash('error_msg', 'Borrow request not found');
            return res.redirect('/borrows');
        }

        const borrow = borrows[0];
        if (borrow.status !== 'requested') {
            req.flash('error_msg', 'Invalid borrow request status');
            return res.redirect('/borrows');
        }

        // Update borrow record
        await db.execute(
            `UPDATE borrows 
             SET approval_status = 'rejected', 
                 approved_by = ?, 
                 approval_date = CURRENT_TIMESTAMP,
                 status = 'cancelled'
             WHERE id = ?`,
            [req.session.user.id, req.params.borrowId]
        );

        req.flash('success_msg', 'Borrow request rejected successfully');
        res.redirect('/borrows');
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error rejecting borrow request');
        res.redirect('/borrows');
    }
});

// Return a book
router.post('/return/:borrowId', isLibrarian, async (req, res) => {
    try {
        const [borrows] = await db.execute('SELECT * FROM borrows WHERE id = ?', [req.params.borrowId]);
        if (borrows.length === 0) {
            req.flash('error_msg', 'Borrow record not found');
            return res.redirect('/borrows');
        }

        const borrow = borrows[0];
        if (borrow.status === 'returned') {
            req.flash('error_msg', 'Book is already returned');
            return res.redirect('/borrows');
        }

        // Calculate fine if returned late
        let fineAmount = 0;
        if (borrow.due_date && new Date() > new Date(borrow.due_date)) {
            const daysLate = Math.ceil((new Date() - new Date(borrow.due_date)) / (1000 * 60 * 60 * 24));
            fineAmount = daysLate * 5000; // 5000 VND per day
        }

        // Update borrow record
        await db.execute(
            `UPDATE borrows 
             SET status = "returned", 
                 return_date = CURRENT_TIMESTAMP,
                 fine_amount = ?,
                 last_notification_date = NULL
             WHERE id = ?`,
            [fineAmount, req.params.borrowId]
        );

        // Update book available quantity
        await db.execute(
            'UPDATE books SET available_quantity = available_quantity + 1 WHERE id = ?',
            [borrow.book_id]
        );

        if (fineAmount > 0) {
            req.flash('warning_msg', `Book returned successfully. Late return fine: ${fineAmount.toLocaleString('vi-VN')} VND`);
        } else {
            req.flash('success_msg', 'Book returned successfully');
        }
        res.redirect('/borrows');
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error returning book');
        res.redirect('/borrows');
    }
});

// Update payment status
router.post('/update-payment/:borrowId', isLibrarian, async (req, res) => {
    try {
        const { payment_status } = req.body;
        const [borrows] = await db.execute('SELECT * FROM borrows WHERE id = ?', [req.params.borrowId]);
        
        if (borrows.length === 0) {
            req.flash('error_msg', 'Borrow record not found');
            return res.redirect('/borrows');
        }

        const borrow = borrows[0];
        if (borrow.payment_status === 'paid') {
            req.flash('error_msg', 'Fine has already been paid');
            return res.redirect('/borrows');
        }

        await db.execute(
            `UPDATE borrows 
             SET payment_status = ?,
                 payment_date = CURRENT_TIMESTAMP,
                 payment_confirmed_by = ?
             WHERE id = ?`,
            [payment_status, req.session.user.id, req.params.borrowId]
        );

        req.flash('success_msg', 'Payment status updated successfully');
        res.redirect('/borrows');
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error updating payment status');
        res.redirect('/borrows');
    }
});

// Get payment details
router.get('/payment/:borrowId', isAuthenticated, async (req, res) => {
    try {
        const [borrows] = await db.execute(`
            SELECT b.*, bk.title,
                   CASE 
                       WHEN b.status IN ('borrowed', 'overdue') AND b.due_date < CURRENT_TIMESTAMP 
                       THEN DATEDIFF(CURRENT_TIMESTAMP, b.due_date) * 5000
                       WHEN b.status = 'returned' AND b.due_date < b.return_date
                       THEN DATEDIFF(b.return_date, b.due_date) * 5000
                       ELSE b.fine_amount 
                   END as current_fine
            FROM borrows b 
            JOIN books bk ON b.book_id = bk.id 
            WHERE b.id = ? AND b.user_id = ?
        `, [req.params.borrowId, req.session.user.id]);

        if (borrows.length === 0) {
            req.flash('error_msg', 'Borrow record not found');
            return res.redirect('/borrows/my-borrows');
        }

        const borrow = borrows[0];
        if (borrow.current_fine <= 0) {
            req.flash('error_msg', 'No fine to pay');
            return res.redirect('/borrows/my-borrows');
        }

        res.json({
            success: true,
            data: {
                borrow_id: borrow.id,
                book_title: borrow.title,
                fine_amount: borrow.current_fine,
                payment_status: borrow.payment_status,
                payment_date: borrow.payment_date
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: 'Error getting payment details'
        });
    }
});

// Request payment confirmation
router.post('/request-payment-confirmation/:borrowId', isAuthenticated, async (req, res) => {
    try {
        const { amount } = req.body;
        const [borrows] = await db.execute(`
            SELECT b.*, u.email, u.full_name, bk.title
            FROM borrows b 
            JOIN users u ON b.user_id = u.id 
            JOIN books bk ON b.book_id = bk.id 
            WHERE b.id = ? AND b.user_id = ?
        `, [req.params.borrowId, req.session.user.id]);

        if (borrows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Borrow record not found'
            });
        }

        const borrow = borrows[0];
        if (borrow.payment_status === 'paid') {
            return res.status(400).json({
                success: false,
                message: 'Payment has already been confirmed'
            });
        }

        // Update payment status to pending confirmation
        await db.execute(
            `UPDATE borrows 
             SET payment_status = 'pending',
                 payment_date = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [req.params.borrowId]
        );

        // Send email to admin
        const adminEmail = 'nguyenvanhoitgm@gmail.com'; // Admin email
        const emailSent = await sendEmail(
            adminEmail,
            'New Payment Confirmation Request',
            `
                <h2>New Payment Confirmation Request</h2>
                <p>A user has requested payment confirmation for a fine:</p>
                <ul>
                    <li><strong>User:</strong> ${borrow.full_name}</li>
                    <li><strong>Book:</strong> ${borrow.title}</li>
                    <li><strong>Amount:</strong> ${amount.toLocaleString('vi-VN')} VND</li>
                    <li><strong>Transfer Content:</strong> FINE_${borrow.id}</li>
                </ul>
                <p>Please review and confirm the payment in the admin panel.</p>
            `
        );

        if (!emailSent) {
            console.error('Failed to send email to admin');
        }

        res.json({
            success: true,
            message: 'Payment confirmation request sent successfully'
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: 'Error requesting payment confirmation'
        });
    }
});

// Approve payment (admin only)
router.post('/approve-payment/:borrowId', isLibrarian, async (req, res) => {
    try {
        const [borrows] = await db.execute(`
            SELECT b.*, u.email, u.full_name, bk.title
            FROM borrows b 
            JOIN users u ON b.user_id = u.id 
            JOIN books bk ON b.book_id = bk.id 
            WHERE b.id = ?
        `, [req.params.borrowId]);

        if (borrows.length === 0) {
            req.flash('error_msg', 'Borrow record not found');
            return res.redirect('/borrows');
        }

        const borrow = borrows[0];
        if (borrow.payment_status === 'paid') {
            req.flash('error_msg', 'Payment has already been confirmed');
            return res.redirect('/borrows');
        }

        // Update payment status
        await db.execute(
            `UPDATE borrows 
             SET payment_status = 'paid',
                 payment_confirmed_by = ?
             WHERE id = ?`,
            [req.session.user.id, req.params.borrowId]
        );

        // Send confirmation email to user
        await sendEmail(
            borrow.email,
            'Payment Confirmed',
            `
                <h2>Payment Confirmed</h2>
                <p>Your payment for the following fine has been confirmed:</p>
                <ul>
                    <li><strong>Book:</strong> ${borrow.title}</li>
                    <li><strong>Amount:</strong> ${borrow.fine_amount.toLocaleString('vi-VN')} VND</li>
                </ul>
                <p>Thank you for your payment!</p>
            `
        );

        req.flash('success_msg', 'Payment confirmed successfully');
        res.redirect('/borrows');
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error confirming payment');
        res.redirect('/borrows');
    }
});

// Reject payment (admin only)
router.post('/reject-payment/:borrowId', isLibrarian, async (req, res) => {
    try {
        const [borrows] = await db.execute(`
            SELECT b.*, u.email, u.full_name, bk.title
            FROM borrows b 
            JOIN users u ON b.user_id = u.id 
            JOIN books bk ON b.book_id = bk.id 
            WHERE b.id = ?
        `, [req.params.borrowId]);

        if (borrows.length === 0) {
            req.flash('error_msg', 'Borrow record not found');
            return res.redirect('/borrows');
        }

        const borrow = borrows[0];
        if (borrow.payment_status === 'paid') {
            req.flash('error_msg', 'Payment has already been confirmed');
            return res.redirect('/borrows');
        }

        // Update payment status
        await db.execute(
            `UPDATE borrows 
             SET payment_status = 'cancelled',
                 payment_confirmed_by = ?
             WHERE id = ?`,
            [req.session.user.id, req.params.borrowId]
        );

        // Send rejection email to user
        await sendEmail(
            borrow.email,
            'Payment Rejected',
            `
                <h2>Payment Rejected</h2>
                <p>Your payment for the following fine has been rejected:</p>
                <ul>
                    <li><strong>Book:</strong> ${borrow.title}</li>
                    <li><strong>Amount:</strong> ${borrow.fine_amount.toLocaleString('vi-VN')} VND</li>
                </ul>
                <p>Please contact the library staff for more information.</p>
            `
        );

        req.flash('success_msg', 'Payment rejected successfully');
        res.redirect('/borrows');
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error rejecting payment');
        res.redirect('/borrows');
    }
});

// Payment management page
router.get('/payments', isLibrarian, async (req, res) => {
    try {
        const [payments] = await db.execute(`
            SELECT * FROM (
                SELECT b.*, u.username, u.full_name, u.email, bk.title,
                       a.full_name as approver_name,
                       CASE 
                           WHEN b.status IN ('borrowed', 'overdue') AND b.due_date < CURRENT_TIMESTAMP 
                           THEN DATEDIFF(CURRENT_TIMESTAMP, b.due_date) * 5000
                           WHEN b.status = 'returned' AND b.due_date < b.return_date
                           THEN DATEDIFF(b.return_date, b.due_date) * 5000
                           ELSE b.fine_amount 
                       END as current_fine
                FROM borrows b 
                JOIN users u ON b.user_id = u.id 
                JOIN books bk ON b.book_id = bk.id 
                LEFT JOIN users a ON b.payment_confirmed_by = a.id
            ) as payments
            WHERE current_fine > 0
            ORDER BY 
                CASE 
                    WHEN payment_status = 'pending' THEN 1
                    WHEN payment_status = 'paid' THEN 2
                    ELSE 3
                END,
                payment_date DESC
        `);

        res.render('borrows/payments', { 
            payments: payments,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error fetching payments:', error);
        req.flash('error_msg', 'Error loading payments');
        res.redirect('/');
    }
});

// Get payment details
router.get('/payment/:id', isLibrarian, async (req, res) => {
    try {
        const [payments] = await db.execute(`
            SELECT * FROM (
                SELECT b.*, u.username, u.full_name, u.email, bk.title,
                       a.full_name as approver_name,
                       CASE 
                           WHEN b.status IN ('borrowed', 'overdue') AND b.due_date < CURRENT_TIMESTAMP 
                           THEN DATEDIFF(CURRENT_TIMESTAMP, b.due_date) * 5000
                           WHEN b.status = 'returned' AND b.due_date < b.return_date
                           THEN DATEDIFF(b.return_date, b.due_date) * 5000
                           ELSE b.fine_amount 
                       END as current_fine
                FROM borrows b 
                JOIN users u ON b.user_id = u.id 
                JOIN books bk ON b.book_id = bk.id 
                LEFT JOIN users a ON b.payment_confirmed_by = a.id
                WHERE b.id = ?
            ) as payments
        `, [req.params.id]);

        if (payments.length === 0) {
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }

        res.json({ success: true, data: payments[0] });
    } catch (error) {
        console.error('Error fetching payment details:', error);
        res.status(500).json({ success: false, message: 'Error fetching payment details' });
    }
});

// Approve payment
router.post('/approve-payment/:id', isLibrarian, async (req, res) => {
    try {
        const [borrows] = await db.execute('SELECT * FROM borrows WHERE id = ?', [req.params.id]);
        
        if (borrows.length === 0) {
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }

        if (borrows[0].payment_status === 'paid') {
            return res.status(400).json({ success: false, message: 'Payment has already been confirmed' });
        }

        await db.execute(`
            UPDATE borrows 
            SET payment_status = 'paid',
                payment_date = CURRENT_TIMESTAMP,
                payment_confirmed_by = ?
            WHERE id = ?
        `, [req.user.id, req.params.id]);

        // Send notification to user
        await db.execute(`
            INSERT INTO notifications (user_id, title, message, type, created_at)
            VALUES (?, ?, ?, 'payment', NOW())
        `, [
            borrows[0].user_id,
            'Payment Confirmed',
            `Your payment of ${borrows[0].fine_amount.toLocaleString('vi-VN')} VND has been confirmed.`
        ]);

        res.json({ success: true });
    } catch (error) {
        console.error('Error approving payment:', error);
        res.status(500).json({ success: false, message: 'Error approving payment' });
    }
});

// Reject payment
router.post('/reject-payment/:id', isLibrarian, async (req, res) => {
    try {
        const [borrows] = await db.execute('SELECT * FROM borrows WHERE id = ?', [req.params.id]);
        
        if (borrows.length === 0) {
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }

        if (borrows[0].payment_status === 'paid') {
            return res.status(400).json({ success: false, message: 'Payment has already been confirmed' });
        }

        await db.execute(`
            UPDATE borrows 
            SET payment_status = 'cancelled',
                payment_confirmed_by = ?
            WHERE id = ?
        `, [req.user.id, req.params.id]);

        // Send notification to user
        await db.execute(`
            INSERT INTO notifications (user_id, title, message, type, created_at)
            VALUES (?, ?, ?, 'payment', NOW())
        `, [
            borrows[0].user_id,
            'Payment Rejected',
            `Your payment of ${borrows[0].fine_amount.toLocaleString('vi-VN')} VND has been rejected. Please contact the library for more information.`
        ]);

        res.json({ success: true });
    } catch (error) {
        console.error('Error rejecting payment:', error);
        res.status(500).json({ success: false, message: 'Error rejecting payment' });
    }
});

// Pending borrows (for admin/librarian)
router.get('/pending', isLibrarian, async (req, res) => {
    try {
        const [borrows] = await db.execute(`
            SELECT b.*, u.username, u.full_name, bk.title,
                   a.full_name as approver_name,
                   CASE 
                       WHEN b.status IN ('borrowed', 'overdue') AND b.due_date < CURRENT_TIMESTAMP 
                       THEN DATEDIFF(CURRENT_TIMESTAMP, b.due_date) * 5000
                       WHEN b.status = 'returned' AND b.due_date < b.return_date
                       THEN DATEDIFF(b.return_date, b.due_date) * 5000
                       ELSE b.fine_amount 
                   END as current_fine
            FROM borrows b 
            JOIN users u ON b.user_id = u.id 
            JOIN books bk ON b.book_id = bk.id 
            LEFT JOIN users a ON b.approved_by = a.id
            WHERE b.approval_status = 'pending'
            ORDER BY b.request_date DESC
        `);
        res.render('borrows/pending', { borrows });
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error loading pending borrows');
        res.redirect('/borrows');
    }
});

module.exports = router; 