const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isLibrarian } = require('../middleware/auth');

// Librarian Dashboard
router.get('/', isLibrarian, async (req, res) => {
    try {
        // Get statistics relevant to librarians
        const [totalBooks] = await db.query('SELECT COUNT(*) as count FROM books');
        const [activeBorrows] = await db.query('SELECT COUNT(*) as count FROM borrows WHERE return_date IS NULL');
        const [pendingRequests] = await db.query('SELECT COUNT(*) as count FROM borrows WHERE approval_status = "pending"');
        const [overdueBooks] = await db.query('SELECT COUNT(*) as count FROM borrows WHERE due_date < NOW() AND return_date IS NULL');

        const stats = {
            totalBooks: totalBooks[0].count,
            activeBorrows: activeBorrows[0].count,
            pendingRequests: pendingRequests[0].count,
            overdueBooks: overdueBooks[0].count
        };

        res.render('librarian/index', { stats });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while loading dashboard');
        res.redirect('/');
    }
});

// View all borrows
router.get('/borrows', isLibrarian, async (req, res) => {
    try {
        const [borrows] = await db.query(`
            SELECT b.*, books.title, books.author, users.full_name, users.username
            FROM borrows b 
            JOIN books ON b.book_id = books.id 
            JOIN users ON b.user_id = users.id 
            ORDER BY b.created_at DESC
        `);
        res.render('librarian/borrows', { borrows });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while loading borrows');
        res.redirect('/librarian');
    }
});

// View pending borrow requests
router.get('/borrows/pending', isLibrarian, async (req, res) => {
    try {
        const [borrows] = await db.query(`
            SELECT b.*, books.title, books.author, users.full_name, users.username
            FROM borrows b 
            JOIN books ON b.book_id = books.id 
            JOIN users ON b.user_id = users.id 
            WHERE b.approval_status = 'pending'
            ORDER BY b.request_date ASC
        `);
        res.render('librarian/pending-borrows', { borrows });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while loading pending borrows');
        res.redirect('/librarian');
    }
});

// Approve borrow request
router.post('/borrows/approve/:id', isLibrarian, async (req, res) => {
    try {
        const borrowId = req.params.id;
        
        // Get borrow details
        const [borrows] = await db.query('SELECT * FROM borrows WHERE id = ?', [borrowId]);
        if (borrows.length === 0) {
            req.flash('error_msg', 'Borrow request not found');
            return res.redirect('/librarian/borrows/pending');
        }

        const borrow = borrows[0];
        
        // Check if book is available
        const [books] = await db.query('SELECT * FROM books WHERE id = ?', [borrow.book_id]);
        if (books.length === 0 || books[0].available_quantity <= 0) {
            req.flash('error_msg', 'Book is not available');
            return res.redirect('/librarian/borrows/pending');
        }

        // Update borrow status
        await db.query(
            'UPDATE borrows SET approval_status = "approved", approved_by = ?, approval_date = NOW() WHERE id = ?',
            [req.session.user.id, borrowId]
        );

        // Update book availability
        await db.query(
            'UPDATE books SET available_quantity = available_quantity - 1 WHERE id = ?',
            [borrow.book_id]
        );

        req.flash('success_msg', 'Borrow request approved successfully');
        res.redirect('/librarian/borrows/pending');
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while approving borrow request');
        res.redirect('/librarian/borrows/pending');
    }
});

// Reject borrow request
router.post('/borrows/reject/:id', isLibrarian, async (req, res) => {
    try {
        const borrowId = req.params.id;
        
        // Update borrow status
        await db.query(
            'UPDATE borrows SET approval_status = "rejected", approved_by = ?, approval_date = NOW() WHERE id = ?',
            [req.session.user.id, borrowId]
        );

        req.flash('success_msg', 'Borrow request rejected successfully');
        res.redirect('/librarian/borrows/pending');
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while rejecting borrow request');
        res.redirect('/librarian/borrows/pending');
    }
});

// View overdue books
router.get('/borrows/overdue', isLibrarian, async (req, res) => {
    try {
        const [borrows] = await db.query(`
            SELECT b.*, books.title, books.author, users.full_name, users.username,
                   DATEDIFF(NOW(), b.due_date) as days_overdue
            FROM borrows b 
            JOIN books ON b.book_id = books.id 
            JOIN users ON b.user_id = users.id 
            WHERE b.due_date < NOW() AND b.return_date IS NULL
            ORDER BY b.due_date ASC
        `);
        res.render('librarian/overdue-borrows', { borrows });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while loading overdue books');
        res.redirect('/librarian');
    }
});

// Process book return
router.post('/borrows/return/:id', isLibrarian, async (req, res) => {
    try {
        const borrowId = req.params.id;
        
        // Get borrow details
        const [borrows] = await db.query('SELECT * FROM borrows WHERE id = ?', [borrowId]);
        if (borrows.length === 0) {
            req.flash('error_msg', 'Borrow record not found');
            return res.redirect('/librarian/borrows');
        }

        const borrow = borrows[0];
        
        // Update borrow status
        await db.query(
            'UPDATE borrows SET return_date = NOW(), status = "returned" WHERE id = ?',
            [borrowId]
        );

        // Update book availability
        await db.query(
            'UPDATE books SET available_quantity = available_quantity + 1 WHERE id = ?',
            [borrow.book_id]
        );

        req.flash('success_msg', 'Book returned successfully');
        res.redirect('/librarian/borrows');
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while processing return');
        res.redirect('/librarian/borrows');
    }
});

// View payments
router.get('/payments', isLibrarian, async (req, res) => {
    try {
        const [borrows] = await db.query(`
            SELECT b.*, books.title, users.full_name, users.username
            FROM borrows b 
            JOIN books ON b.book_id = books.id 
            JOIN users ON b.user_id = users.id 
            WHERE b.fine_amount > 0
            ORDER BY b.payment_date DESC, b.due_date DESC
        `);
        res.render('librarian/payments', { borrows });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while loading payments');
        res.redirect('/librarian');
    }
});

// Confirm payment
router.post('/payments/confirm/:id', isLibrarian, async (req, res) => {
    try {
        const borrowId = req.params.id;
        
        // Update payment status
        await db.query(
            'UPDATE borrows SET payment_status = "paid", payment_confirmed_by = ?, payment_date = NOW() WHERE id = ?',
            [req.session.user.id, borrowId]
        );

        req.flash('success_msg', 'Payment confirmed successfully');
        res.redirect('/librarian/payments');
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while confirming payment');
        res.redirect('/librarian/payments');
    }
});

// Reports routes
router.get('/reports/borrows', isLibrarian, async (req, res) => {
    try {
        const [borrows] = await db.query(`
            SELECT b.*, books.title, users.full_name 
            FROM borrows b 
            JOIN books ON b.book_id = books.id 
            JOIN users ON b.user_id = users.id 
            ORDER BY b.borrow_date DESC
        `);
        res.render('librarian/reports/borrows', { borrows });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while loading borrows report');
        res.redirect('/librarian');
    }
});

router.get('/reports/overdue', isLibrarian, async (req, res) => {
    try {
        const [borrows] = await db.query(`
            SELECT b.*, books.title, users.full_name,
                   DATEDIFF(NOW(), b.due_date) as days_overdue
            FROM borrows b 
            JOIN books ON b.book_id = books.id 
            JOIN users ON b.user_id = users.id 
            WHERE b.due_date < NOW() AND b.return_date IS NULL
            ORDER BY b.due_date ASC
        `);
        res.render('librarian/reports/overdue', { borrows });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while loading overdue report');
        res.redirect('/librarian');
    }
});

module.exports = router; 