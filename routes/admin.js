const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAdmin } = require('../middleware/auth');

// Admin Dashboard
router.get('/', isAdmin, async (req, res) => {
    try {
        // Get statistics
        const [totalBooks] = await db.query('SELECT COUNT(*) as count FROM books');
        const [activeBorrows] = await db.query('SELECT COUNT(*) as count FROM borrows WHERE return_date IS NULL');
        const [pendingVerifications] = await db.query('SELECT COUNT(*) as count FROM users WHERE is_verified = FALSE');
        const [totalUsers] = await db.query('SELECT COUNT(*) as count FROM users');

        const stats = {
            totalBooks: totalBooks[0].count,
            activeBorrows: activeBorrows[0].count,
            pendingVerifications: pendingVerifications[0].count,
            totalUsers: totalUsers[0].count
        };

        res.render('admin/index', { stats });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while loading dashboard');
        res.redirect('/');
    }
});

// Reports routes
router.get('/reports/borrows', isAdmin, async (req, res) => {
    try {
        const [borrows] = await db.query(`
            SELECT b.*, books.title, users.full_name 
            FROM borrows b 
            JOIN books ON b.book_id = books.id 
            JOIN users ON b.user_id = users.id 
            ORDER BY b.borrow_date DESC
        `);
        res.render('admin/reports/borrows', { borrows });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while loading borrows report');
        res.redirect('/admin');
    }
});

router.get('/reports/users', isAdmin, async (req, res) => {
    try {
        const [users] = await db.query(`
            SELECT 
                role,
                COUNT(*) as count,
                SUM(CASE WHEN is_verified = TRUE THEN 1 ELSE 0 END) as verified_count
            FROM users 
            GROUP BY role
        `);
        res.render('admin/reports/users', { users });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while loading users report');
        res.redirect('/admin');
    }
});

module.exports = router; 