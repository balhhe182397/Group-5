const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAuthenticated, isLibrarian } = require('../middleware/auth');

// List all borrows
router.get('/', isLibrarian, async (req, res) => {
    try {
        const [borrows] = await db.execute(`
            SELECT b.*, u.username, u.full_name, bk.title 
            FROM borrows b 
            JOIN users u ON b.user_id = u.id 
            JOIN books bk ON b.book_id = bk.id 
            ORDER BY b.borrow_date DESC
        `);
        res.render('borrows/index', { borrows });
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error loading borrows');
        res.redirect('/');
    }
});

// User's borrows
router.get('/my-borrows', isAuthenticated, async (req, res) => {
    try {
        const [borrows] = await db.execute(`
            SELECT b.*, bk.title 
            FROM borrows b 
            JOIN books bk ON b.book_id = bk.id 
            WHERE b.user_id = ? 
            ORDER BY b.borrow_date DESC
        `, [req.session.user.id]);
        res.render('borrows/my-borrows', { borrows });
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error loading your borrows');
        res.redirect('/');
    }
});

// Borrow a book
router.post('/borrow/:bookId', isAuthenticated, async (req, res) => {
    try {
        // Check if book is available
        const [books] = await db.execute('SELECT * FROM books WHERE id = ?', [req.params.bookId]);
        if (books.length === 0 || books[0].available_quantity <= 0) {
            req.flash('error_msg', 'Book is not available for borrowing');
            return res.redirect('/books');
        }

        // Check if user already has this book borrowed
        const [existingBorrows] = await db.execute(
            'SELECT * FROM borrows WHERE user_id = ? AND book_id = ? AND status = "borrowed"',
            [req.session.user.id, req.params.bookId]
        );
        if (existingBorrows.length > 0) {
            req.flash('error_msg', 'You have already borrowed this book');
            return res.redirect('/books');
        }

        // Calculate due date (14 days from now)
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 14);

        // Create borrow record
        await db.execute(
            'INSERT INTO borrows (book_id, user_id, due_date) VALUES (?, ?, ?)',
            [req.params.bookId, req.session.user.id, dueDate]
        );

        // Update book available quantity
        await db.execute(
            'UPDATE books SET available_quantity = available_quantity - 1 WHERE id = ?',
            [req.params.bookId]
        );

        req.flash('success_msg', 'Book borrowed successfully');
        res.redirect('/borrows/my-borrows');
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error borrowing book');
        res.redirect('/books');
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

        // Update borrow record
        await db.execute(
            'UPDATE borrows SET status = "returned", return_date = CURRENT_TIMESTAMP WHERE id = ?',
            [req.params.borrowId]
        );

        // Update book available quantity
        await db.execute(
            'UPDATE books SET available_quantity = available_quantity + 1 WHERE id = ?',
            [borrow.book_id]
        );

        req.flash('success_msg', 'Book returned successfully');
        res.redirect('/borrows');
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error returning book');
        res.redirect('/borrows');
    }
});

module.exports = router; 