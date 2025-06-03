const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAuthenticated, isLibrarian } = require('../middleware/auth');

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
router.post('/approve/:borrowId', isLibrarian, async (req, res) => {
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

        // Calculate due date (14 days from pickup date)
        const dueDate = new Date(borrow.pickup_date);
        dueDate.setDate(dueDate.getDate() + 14);

        // Update borrow record
        await db.execute(
            `UPDATE borrows 
             SET approval_status = 'approved', 
                 approved_by = ?, 
                 approval_date = CURRENT_TIMESTAMP,
                 due_date = ?,
                 status = 'borrowed'
             WHERE id = ?`,
            [req.session.user.id, dueDate, req.params.borrowId]
        );

        // Update book available quantity
        await db.execute(
            'UPDATE books SET available_quantity = available_quantity - 1 WHERE id = ?',
            [borrow.book_id]
        );

        req.flash('success_msg', 'Borrow request approved successfully');
        res.redirect('/borrows');
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error approving borrow request');
        res.redirect('/borrows');
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

module.exports = router; 