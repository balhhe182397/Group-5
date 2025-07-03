const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAuthenticated, isLibrarian } = require('../middleware/auth');
const transporter = require('../config/email');

// Helper function to send email
async function sendEmail(to, subject, html) {
    try {
        const info = await transporter.sendMail({
            from: 'nguyenvanhoitgm@gmail.com',
            to: to,
            subject: subject,
            html: html
        });
        console.log('Email sent:', info.messageId);
        return true;
    } catch (error) {
        console.error('Error sending email:', error);
        return false;
    }
}

// Xem lịch sử thanh toán của user hoặc toàn bộ (nếu là admin/librarian)
router.get('/history', isAuthenticated, async (req, res) => {
    try {
        let payments;
        if (req.session.user.role === 'admin' || req.session.user.role === 'librarian') {
            // Nếu là admin/librarian, cho phép xem toàn bộ hoặc lọc theo user nếu có query
            if (req.query.userId) {
                [payments] = await db.execute(`
                    SELECT p.*, b.book_id, bk.title, b.due_date, b.return_date
                    FROM payments p
                    JOIN borrows b ON p.borrow_id = b.id
                    JOIN books bk ON b.book_id = bk.id
                    WHERE p.requested_by = ?
                    ORDER BY p.requested_at DESC
                `, [req.query.userId]);
            } else {
                [payments] = await db.execute(`
                    SELECT p.*, b.book_id, bk.title, b.due_date, b.return_date
                    FROM payments p
                    JOIN borrows b ON p.borrow_id = b.id
                    JOIN books bk ON b.book_id = bk.id
                    ORDER BY p.requested_at DESC
                `);
            }
        } else {
            // User thường chỉ xem được payment của mình
            [payments] = await db.execute(`
                SELECT p.*, b.book_id, bk.title, b.due_date, b.return_date
                FROM payments p
                JOIN borrows b ON p.borrow_id = b.id
                JOIN books bk ON b.book_id = bk.id
                WHERE p.requested_by = ?
                ORDER BY p.requested_at DESC
            `, [req.session.user.id]);
        }
        res.render('payments/history', { payments });
    } catch (error) {
        console.error('Error fetching payment history:', error);
        res.status(500).send('Error loading payment history');
    }
});

// List all payments (for admin/librarian)
router.get('/', isLibrarian, async (req, res) => {
    try {
        const [payments] = await db.execute(`
            SELECT p.*, b.user_id, b.book_id, u.username, u.full_name, u.email, bk.title,
                   rb.full_name as requested_by_name, cb.full_name as confirmed_by_name
            FROM payments p
            JOIN borrows b ON p.borrow_id = b.id
            JOIN users u ON b.user_id = u.id
            JOIN books bk ON b.book_id = bk.id
            LEFT JOIN users rb ON p.requested_by = rb.id
            LEFT JOIN users cb ON p.confirmed_by = cb.id
            ORDER BY p.requested_at DESC
        `);
        res.render('borrows/payments', { payments, user: req.session.user });
    } catch (error) {
        console.error('Error fetching payments:', error);
        req.flash('error_msg', 'Error loading payments');
        res.redirect('/');
    }
});

// Get payment details
router.get('/:id', isLibrarian, async (req, res) => {
    try {
        const [payments] = await db.execute(`
            SELECT p.*, b.user_id, b.book_id, u.username, u.full_name, u.email, bk.title,
                   rb.full_name as requested_by_name, cb.full_name as confirmed_by_name
            FROM payments p
            JOIN borrows b ON p.borrow_id = b.id
            JOIN users u ON b.user_id = u.id
            JOIN books bk ON b.book_id = bk.id
            LEFT JOIN users rb ON p.requested_by = rb.id
            LEFT JOIN users cb ON p.confirmed_by = cb.id
            WHERE p.id = ?
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

// Create a new payment request (user)
router.post('/request/:borrowId', isAuthenticated, async (req, res) => {
    try {
        const { amount } = req.body;
        // Check if borrow exists and belongs to user
        const [borrows] = await db.execute('SELECT * FROM borrows WHERE id = ? AND user_id = ?', [req.params.borrowId, req.session.user.id]);
        if (borrows.length === 0) {
            return res.status(404).json({ success: false, message: 'Borrow record not found' });
        }
        const borrow = borrows[0];
        // Tính số ngày trễ thực tế
        let daysLate = 0;
        if (borrow.due_date && borrow.status !== 'returned') {
            const now = new Date();
            const due = new Date(borrow.due_date);
            if (now > due) {
                daysLate = Math.ceil((now - due) / (1000 * 60 * 60 * 24));
            }
        } else if (borrow.due_date && borrow.return_date && borrow.return_date > borrow.due_date) {
            const due = new Date(borrow.due_date);
            const returned = new Date(borrow.return_date);
            daysLate = Math.ceil((returned - due) / (1000 * 60 * 60 * 24));
        }
        // Lấy tổng số ngày đã thanh toán
        const [paidRows] = await db.execute(
            'SELECT SUM(late_days_paid) as total_days_paid FROM payments WHERE borrow_id = ? AND status = "paid"',
            [borrow.id]
        );
        const totalDaysPaid = paidRows[0].total_days_paid || 0;
        const daysToPay = daysLate - totalDaysPaid;
        if (daysToPay <= 0) {
            return res.status(400).json({ success: false, message: 'No new fine to pay' });
        }
        // Tạo payment mới cho số ngày trễ chưa thanh toán
        await db.execute(
            'INSERT INTO payments (borrow_id, amount, status, requested_by, late_days_paid) VALUES (?, ?, ?, ?, ?)',
            [req.params.borrowId, daysToPay * 5000, 'pending', req.session.user.id, daysToPay]
        );
        // Notify admin (email)
        const adminEmail = 'nguyenvanhoitgm@gmail.com';
        await sendEmail(
            adminEmail,
            'New Payment Confirmation Request',
            `<h2>New Payment Confirmation Request</h2>
            <p>A user has requested payment confirmation for a fine:</p>
            <ul>
                <li><strong>User ID:</strong> ${req.session.user.id}</li>
                <li><strong>Borrow ID:</strong> ${req.params.borrowId}</li>
                <li><strong>Amount:</strong> ${daysToPay * 5000} VND</li>
                <li><strong>Late Days:</strong> ${daysToPay}</li>
            </ul>
            <p>Please review and confirm the payment in the admin panel.</p>`
        );
        res.json({ success: true, message: 'Payment request submitted successfully' });
    } catch (error) {
        console.error('Error creating payment request:', error);
        res.status(500).json({ success: false, message: 'Error creating payment request' });
    }
});

// Approve payment (admin/librarian)
router.post('/approve/:id', isLibrarian, async (req, res) => {
    try {
        const [payments] = await db.execute('SELECT * FROM payments WHERE id = ?', [req.params.id]);
        if (payments.length === 0) {
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }
        if (payments[0].status === 'paid') {
            return res.status(400).json({ success: false, message: 'Payment has already been confirmed' });
        }
        await db.execute(
            `UPDATE payments SET status = 'paid', confirmed_by = ?, confirmed_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [req.session.user.id, req.params.id]
        );
        // Send notification/email to user (optional)
        res.json({ success: true, message: 'Payment confirmed successfully' });
    } catch (error) {
        console.error('Error approving payment:', error);
        res.status(500).json({ success: false, message: 'Error approving payment' });
    }
});

// Reject payment (admin/librarian)
router.post('/reject/:id', isLibrarian, async (req, res) => {
    try {
        const [payments] = await db.execute('SELECT * FROM payments WHERE id = ?', [req.params.id]);
        if (payments.length === 0) {
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }
        if (payments[0].status === 'paid') {
            return res.status(400).json({ success: false, message: 'Payment has already been confirmed' });
        }
        await db.execute(
            `UPDATE payments SET status = 'cancelled', confirmed_by = ?, confirmed_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [req.session.user.id, req.params.id]
        );
        // Send notification/email to user (optional)
        res.json({ success: true, message: 'Payment rejected successfully' });
    } catch (error) {
        console.error('Error rejecting payment:', error);
        res.status(500).json({ success: false, message: 'Error rejecting payment' });
    }
});

// API trả về trạng thái payment và số tiền nợ hiện tại cho một borrow
router.get('/status/:borrowId', isAuthenticated, async (req, res) => {
    try {
        const [borrows] = await db.execute('SELECT * FROM borrows WHERE id = ? AND user_id = ?', [req.params.borrowId, req.session.user.id]);
        if (borrows.length === 0) {
            return res.status(404).json({ success: false, message: 'Borrow record not found' });
        }
        const borrow = borrows[0];
        // Tính số ngày trễ thực tế
        let daysLate = 0;
        if (borrow.due_date && borrow.status !== 'returned') {
            const now = new Date();
            const due = new Date(borrow.due_date);
            if (now > due) {
                daysLate = Math.ceil((now - due) / (1000 * 60 * 60 * 24));
            }
        } else if (borrow.due_date && borrow.return_date && borrow.return_date > borrow.due_date) {
            const due = new Date(borrow.due_date);
            const returned = new Date(borrow.return_date);
            daysLate = Math.ceil((returned - due) / (1000 * 60 * 60 * 24));
        }
        // Lấy tổng số ngày đã thanh toán
        const [paidRows] = await db.execute(
            'SELECT SUM(late_days_paid) as total_days_paid FROM payments WHERE borrow_id = ? AND status = "paid"',
            [borrow.id]
        );
        const totalDaysPaid = paidRows[0].total_days_paid || 0;
        const current_fine = Math.max(0, (daysLate - totalDaysPaid) * 5000);
        // Lấy trạng thái payment mới nhất
        const [lastPayment] = await db.execute(
            'SELECT status FROM payments WHERE borrow_id = ? ORDER BY requested_at DESC LIMIT 1',
            [borrow.id]
        );
        const payment_status = lastPayment.length > 0 ? lastPayment[0].status : null;
        res.json({ success: true, current_fine, payment_status });
    } catch (error) {
        console.error('Error fetching payment status:', error);
        res.status(500).json({ success: false, message: 'Error fetching payment status' });
    }
});

module.exports = router; 