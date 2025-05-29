const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAdmin } = require('../middleware/auth');

// Admin dashboard
router.get('/dashboard', isAdmin, async (req, res) => {
    try {
        // Get pending users
        const [pendingUsers] = await db.query(
            'SELECT * FROM users WHERE is_verified = FALSE ORDER BY created_at DESC'
        );

        // Get all books
        const [books] = await db.query('SELECT * FROM books ORDER BY title ASC');

        // Get all borrows with book and user information
        const [borrows] = await db.query(`
            SELECT b.*, 
                   books.title as book_title,
                   users.full_name as borrower_name
            FROM borrows b
            JOIN books ON b.book_id = books.id
            JOIN users ON b.user_id = users.id
            ORDER BY b.borrow_date DESC
        `);

        // Get all users
        const [users] = await db.query('SELECT * FROM users ORDER BY created_at DESC');

        res.render('admin/dashboard', {
            pendingUsers,
            books,
            borrows,
            users
        });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while loading the dashboard');
        res.redirect('/');
    }
});

module.exports = router; 